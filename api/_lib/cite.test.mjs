// node api/_lib/cite.test.mjs — 인용 대조(G2)·기사 발행일·실적 기사 판정 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { articleSentences, numberedBody, macroLines, resolveCites, citeCheck, codeNumbersOf, isResultsArticle } from './cite.js';
import { sanitizeOutput, allowedNumbers } from './interpret.js';
import { buildMacroSection } from './macro-news.js';
import { pageDate, truePublished } from './pageDate.js';

const arts = [
  { title: '光大期货日报', body: '硅铁方面，宁夏中卫部分企业减产，供应下降。\n锰硅方面，南非矿到港成本偏高，港口锰矿价格上涨。' },
  { title: 'Hydro reports $965m Q3 EBITDA', body: 'Hydro posted record output of 1,250 kt. Prices stayed strong.' },
  { title: '철강금속신문 단신', body: '', title_only: true },
];

// 문장 번호 — 중국어는 。뒤에서 공백 없이 나눈다. 제목만 쓰는 기사는 제목이 1번 문장
assert.deepEqual(articleSentences(arts[0]), ['硅铁方面，宁夏中卫部分企业减产，供应下降。', '锰硅方面，南非矿到港成本偏高，港口锰矿价格上涨。']);
assert.equal(numberedBody(arts[1], 1), '[2-1] Hydro posted record output of 1,250 kt.\n[2-2] Prices stayed strong.');
assert.deepEqual(articleSentences(arts[2]), ['철강금속신문 단신']);
assert.deepEqual(articleSentences({ title: 'x', body: '' }), []);

// 거시 헤드라인은 buildMacroSection이 "[0-k]"를 단다
const macro = buildMacroSection({ items: [{ title: 'US eases Russian oil sanctions', source: 'Reuters', date: '2026-10-25', url: 'u1', ts: 2 }, { title: 'Oil falls', source: 'AP', date: '2026-10-25', url: 'u2', ts: 1 }], analysis: { evidence: [], score: 0 } });
assert.deepEqual(macroLines(macro), ['(2026-10-25, Reuters) US eases Russian oil sanctions', '(2026-10-25, AP) Oil falls']);

// 번호 풀이: 표기 차이("[2-1]", " 2 - 1 ")는 받고, 없는 번호는 전체 거부
assert.equal(resolveCites(['[2-1]'], arts)[0].article, 2);
assert.equal(resolveCites([' 2 - 1 '], arts)[0].sentence, 'Hydro posted record output of 1,250 kt.');
assert.equal(resolveCites(['2-9'], arts), null);
assert.equal(resolveCites(['5'], arts), null);
assert.equal(resolveCites(['0-2'], arts, macroLines(macro))[0].sentence, '(2026-10-25, AP) Oil falls');
assert.equal(resolveCites(['abc'], arts), null);

const codeNumbers = codeNumbersOf('FeSi 880 달러/톤 | 1주 -0.11%\n【근거 기사】\n[1] 기사 숫자 9,999');
assert.equal(codeNumbers.has('880'), true);
assert.equal(codeNumbers.has('9999'), false);       // 기사 숫자는 코드 숫자가 아니다
const ctx = { articles: arts, macro: macroLines(macro), codeNumbers };
assert.deepEqual(citeCheck('하이드로는 1,250kt를 생산했다.', ['2-1'], ctx), { ok: true, articles: [2] });
assert.equal(citeCheck('하이드로는 1,300kt를 생산했다.', ['2-1'], ctx).ok, false);           // 인용 문장에 없는 숫자
assert.equal(citeCheck('FeSi는 880달러다.', [], ctx).ok, true);                              // 코드 숫자만 말하는 문장
assert.equal(citeCheck('철강 수요 전망이 약해 투입재 수요가 제한됐다.', [], ctx).ok, false);   // 근거도 숫자도 없음(2026-10-26 철강 업황 원인)
assert.equal(citeCheck('FeSi는 880달러다.', [], { ...ctx, requireCite: true }).ok, false);    // 기사가 있는 날의 원인은 인용 필수
assert.equal(citeCheck('하이드로 생산 호조.', ['2'], ctx).ok, true);                          // 기사 번호만 — 기사 전체와 대조

