// node api/_lib/macro-news.test.mjs — 매크로 이벤트 감지 회귀 테스트 (npm test)
// 2026-06-12 미·이란 합의 미반영 사고의 재발 방지: 국면 전환(conflict→deal) 감지를 못 박는다.
import assert from 'node:assert/strict';
import {
  parseGoogleNewsItems, dedupMacroItems, analyzeMacroShock, isMacroTrigger,
  buildMacroSection, MACRO_TRIGGER_SCORE,
} from './macro-news.js';

const NOW = Date.parse('2026-06-12T03:00:00Z');
const item = (title, source = 'Reuters', hoursAgo = 5) => ({
  title, source, url: `https://x.test/${title.length}-${title.slice(0, 12)}`,
  date: '2026-06-12', ts: NOW - hoursAgo * 3600000,
});

// ─── Google News RSS 파싱 ───────────────────────────────────────────────────
const xml = `<rss><channel><title>chan</title>
<item><title>Oil Falls on Iran Peace Deal - WSJ</title><link>https://wsj.test/a</link>
<pubDate>Thu, 12 Jun 2026 01:00:00 GMT</pubDate><source url="https://wsj.com">WSJ</source></item>
<item><title><![CDATA[Metals &amp; Mining update]]></title><link>https://r.test/b</link>
<pubDate>Thu, 12 Jun 2026 00:00:00 GMT</pubDate><source url="https://r.com">Reuters</source></item>
<item><title>no link item</title></item>
</channel></rss>`;
const parsed = parseGoogleNewsItems(xml);
assert.equal(parsed.length, 2);                          // link 없는 item 제외, 채널 title 미포함
assert.equal(parsed[0].title, 'Oil Falls on Iran Peace Deal'); // " - 매체명" 접미 제거
assert.equal(parsed[0].source, 'WSJ');
assert.equal(parsed[0].date, '2026-06-12');
assert.equal(parsed[1].title, 'Metals & Mining update'); // CDATA + 엔티티 디코드

// ─── 중복 제거 ───────────────────────────────────────────────────────────────
const dup = dedupMacroItems([item('Iran deal reached!'), item('Iran deal reached'), item('Other news')]);
assert.equal(dup.length, 2); // 문장부호만 다른 제목은 동일 취급

// ─── 갈등 단일 국면 (전쟁 중 평시) ──────────────────────────────────────────
const conflictDay = [
  item('Iran war escalates as strikes continue', 'FT'),
  item('Oil rises on Iran attack fears', 'Reuters'),
  item('LME metals tumble on Iran war risk', 'Bloomberg'),
  item('Copper falls amid Iran escalation', 'CNBC'),
];
const a1 = analyzeMacroShock(conflictDay, NOW);
assert.equal(a1.fingerprint, 'iran:conflict');
assert.ok(a1.score >= MACRO_TRIGGER_SCORE);
assert.equal(isMacroTrigger(a1, 'iran:conflict'), false); // 같은 국면 지속 → 재트리거 금지
assert.equal(isMacroTrigger(a1, null), true);             // 초기 상태 → 트리거

// ─── 국면 전환: 갈등 보도 물량 속에서도 합의 국면 감지 (2026-06-12 사고 시나리오) ──
const dealBreaks = [
  ...conflictDay,
  item('Trump announces Iran deal, markets surge', 'Fox Business'),
  item('Oil falls on signs of US-Iran peace deal', 'WSJ'),
  item('Stocks rally on Iran-de-escalation hopes', 'Market Index'),
];
const a2 = analyzeMacroShock(dealBreaks, NOW);
assert.equal(a2.fingerprint, 'iran:conflict+deal');       // 합의가 묻히지 않음
assert.equal(isMacroTrigger(a2, 'iran:conflict'), true);  // 국면 전환 → 트리거
assert.equal(isMacroTrigger(a2, 'iran:conflict+deal'), false);
// 증거에 deal 국면 헤드라인 포함 + URL 중복 없음
assert.ok(a2.evidence.some(e => /deal|peace/i.test(e.title)));
assert.equal(new Set(a2.evidence.map(e => e.url)).size, a2.evidence.length);

// ─── 'de-escalation'은 conflict로 오집계 금지 ───────────────────────────────
const deesc = analyzeMacroShock([
  item('Markets rally on Iran de-escalation', 'A'),
  item('Iran de-escalation lifts sentiment', 'B'),
  item('Oil drops as Iran de-escalation continues', 'C'),
], NOW);
assert.equal(deesc.fingerprint, 'iran:deal');

// ─── 조용한 날: 엔티티·국면 없는 일반 시황 → 트리거 없음 ────────────────────
const quiet = analyzeMacroShock([
  item('Gold steady as dollar firms'),
  item('Copper edges higher on demand hopes'),
], NOW);
assert.equal(quiet.score < MACRO_TRIGGER_SCORE, true);

// ─── 단발 기사(1건)로는 트리거 금지 + 단일 소스 금지 ────────────────────────
const single = analyzeMacroShock([item('OPEC considers output deal', 'X')], NOW);
assert.equal(isMacroTrigger(single, null), false);
const oneSource = analyzeMacroShock([
  item('Iran war intensifies', 'OnlyOne'), item('Iran war strikes continue', 'OnlyOne'),
  item('Iran war attack reported', 'OnlyOne'),
], NOW);
assert.equal(oneSource.distinctSources, 1);
assert.equal(isMacroTrigger(oneSource, null), false);

// ─── 36시간 초과 헤드라인은 무시 ────────────────────────────────────────────
const stale = analyzeMacroShock(conflictDay.map(i => ({ ...i, ts: NOW - 48 * 3600000 })), NOW);
assert.equal(stale.score, 0);

// ─── 프롬프트 섹션: 증거 우선 포함 + 트리거 시 지시문 ───────────────────────
const sec = buildMacroSection({ items: dealBreaks, analysis: a2 });
assert.ok(sec.includes('글로벌 와이어 헤드라인'));
assert.ok(sec.includes('macro_event로 반드시 작성'));
assert.ok(/deal|peace/i.test(sec));
assert.equal(buildMacroSection(null), '');
assert.equal(buildMacroSection({ items: [], analysis: quiet }), '');

console.log('✅ macro-news.test.mjs 전체 통과');
