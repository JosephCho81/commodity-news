// node api/_lib/explore.test.mjs — 세계 동향 탐색 회귀 (npm test). 신호 파서(2026-11-17 실제 응답 꼴), 원문 대조, 문장 검증, 실행 흐름. 네트워크 없음.
// glove-news 첫 실행 사고 5건(깨진 엔티티 중단, link 칸에 주소, 1만1000 느슨한 대조, 진행 중 사안 덮어쓰기, 영어 날짜만 있는 공식 공지)을 여기서 재현한다.
import assert from 'node:assert/strict';
import { collectSignals, parseEurostat, parseFedReg, parseFred, parseLmeStock, parseRssNotices, parseSse, parseWorldsteel, signalLines, worldsteelLink } from './signals.js';
import { carryFirstSeen, checkSource, dateInText, koNumbersBacked, localizeUsd, sanitizeIssues, trustedHost, verifyFound } from './exploreVerify.js';
import { publicWorld, runExplore, writeInput } from './explore.js';
import { LENSES, WRITE_SCHEMA } from './exploreLenses.js';
import { auditContext, auditReport, reportTexts } from './quality.js';
import { decodeEntities } from './rss-news.js';

const TODAY = '2026-11-17';

// ─── 신호 파서 ───────────────────────────────────────────────────────────────
const WS_PAGE = '<p>World crude steel production for the 70 countries reporting to the World Steel Association (worldsteel) was 142.4 million tonnes (Mt) in September 2026, a 0.2% decrease compared to September 2025.</p>'
  + '<p>China produced 73.6 Mt in September 2026, up 0.1% on September 2025. India produced 13.9 Mt, up 1.9%. South Korea produced 5.2 Mt, up 3.6%.</p>';
const ws = parseWorldsteel(WS_PAGE);
assert.deepEqual(ws.map(s => [s.key, s.value, s.yoy, s.when]), [['steel_world', 142.4, -0.2, '2026년 9월'], ['steel_cn', 73.6, 0.1, '2026년 9월'], ['steel_kr', 5.2, 3.6, '2026년 9월']]);
assert.deepEqual(parseWorldsteel('<p>maintenance</p>'), []);
assert.equal(worldsteelLink('<item><title>Steelie Awards</title><link>https://worldsteel.org/a/</link></item><item><title>September 2026 crude steel production</title><link>https://worldsteel.org/media/press-releases/2026/september-2026-crude-steel-production/</link></item>'),
  'https://worldsteel.org/media/press-releases/2026/september-2026-crude-steel-production/');

const LME = ['16. November 2026|221,900', '13. November 2026|224,150', '12. November 2026|226,350', '11. November 2026|226,000', '10. November 2026|226,500', '09. November 2026|226,975', '06. November 2026|227,100']
  .map(r => r.split('|')).map(([d, v]) => `<tr><td >${d}</td><td >${v}</td><td >3,332.00</td><td class="last">3,020.00</td></tr>`).join('\n');
const st = parseLmeStock(`<table>${LME}</table><table>${LME}</table>`); // 같은 표가 두 번 와도 중복 행을 세지 않는다
assert.deepEqual([st.value, st.prev, st.prev_label, st.when], [221900, 226975, '11/9', '11/16']);
assert.equal(parseLmeStock('<table></table>'), null);

const FRED_META = { key: 'us_steel_ip', group: 'steel', label: '미국 철강 생산지수', unit: '', round: (v) => Math.round(v * 10) / 10, desc: 'x' };
const f = parseFred('observation_date,IPG3311A2S\n2026-07-01,110.2\n2026-08-01,111.4321\n2026-09-01,113.0701\n', FRED_META);
assert.deepEqual([f.value, f.prev, f.when], [113.1, 111.4, '2026년 9월']);
assert.equal(parseFred('observation_date,X\n2026-09-01,.\n', FRED_META), null); // 결측('.')은 값으로 쓰지 않는다

const EU = { dimension: { time: { category: { index: { '2026-07': 0, '2026-08': 1, '2026-09': 2 } } } }, value: { 0: 83.5, 1: 81.8 } };
const eu = parseEurostat(EU, { key: 'eu_steel_ip', label: 'EU 철강 생산지수', unit: '' });
assert.deepEqual([eu.value, eu.prev, eu.when], [81.8, 83.5, '2026년 8월']); // 값이 없는 최신 달은 건너뛴다