// sanitizeOutput + 인용 대조: now {text, cite}, why는 인용 기사로 src를 바로잡는다
{
  const input = 'FeSi 880 달러/톤\n【근거 기사】\n[1-1] 硅铁减产\n[2-1] Hydro posted record output of 1,250 kt.';
  const out = {
    headline: '합금철 보합',
    now: [{ text: 'FeSi는 880달러로 보합이다.', cite: [] }, { text: '중국 수요가 회복됐다.', cite: [] }, { text: '닝샤 일부 기업이 감산했다.', cite: ['1-1'] }],
    why: [
      { region: '중국', title: '감산', text: '닝샤 FeSi 감산으로 공급이 줄었다.', src: [2], cite: ['1-1'] },
      { region: '해외', title: '생산', text: '하이드로가 1,250kt를 생산했다.', src: [2], cite: ['2-7'] },
    ],
    impact: [{ area: '원가', text: '원가 부담 완화' }],
    outlook: { view: '보합 전망', watch: [], up: '', down: '' },
  };
  const { result, dropped } = sanitizeOutput(out, allowedNumbers(input), 2, input, { articles: arts, macro: [], codeNumbers: codeNumbersOf(input) });
  assert.deepEqual(result.now, ['FeSi는 880달러로 보합이다.', '닝샤 일부 기업이 감산했다.']);
  assert.deepEqual(result.now_src, [[], [1]]);
  assert.deepEqual(result.why.map(w => w.src), [[1]]);          // LLM이 단 2번이 아니라 인용 문장의 1번
  assert.equal('cite' in result.why[0], false);
  assert.equal(dropped.filter(d => d.startsWith('G2')).length, 2);
}

// 실적 기사 — 분기 표기만 있는 시황(Q4 MJP)은 실적이 아니다(2026-10-03 오판정)
assert.equal(isResultsArticle({ title: 'Hydro reports $965m Q3 EBITDA on strong aluminium prices' }), true);
assert.equal(isResultsArticle({ title: '[이슈리포트] 동국제강, 4분기 실적 반등 전망' }), true);
assert.equal(isResultsArticle({ title: 'Ex-China aluminium market runs steadily as market awaits Q4 MJP settlement' }), false);
assert.equal(isResultsArticle({ title: '光大期货：矿钢煤焦类季报' }), false);

// 기사 페이지 발행일 — Google News 날짜보다 2일 넘게 이르면 페이지 날짜
{
  const now = Date.parse('2026-10-26T00:00:00Z');
  const html = '<meta property="article:published_time" content="2026-07-30T08:00:00+09:00">';
  assert.equal(pageDate(html, now), '2026-07-29T23:00:00.000Z');
  assert.equal(truePublished('2026-10-25T00:00:00.000Z', html, now), '2026-07-29T23:00:00.000Z');
  assert.equal(truePublished('2026-07-30T01:00:00.000Z', html, now), '2026-07-30T01:00:00.000Z');   // 차이 2일 이내 — 그대로
  assert.equal(truePublished('2026-10-25T00:00:00.000Z', '<p>no meta</p>', now), '2026-10-25T00:00:00.000Z');
  assert.equal(pageDate('"datePublished":"2030-01-01T00:00:00Z"', now), null);                        // 미래 날짜 무시
}

// 인용 대조로만 지운 문장은 재작성하지 않는다 — 숫자 위반·빈 칸일 때만 1회 재작성
{
  const { interpretMarket } = await import('./interpret.js');
  const hist = Array.from({ length: 30 }, (_, i) => ({ d: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), sf: 6000, sm: 6000, usdkrw: 1350, cnyusd: 0.14 }));
  const snap = { date: '2026-10-01', fx: {} };
  const reply = (now) => ({ json: { headline: '합금철 보합', now, why: [], impact: [{ area: '원가', text: '원가 부담 완화' }], outlook: { view: '보합 전망', watch: [], up: '', down: '' } }, usage: null, model: 'm' });
  const run = async (first) => {
    const labels = [];
    const callAgent = async ({ label }) => { labels.push(label); return label.endsWith('retry') ? reply([{ text: '840달러다.', cite: [] }]) : first; };
    const r = await interpretMarket('ferro', { history: hist, snap, articles: [], callAgent, model: 'm' });
    return { labels, r };
  };
  const g2 = await run(reply([{ text: 'FeSi 선물은 840달러다.', cite: [] }, { text: '중국 수요가 회복됐다.', cite: [] }]));
  assert.deepEqual(g2.labels, ['interpret-ferro']);
  assert.deepEqual(g2.r.now, ['FeSi 선물은 840달러다.']);
  const num = await run(reply([{ text: 'FeSi 선물은 840달러다.', cite: [] }, { text: 'FeSi는 9,999달러까지 올랐다.', cite: [] }]));
  assert.deepEqual(num.labels, ['interpret-ferro', 'interpret-ferro-retry']);    // 입력에 없는 숫자는 기존대로 재작성
}

console.log('cite tests passed');