const SSE = { data: { currentDate: '2026-11-16', lastDate: '2026-11-13', lineDataList: [{ dataItemTypeName: 'CBCFI_T', currentContent: 946.27, lastContent: 932.6 }, { dataItemTypeName: 'X', currentContent: 1 }] } };
const cb = parseSse(SSE, { code: 'CBCFI_T', key: 'cbcfi', label: '중국 연안 석탄 운임지수', unit: '' });
assert.deepEqual([cb.value, cb.prev, cb.when, 'code' in cb], [946.27, 932.6, '11/16', false]);
assert.equal(parseSse({ data: { lineDataList: [] } }, { code: 'SCFI_T' }), null);

assert.deepEqual(parseFedReg({ results: [{ title: 'Ripe Olives From Spain', publication_date: '2026-11-16' }, { title: 'Common Alloy Aluminum Sheet From the Kingdom of Bahrain: Final Results', publication_date: '2026-11-16' }] }).map(n => n.title.slice(0, 12)), ['Common Alloy']);
assert.equal(parseRssNotices('<item><title>Old</title><pubDate>Mon, 20 Jul 2009 18:28:39 +0000</pubDate></item><item><title>Readout of call</title><pubDate>Fri, 13 Nov 2026 21:27:00 +0000</pubDate></item>', TODAY, 'USTR').length, 1);
assert.match(signalLines([ws[0], st])[0], /142\.4 백만 톤 \(2026년 9월, 전년 같은 달 대비 -0\.2%\)/);
assert.match(signalLines([ws[0], st])[1], /221,900 톤 \(11\/16, 11\/9 226,975\)/);

// 한 소스가 죽어도 나머지는 나온다, 실패는 null(추정으로 채우지 않는다)
{
  const r = await collectSignals({ today: TODAY, fetchRaw: async (url) => { if (url.includes('westmetall')) return `<table>${LME}</table>`; throw new Error('HTTP 500'); } });
  assert.deepEqual(r.signals.map(s => s.key), ['lme_al_stock']);
  assert.ok(r.errors.length >= 10);
  assert.deepEqual(r.notices, []);
}

// ─── 원문 대조 ───────────────────────────────────────────────────────────────
const P = [
  'Inner Mongolia ordered ferrosilicon smelters in Ordos to cut power use by 30% from November 20, the regional energy bureau said on Monday.',
  'The curbs affect about 1.2 million tonnes of annual ferrosilicon capacity, according to the notice.',
  'Traders said export offers for 72% ferrosilicon rose to $1,180 per tonne FOB Tianjin this week.',
];
const page = ({ date = '2026-11-16', body = P, title = 'Inner Mongolia orders ferrosilicon power cuts' } = {}) =>
  `<html><head><title>${title}</title>${date ? `<meta property="article:published_time" content="${date}T08:00:00Z">` : ''}</head><body>${body.map(p => `<p>${p}</p>`).join('')}<script>var x = "not text";</script></body></html>`;
{
  const ok = checkSource({ url: 'https://example-metal.com/a', quote: P[1], claimed: '2026-11-16' }, page(), { today: TODAY });
  assert.equal(ok.ok, true);
  assert.equal(/** @type {any} */ (ok).published, '2026-11-16');
  const bad = (src, html, o = {}) => { const r = checkSource(src, html, { today: TODAY, ...o }); assert.equal(r.ok, false); return /** @type {any} */ (r).reason; };
  // 모델이 문장을 바꿔 인용하면 버린다(glove-news 탈락 사유 1위)
  assert.match(bad({ url: 'https://example-metal.com/a', quote: 'The curbs affect roughly 1.2 million tonnes of annual ferrosilicon capacity.' }, page()), /인용문/);
  assert.match(bad({ url: 'https://example-metal.com/a', quote: P[1] }, page({ date: '2026-10-01' })), /최근/);
  assert.match(bad({ url: 'https://example-metal.com/a', quote: P[1] }, page({ date: null })), /발행일 확인 불가/);
  assert.match(bad({ url: 'https://www.openpr.com/a', quote: P[1] }, page()), /제외 매체/);
  assert.match(bad({ url: 'https://example-metal.com/a', quote: P[1] }, page({ title: 'Ferrosilicon Market Size to Reach $20B by 2032' })), /홍보/);
  assert.match(bad({ url: 'https://example-metal.com/report.pdf', quote: P[1] }, page()), /주소/);
  // 페이지에 날짜가 없으면 검색 색인 날짜로 — LLM이 말한 날짜만으로는 받지 않는다
  assert.equal(checkSource({ url: 'https://example-metal.com/a', quote: P[1], claimed: '2026-11-15' }, page({ date: null }), { today: TODAY, searchDate: '2026-11-15' }).ok, true);
}

// 깨진 숫자 엔티티 — 해독이 던지지 않고 그 표기만 그대로 둔다(glove-news 2026-11-17 첫 실행 전체 중단). 근거 기사 수집도 같은 함수
assert.equal(decodeEntities('a &#2013266080; b &#x7800000a; c &#65;&#x42;'), 'a &#2013266080; b &#x7800000a; c AB');
{
  const html = page({ body: [...P, 'Broken entity &#2013266080; stays as written, while &#65; decodes in this sentence.'] });
  const r = checkSource({ url: 'https://example-metal.com/a', quote: P[1], claimed: '2026-11-16' }, html, { today: TODAY });
  assert.equal(r.ok, true);
  assert.match(/** @type {any} */ (r).body, /&#2013266080; stays as written, while A decodes/);
}

// 발행일 — 메타가 없는 공식 공지는 LLM이 말한 날짜가 본문에 적혀 있을 때만(영어·중국어 날짜 포함)
for (const t of ['13 November 2026', 'Published: November 13, 2026', 'Nov. 13, 2026', '2026.11.13', '2026년 11월 13일', '2026年11月13日', '2026-11-13']) assert.equal(dateInText('2026-11-13', t), true, t);
for (const t of ['3 November 2026', '13 November 2025', '2026-11-130', 'November 2026']) assert.equal(dateInText('2026-11-13', t), false, t);
{
  const html = page({ date: null, body: ['13 November 2026', ...P] });
  assert.equal(/** @type {any} */ (checkSource({ url: 'https://www.mofcom.gov.cn/x', quote: P[1], claimed: '2026-11-13' }, html, { today: TODAY })).published, '2026-11-13');
  assert.equal(checkSource({ url: 'https://www.mofcom.gov.cn/x', quote: P[1], claimed: '2026-11-12' }, html, { today: TODAY }).ok, false);
}

// 한 곳 보도는 공식·통신사·근거 매체만 — 그 밖은 다른 사이트 한 곳이 더 있어야
assert.equal(trustedHost('www.mofcom.gov.cn'), true);
assert.equal(trustedHost('www.reuters.com'), true);
assert.equal(trustedHost('www.alcircle.com'), true);   // evidence.js 근거 매체
assert.equal(trustedHost('gmk.center'), true);
assert.equal(trustedHost('example-metal.com'), false);
{
  const item = { url: 'https://example-metal.com/a', quote: P[1], published: '2026-11-16', second_url: '', second_quote: '' };
  const pages = { 'https://example-metal.com/a': page(), 'https://other-paper.co.kr/b': page(), 'https://m.example-metal.com/c': page(), 'https://www.reuters.com/x': page() };
  assert.match(verifyFound(item, { pages, today: TODAY }).error, /한 곳 보도/);
  assert.match(verifyFound({ ...item, second_url: 'https://m.example-metal.com/c', second_quote: P[2] }, { pages, today: TODAY }).error, /같은 사이트/);
  assert.ok(verifyFound({ ...item, second_url: 'https://other-paper.co.kr/b', second_quote: P[2] }, { pages, today: TODAY }).article);
  assert.ok(verifyFound({ ...item, url: 'https://www.reuters.com/x' }, { pages, today: TODAY }).article);
  assert.match(verifyFound({ ...item, url: 'https://gone.example/x' }, { pages, today: TODAY }).error, /원문 열기 실패/);
  // 첫 주소가 막히면(로이터 자동 접속 차단 — 운영 첫 실행) 두 번째 매체가 같은 대조를 통과하고 공식·통신사·근거 매체일 때만 받는다
  const blocked = { ...item, url: 'https://blocked.example/x' };
  assert.equal(verifyFound({ ...blocked, second_url: 'https://www.reuters.com/x', second_quote: P[2] }, { pages, today: TODAY }).article.url, 'https://www.reuters.com/x');
  assert.match(verifyFound({ ...blocked, second_url: 'https://other-paper.co.kr/b', second_quote: P[2] }, { pages, today: TODAY }).error, /한 곳 보도/);
  assert.match(verifyFound({ ...blocked, second_url: 'https://www.reuters.com/x', second_quote: 'Traders said offers rose sharply this week in Tianjin.' }, { pages, today: TODAY }).error, /두 번째 인용문/);
}
assert.equal(localizeUsd('수출은 999,000 mt, 세계 생산은 142.4 Mt였다.'), '수출은 999,000톤, 세계 생산은 142.4백만 톤였다.');

// ─── 작성 검증 ───────────────────────────────────────────────────────────────
const ART = [
  { title: 'Inner Mongolia orders ferrosilicon power cuts', url: 'https://www.reuters.com/x', source: 'www.reuters.com', published: '2026-11-16', body: P.join('\n') },
  { title: '宁夏硅铁企业减产', url: 'https://finance.sina.com.cn/y', source: 'finance.sina.com.cn', published: '2026-11-15', body: '宁夏地区硅铁企业本周减产，涉及产能约4500万吨。\n铝锭社会库存为1.4亿吨。' },
];
const issue = (o = {}) => ({
  article: 1, title: '내몽골, 페로실리콘 제련소 전력 감축', region: '중국 내몽골', category: 'supply', markets: ['ferro'], uses: '전기로 제강 탈산', effect: 'up', scale: 'medium',
  what: [{ text: '내몽골 에너지국은 월요일 오르도스의 페로실리콘 제련소에 11월 20일부터 전력 사용을 30% 줄이라고 지시했다.', cite: ['1-1'] }],
  relation: '페로실리콘은 제강 공정에서 탈산제로 쓰여 국내 제강사가 꾸준히 수입한다.', reach: '중국산 수출 물량이 줄면 국내 수입 가격에도 영향이 닿을 수 있다.', outlook: '감축이 길어지면 수출 제안 가격이 오를 것으로 예상된다.', ...o,
});
const run = (issues, ctx = auditContext({ date: TODAY })) => sanitizeIssues({ issues }, { articles: ART, input: writeInput(TODAY, ART), today: TODAY, ctx });
{
  const ok = run([issue()]);
  assert.equal(ok.issues.length, 1, ok.dropped.join(' | '));
  assert.deepEqual([ok.issues[0].published, ok.issues[0].markets, ok.issues[0].relation.length > 0], ['2026-11-16', ['ferro'], true]);
  // 기사에 없는 숫자, 없는 근거 번호, 다른 기사 인용, 근거 없음 → 사실 문장 탈락 → 사안 탈락
  for (const what of [
    [{ text: '내몽골 에너지국은 전력 사용을 40% 줄이라고 지시했다.', cite: ['1-1'] }],
    [{ text: '내몽골 에너지국은 전력 사용을 30% 줄이라고 지시했다.', cite: ['1-9'] }],
    [{ text: '닝샤 지역 페로실리콘 업체가 이번 주 감산했다.', cite: ['2-1'] }],
    [{ text: '내몽골 에너지국은 전력 사용을 줄이라고 지시했다.', cite: [] }],
  ]) assert.equal(run([issue({ what })]).issues.length, 0, JSON.stringify(what));
  assert.match(run([issue({ what: [{ text: '내몽골 에너지국은 전력 사용을 40% 줄이라고 지시했다.', cite: ['1-1'] }] })]).dropped.join(' '), /단위 붙은 작은 수/);
  // 추론 문장: 숫자·단정·구매 지시·모른다는 문장은 그 문장만 지운다
  const r = run([issue({ relation: '페로실리콘 수요가 30% 늘어난다.', reach: '국내 수입 가격이 오른다.', outlook: '지금 재고를 확보해야 할 것으로 보인다. 영향은 제한적일 전망이다.' })]);
  assert.deepEqual([r.issues[0].relation, r.issues[0].reach, r.issues[0].outlook], ['', '', '영향은 제한적일 전망이다.']);
  assert.equal(run([issue({ relation: '', reach: '가격이 오른다.', outlook: '구매 유리한 시점으로 보인다. 확인되지 않는 것으로 보인다.' })]).issues.length, 0); // 분석 문장 0 → 사안 없음
  assert.equal(run([issue({ article: 7 })]).issues.length, 0);
  // 위안 표기·지난 날짜 예고는 리포트와 같이 버린다
  assert.equal(run([issue({ what: [{ text: '내몽골 에너지국은 전력 사용을 30% 줄이라고 지시했다고 위안화 기준으로 밝혔다.', cite: ['1-1'] }] })]).issues.length, 0);
  assert.equal(run([issue({ outlook: '11월 10일 회의를 앞두고 감축이 이어질 전망이다.', reach: '', relation: '' })]).issues.length, 0);
}
// 관계 칸에 주소를 넣으면 버린다(glove-news: 칸 이름 link → 모델이 주소를 넣어 7건 전부 탈락). 칸 이름 자체도 relation
assert.equal(run([issue({ relation: 'https://www.reuters.com/x' })]).issues[0].relation, '');
assert.ok(WRITE_SCHEMA.properties.issues.items.required.includes('relation'));
assert.ok(!('link' in WRITE_SCHEMA.properties.issues.items.properties));
{
  const r = run([issue({ relation: '제련소 감산은 캔·전선에 쓰이는 1차 알루미늄 공급을 줄인다.', reach: '2차 알루미늄 원료 수급으로 번질 수 있다.', outlook: '감산이 3% 넘게 이어질 전망이다.' })]);
  assert.deepEqual([!!r.issues[0].relation, !!r.issues[0].reach, r.issues[0].outlook], [true, true, '']); // 품목 이름은 숫자가 아니다, 3%는 숫자
}

// 만·억 단위 수 — 풀어 쓴 값이 인용 문장에 있어야. 원문이 万·亿로 쓴 수는 풀어서 비교, 영어 million을 만으로 바꾼 수는 환산이라 탈락
{
  const arts = [{ body: ['More than 11 000 workers and 5400 trucks were idled.', 'The curbs affect about 1.2 million tonnes of capacity.', 'Exports reached 45 million tonnes, worth $2.5 billion.', '宁夏地区硅铁企业本周减产，涉及产能约4500万吨。', '铝锭库存为1.4亿吨，同比增加1亿4000万吨。'].join('\n') }];
  assert.equal(koNumbersBacked('노동자 1만1000명이 일손을 놓았고 트럭 5400대가 멈췄다.', ['1-1'], arts), true);
  assert.equal(koNumbersBacked('노동자 2만1000명이 일손을 놓았다.', ['1-1'], arts), false);
  assert.equal(koNumbersBacked('생산능력 약 4500만 톤이 감산 대상이다.', ['1-4'], arts), true);   // 万 원문
  assert.equal(koNumbersBacked('재고는 1.4억 톤이었고 1억4000만 톤 늘었다.', ['1-5'], arts), true); // 亿 원문, 이어 붙은 수
  assert.equal(koNumbersBacked('재고는 1억4000만 톤 늘었다.', ['1-4'], arts), false);
  assert.equal(koNumbersBacked('수출은 4,500만 톤에 달했다.', ['1-3'], arts), false);   // 45 million → 4,500만: 환산
  assert.equal(koNumbersBacked('수출은 25억 달러어치였다.', ['1-3'], arts), false);     // 2.5 billion → 25억: 환산
  assert.equal(koNumbersBacked('수출은 45백만 톤, 2.5십억 달러에 달했다.', ['1-3'], arts), true);
  assert.equal(koNumbersBacked('수출은 54백만 톤에 달했다.', ['1-3'], arts), false);    // 1~2자리 수도 규모어와 함께면 대조한다
  assert.equal(koNumbersBacked('약 1.2백만 톤 생산능력이 영향을 받는다.', ['1-2'], arts), true);
  assert.equal(koNumbersBacked('감산이 6개월 이어졌다.', ['1-1'], arts), true);
  // 사안 단위로도 걸린다
  const r = run([issue({ what: [{ text: '감축 대상은 연간 페로실리콘 생산능력 약 120만 톤이다.', cite: ['1-2'] }] })]);
  assert.equal(r.issues.length, 0);
  assert.match(r.dropped.join(' '), /없는 숫자 120/);
  assert.equal(run([issue({ what: [{ text: '감축 대상은 연간 페로실리콘 생산능력 약 1.2백만 톤이다.', cite: ['1-2'] }] })]).issues.length, 1);
  assert.equal(run([issue({ article: 2, what: [{ text: '닝샤 지역 페로실리콘 업체가 이번 주 생산능력 약 4500만 톤 규모로 감산했다.', cite: ['2-1'] }] })]).issues.length, 1);
}
// 달러 표기 통일(S2) — 값은 그대로, 단위 대조는 원문의 $와 맞는다
assert.equal(localizeUsd('수출 제안가는 톤당 US$1,180로 올랐다. 톤당 1,180 USD, USD/톤'), '수출 제안가는 톤당 1,180달러로 올랐다. 톤당 1,180달러, 달러/톤');
{
  const r = run([issue({ what: [{ text: '중개상들은 이번 주 72% 페로실리콘 수출 제안가가 톤당 $1,180로 올랐다고 전했다.', cite: ['1-3'] }] })]);
  assert.equal(r.issues.length, 1, r.dropped.join(' | '));
  assert.match(r.issues[0].what[0], /1,180달러/);
  assert.equal(run([issue({ what: [{ text: '수출 제안가가 톤당 1,180원으로 올랐다.', cite: ['1-3'] }] })]).issues.length, 0); // 달러를 원으로 바꾼 단위
}
// 게시 게이트 H — 원/달러 방향과 반대 서술(C1)은 리포트와 같은 함수로 버린다
{
  const ctx = auditContext({ date: TODAY, fx: { w1_pct: -0.9, m1_pct: -0.5 } }); // 원화 강세
  const r = run([issue({ reach: '원화 약세로 국내 수입 가격 부담이 커질 수 있다.', outlook: '', relation: '' })], ctx);
  assert.equal(r.issues.length, 0);
  assert.match(r.dropped.join(' '), /게시 게이트/);
}
// 규모 순 정렬·화면용 필드(근거는 화면에 내지 않는다)·감사 문장
{
  const big = issue({ article: 2, title: '닝샤 페로실리콘 감산', scale: 'large', what: [{ text: '닝샤 지역 페로실리콘 업체가 이번 주 감산했다.', cite: ['2-1'] }] });
  const r = run([issue(), big]);
  assert.deepEqual(r.issues.map(i => i.scale), ['large', 'medium']);
  const pub = publicWorld({ date: TODAY, signals: [], issues: carryFirstSeen(r.issues, [{ url: 'https://www.reuters.com/x', first_seen: '2026-11-15' }], TODAY) });
  assert.equal(pub.issues[1].first_seen, '2026-11-15');
  assert.equal(pub.issues[0].first_seen, TODAY);
  assert.ok(pub.issues.every(i => !('url' in i) && !('source' in i) && !('src_title' in i)));
  assert.equal(publicWorld({ date: TODAY, signals: [], issues: [] }), null);
  assert.ok(reportTexts({ world: pub }).some(t => t.where === 'world.issues[0].relation'));
  // 감사: 세계 동향의 USD 표기도 S2로 센다
  const q = auditReport({ date: TODAY, world: { issues: [{ ...pub.issues[0], what: ['가격은 USD 1,180이다.'] }] } });
  assert.ok(q.defects.some(d => d.id === 'S2' && d.where.startsWith('world.')));
}
// 낯선 출력 하나가 던져도 그 사안만 탈락
{
  const r = run([{ ...issue(), what: [{ text: { bad: true }, cite: ['1-1'] }] }, issue()]);
  assert.equal(r.issues.length, 1);
}

// ─── 실행 흐름 ───────────────────────────────────────────────────────────────
{
  const calls = [];
  const callAgent = async (o) => {
    calls.push(o.label);
    if (o.label === 'explore-supply') throw new Error('Agent HTTP 500');
    if (o.label === 'explore-write') return { json: { issues: [issue()] }, usage: { cost: { total_cost: 0.03 } } };
    assert.equal(o.maxSteps > 1, true);
    assert.equal(o.tools[0].type, 'web_search');
    assert.match(o.input, /【신호】/);
    const items = o.label === 'explore-steel' ? [{ url: 'https://www.reuters.com/x', quote: P[1], published: '2026-11-16', second_url: '', second_quote: '' }]
      : o.label === 'explore-policy' ? [{ url: 'https://blog.example/z', quote: P[1], published: '2026-11-16', second_url: '', second_quote: '' }] : [];
    return { json: { items }, usage: { cost: { total_cost: 0.02 } }, search: [] };
  };
  const fetchText = async (u) => { if (u.includes('reuters.com') || u.includes('blog.example')) return page(); throw new Error('HTTP 404'); };
  const signalsFn = async () => ({ signals: [ws[0]], notices: [], errors: [] });
  const w = await runExplore({ date: TODAY, callAgent, fetchText, ctx: auditContext({ date: TODAY }), signalsFn });
  assert.equal(calls.filter(c => c !== 'explore-write').length, LENSES.length);
  assert.equal(LENSES.length, 5);
  assert.equal(LENSES.at(-1).key, 'free');
  assert.equal(w.issues.length, 1);
  assert.equal(w.issues_date, TODAY);
  assert.equal(w.signals[0].key, 'steel_world');
  assert.match(w.log.rejected.join(' '), /한 곳 보도/);
  assert.match(w.log.lenses.supply.error, /500/);
  assert.equal(w.log.cost_usd, 0.11);

  // 사안이 없는 날은 직전 사안을 발표일과 함께 유지
  const none = await runExplore({ date: '2026-11-18', callAgent: async () => ({ json: { items: [] }, usage: null, search: [] }), fetchText, ctx: auditContext({ date: '2026-11-18' }), signalsFn, previous: w });
  assert.equal(none.issues.length, 1);
  assert.equal(none.issues_date, TODAY);
  // 신호 수집이 통째로 실패해도 탐색은 돌고, 신호판은 직전 값
  const nosig = await runExplore({ date: '2026-11-18', callAgent, fetchText, ctx: auditContext({ date: '2026-11-18' }), signalsFn: async () => { throw new Error('boom'); }, previous: w });
  assert.equal(nosig.signals[0].key, 'steel_world');
  assert.match(nosig.log.signal_errors.join(' '), /boom/);

  // 새 사안이 나온 날에도 최근 다룬 사안은 뒤에 남는다(처음 다룬 날부터 3일), 그보다 오래된 것은 빠진다
  const old = (title, first_seen) => ({ ...w.issues[0], title, url: `https://www.reuters.com/${title}`, first_seen });
  const next = await runExplore({ date: '2026-11-18', callAgent, fetchText, ctx: auditContext({ date: '2026-11-18' }), signalsFn,
    previous: { issues: [old('어제 사안', '2026-11-17'), old('오래된 사안', '2026-11-13')] } });
  assert.deepEqual(next.issues.map(i => i.title), ['내몽골, 페로실리콘 제련소 전력 감축', '어제 사안']);
  assert.equal(next.issues[1].first_seen, '2026-11-17');

  // 작성 출력이 깨져도 리포트와 무관하게 끝나고 직전 사안 유지
  const broken = await runExplore({ date: '2026-11-18', callAgent: async (o) => (o.label === 'explore-write' ? { json: null, usage: null } : callAgent(o)), fetchText, ctx: auditContext({ date: '2026-11-18' }), signalsFn, previous: w });
  assert.match(broken.log.write_error, /작성 출력/);
  assert.equal(broken.issues_date, TODAY);
}

console.log('explore tests passed');
