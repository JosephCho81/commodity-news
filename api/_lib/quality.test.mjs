// node api/_lib/quality.test.mjs — 품질 결함 판정(quality.js)·게시 게이트(gate.js) 회귀 테스트 (npm test)
// 문장 예시는 2026-10-03~26 저장 리포트 기준선 측정에서 실제로 걸린(또는 잘못 걸릴 뻔한) 문장이다.
import assert from 'node:assert/strict';
import { auditReport, auditContext, sentenceIssues, contradictsFx, fxTrend, headlineIssue, oneLinerIssue, noticeFacts, whyIssue } from './quality.js';
import { gateReport, finalizeReport, distinctItems } from './gate.js';

const FX_DOWN = { value: 1327.84, w1_pct: -1.01, m1_pct: -2.09 };   // 원/달러 하락 = 원화 강세
const series = (key, label, date) => ({ key, label, date, value: 100, w1_pct: -1, m1_pct: -2 });
const market = (k, over = {}) => ({
  market: k, name: k, direction: 'flat',
  metrics: { series: [series('rb', '철근 선물', '2026-10-23'), series('hc', '열연 선물', '2026-10-23')] },
  headline: '철강 보합', now: ['철근 선물은 456달러로 보합이다.'], why: [], impact: [{ area: '원가', text: '원가 부담이 줄었다.' }],
  outlook: { view: '보합 전망이다.', watch: [], up: null, down: null }, sources: [], dropped: [],
  ...over,
});
const base = (over = {}) => ({
  date: '2026-10-26', fx: FX_DOWN, notices: [],
  markets: { ferro: market('ferro', { metrics: { series: [series('sf', 'FeSi', '2026-10-23'), series('sm', 'SiMn', '2026-10-23')] } }), al1: market('al1'), al2: market('al2'), recarb: market('recarb'), steel: market('steel') },
  brief: { one_liner: '원자재 보합', lead: '시장은 보합이다.', common: [{ title: '환율', text: '원화 강세가 수입 원가를 낮췄다. 합금철과 알루미늄에 하방 요인이다.', markets: [] }] },
  ...over,
});

// ─── C1 환율 방향 ─────────────────────────────────────────────────────────────
assert.equal(fxTrend(FX_DOWN), 'down');
assert.equal(fxTrend({ w1_pct: 0.3, m1_pct: -1 }), null);
assert.equal(contradictsFx('원화 약세가 겹치면서 원화 기준 주간 하락폭은 달러 기준보다 커졌다.', 'down'), true);   // 2026-10-21 알루미늄 1차
assert.equal(contradictsFx('현지 가격 하락이 환율 상승 효과를 웃돌아 원화 기준 수입 가격도 약세 흐름을 보였다.', 'down'), true); // 2026-10-19
assert.equal(contradictsFx('원/달러 환율은 1주 -0.57% 하락해 원화가 강세를 보였다.', 'down'), false);
assert.equal(contradictsFx('원화 약세가 이어지면 수입 원가가 오른다.', 'down'), false);       // 조건문
assert.equal(contradictsFx('원/달러 상승은 수입 원가를 높인다.', 'down'), false);             // 일반 설명
assert.equal(contradictsFx('원화 약세가 겹쳤다.', null), false);                              // 방향이 엇갈리면 판정하지 않는다
{
  const ctx = auditContext(base());
  assert.deepEqual(sentenceIssues('원화 약세로 원가가 올랐다.', 'al1.now[2]', ctx), ['C1']);
  assert.deepEqual(sentenceIssues('원화 약세로 원가가 오를 수 있다.', 'al1.outlook.up', ctx), []);   // 시나리오 문장
}

// ─── F1 오래된 고시가 ────────────────────────────────────────────────────────
{
  const snap = {
    scrap_kr: { base_date: '2026-10-01', items: [{ item: '드로스', price: 2000 }, { item: 'SAS', price: 3650 }] },
    scrap_overseas: { us: { date: '2026-10-20', items: [{ grade: 'AL Extrusion', usd_t: 2315 }] } },
    anthracite_customs: { countries: { RU: [{ ym: '2026-07', usd_per_t: 141 }, { ym: '2026-09', usd_per_t: 178 }] } },
  };
  const notices = noticeFacts(snap);
  assert.deepEqual(notices.map(n => n.label), ['국내 알루미늄 스크랩 매입가', '미국 야드 매입가', '관세청 무연탄 러시아산 2026-07', '관세청 무연탄 러시아산 2026-09']);
  const ctx = auditContext(base({ notices }));
  assert.deepEqual(ctx.notices.map(n => n.label), ['국내 알루미늄 스크랩 매입가', '관세청 무연탄 러시아산 2026-07']);   // 25일 전 고시, 87일 전 월간 통계
  assert.deepEqual(sentenceIssues('국내 드로스 매입가는 2,000원으로 버티고 있다.', 'al2.now[2]', ctx), ['F1']);
  assert.deepEqual(sentenceIssues('10월 1일 고시에서 드로스 매입가는 2,000원이었다.', 'al2.now[2]', ctx), []);   // 고시일을 밝혔다
  assert.deepEqual(sentenceIssues('러시아산 수입단가는 141달러다.', 'recarb.impact[1]', ctx), ['F1']);
  assert.deepEqual(sentenceIssues('러시아산 수입단가는 9월 178달러다.', 'recarb.impact[1]', ctx), []);
  assert.deepEqual(sentenceIssues('미국 야드 매입가는 2,315달러다.', 'al2.now[1]', ctx), []);   // 6일 전 — 아직 현재 값
  assert.deepEqual(sentenceIssues('가격차는 2,000달러다.', 'al2.now[1]', ctx), []);            // 숫자가 같아도 통화가 다르면 다른 값
}

// ─── F2 휴장 시세 (2026-10-03~08 국경절 리포트) ───────────────────────────────
{
  const holiday = base({ date: '2026-10-07' });
  for (const k of ['ferro', 'recarb', 'steel']) for (const s of holiday.markets[k].metrics.series) s.date = '2026-09-30';
  holiday.markets.recarb.metrics.series = [series('jm', '원료탄', '2026-09-30'), series('j', '코크스', '2026-09-30')];
  const ctx = auditContext(holiday);
  assert.deepEqual(ctx.halted.recarb, ['jm', 'j']);
  assert.deepEqual(ctx.halted.al1, []);
  assert.deepEqual(sentenceIssues('중국 원료탄 선물(DCE)은 최근 1주 -5.26% 하락해 약세 흐름이 이어졌다.', 'recarb.now[0]', ctx), ['F2']);
  assert.deepEqual(sentenceIssues('열연 선물은 한 달 사이 약세였지만 최근 하루는 소폭 올라, 방향은 보합으로 정리된다.', 'steel.now[1]', ctx), ['F2']);
  assert.deepEqual(sentenceIssues('이번 주 가격이 하락했다.', 'recarb.now[1]', ctx), ['F2']);                       // 시세가 모두 멈춘 시장
  assert.deepEqual(sentenceIssues('이번 주 가격이 하락했다.', 'al1.now[1]', ctx), []);                              // 움직이는 시장
  // 걸리면 안 되는 문장(기준선 측정 중 잘못 걸렸던 것)
  assert.deepEqual(sentenceIssues('오늘 확인되는 신뢰 매체 기사는 없고, 하락은 선물 가격에서만 확인된다.', 'recarb.now[1]', ctx), []);
  assert.deepEqual(sentenceIssues('열연 선물은 1개월 기준 -3.16% 내려 있으나 최근 1주 낙폭은 -0.81%로 줄었다.', 'steel.now[1]', ctx), []);
  assert.deepEqual(sentenceIssues('FeSi는 1주 변동이 -0.45%로 좁아 방향성을 새로 보여줄 재료가 없다.', 'ferro.outlook.view', ctx), []);
  assert.deepEqual(sentenceIssues('DCE 원료탄 선물은 9월 30일 기준 1주 새 5.26% 하락했다.', 'recarb.now[0]', ctx), []);   // 날짜를 밝혔다
  assert.deepEqual(sentenceIssues('국경절 연휴로 멈춘 원료탄 선물은 최근 1주 하락했다.', 'recarb.now[0]', ctx), []);
  assert.deepEqual(sentenceIssues('원료탄이 최근 1주 하락해도 반등할 수 있다.', 'recarb.now[0]', ctx), []);              // 조건
  assert.deepEqual(sentenceIssues('원료탄 선물은 최근 1주 하락했다.', 'brief.lead', ctx), ['F2']);
  assert.deepEqual(sentenceIssues('코크스 선물은 하루 1일 0.5% 상승했다.', 'recarb.now[0]', ctx), ['F2']);   // "1일"은 날짜가 아니다
}

// ─── C2 방향 판정 ────────────────────────────────────────────────────────────
assert.equal(headlineIssue({ direction: 'down', headline: '알루미늄 강세 전환' }), true);
assert.equal(headlineIssue({ direction: 'down', headline: '달러 강세와 공급 우려 완화로 LME 알루미늄이 1년 범위 하단까지 밀렸다' }), false);   // 2026-10-03 통화 강세
assert.equal(headlineIssue({ direction: 'flat', headline: 'LME 약세권·SHFE 강세로 알루미늄 보합' }), false);
{
  const m = base().markets;
  m.recarb.direction = 'down';
  m.al1.direction = 'down';
  assert.equal(oneLinerIssue('가탄제 강세, 나머지 보합', m), true);
  assert.equal(oneLinerIssue('알루미늄·원료탄 약세, 나머지는 보합', m), false);
  assert.equal(oneLinerIssue('합금철 강세', m), true);                  // 보합인데 강세
  assert.equal(oneLinerIssue('알루미늄 약세', m), false);              // 1차가 약세 — 2차가 보합이어도 맞다
  assert.equal(oneLinerIssue('원화 강세 속 원자재 보합', m), false);
  assert.equal(oneLinerIssue('중국 철강 수요 약세 속 원자재 보합', m), false);       // 수요 약세는 가격 방향이 아니다
}

// ─── G2 원인 근거 ────────────────────────────────────────────────────────────
assert.equal(whyIssue({ title: '철강 선물의 월간 약세', text: '철강 제품 가격 기대가 약해지면서 수요 전망도 제한됐다.', src: [] }, { sources: [] }), 'G2');   // 2026-10-26 철강
assert.equal(whyIssue({ title: '원가', text: '원료탄 선물이 1주 -4.09% 내렸다.', src: [] }, { sources: [] }), null);
assert.equal(whyIssue({ title: '감산', text: '감산했다.', src: [] }, { sources: [{}] }), 'G2');
assert.equal(whyIssue({ title: '감산', text: '감산했다.', src: [1] }, { sources: [{}] }), null);

// ─── 집계 ────────────────────────────────────────────────────────────────────
{
  const r = base();
  r.markets.al1.sources = [
    { published: '2026-10-24T07:37:00Z', title: 'Hydro reports $965m Q3 EBITDA on strong aluminium prices' },
    { published: '2026-10-23T19:00:00Z', title: 'US aluminium industry highlights domestic smelting' },
  ];
  r.markets.al1.why = [{ title: '노르웨이 생산 증가', text: '기록적 생산.', src: [1] }, { title: '관세', text: '관세 인상.', src: [1] }];
  r.markets.al2.sources = [{ published: '2026-10-23T05:24:00Z', repeat: true, title: 'ADC12 prices consolidate' }];
  r.markets.al2.why = [{ title: '하류 수요 부진', text: '수요가 부진했다.', src: [1] }];
  r.markets.al1.now = ['원화 약세가 겹치면서 하락폭이 커졌다.'];
  r.markets.al2.outlook.watch = ['SHFE 2차 알루미늄 3,463 USD/톤'];
  r.markets.recarb.dropped = ['G2 now: 근거 문장 번호 없음 — x', 'now: 숫자'];
  r.brief.common.push({ title: '환율', text: '짧다' });
  const q = auditReport(r);
  assert.deepEqual(q.by_id, { C1: 1, S2: 1, F4: 2, G1: 1, F3: 1, S1: 1 });   // 같은 칸의 같은 결함은 한 번
  assert.deepEqual(q.counts, { H: 1, M: 4, L: 2 });
  assert.equal(q.cite_dropped, 1);
  const failed = base();
  failed.markets.ferro = { market: 'ferro', error: 'Agent HTTP 401' };
  failed.brief = { error: 'x' };
  assert.deepEqual(auditReport(failed).by_id, { S3: 2 });
}

// ─── 게시 게이트 ─────────────────────────────────────────────────────────────
{
  const r = base();
  r.markets.al1.direction = 'down';
  r.markets.al1.headline = '알루미늄 강세 전환';
  r.markets.al1.now = ['LME는 3,043달러다.', '원화 약세가 겹치면서 하락폭이 커졌다.'];
  r.markets.al1.now_src = [[], [1]];
  r.markets.al1.outlook.view = '원화 약세로 원가가 올랐다. 이에 따라 입찰 단가가 오를 수 있다. 보합 전망이다.';
  r.markets.al1.impact = [{ area: '원가', text: '원화 약세가 원가를 높였다. 협상 폭을 점검한다.' }, { area: '입찰', text: '입찰 단가 협상 폭이 좁다.' }];
  r.markets.steel.why = [{ region: '해외', title: '월간 약세', text: '수요 전망이 제한됐다.', src: [] }];
  r.brief.one_liner = '알루미늄 강세';
  r.brief.common.push({ title: '환율', text: '원화 강세가 수입 원가를 낮췄다. 합금철과 알루미늄에 하방 요인이다.' });
  const { report: g, removed } = gateReport(r);
  assert.equal(g.markets.al1.headline, '알루미늄 1차 약세');                                  // 코드 방향 판정으로 대체
  assert.deepEqual(g.markets.al1.now, ['LME는 3,043달러다.']);
  assert.deepEqual(g.markets.al1.now_src, [[]]);                                             // now와 함께 지운다
  assert.equal(g.markets.al1.outlook.view, '입찰 단가가 오를 수 있다. 보합 전망이다.');       // 문단은 그 문장만, 받는 접속어도 뗀다
  assert.deepEqual(g.markets.al1.impact.map(i => i.area), ['입찰']);                         // 짧은 항목은 통째로
  assert.deepEqual(g.markets.steel.why, []);                                                 // G2
  assert.equal(g.brief.one_liner, '합금철 보합 · 알루미늄 1차 약세 · 알루미늄 2차 보합 · 가탄제 보합 · 철강 업황 보합');
  assert.equal(g.brief.common.length, 1);                                                    // 제목 중복
  assert.deepEqual([...new Set(removed.map(x => x.id))].sort(), ['C1', 'C2', 'G2']);
  assert.equal(r.markets.al1.now.length, 2);                                                 // 원본은 건드리지 않는다
  // 다시 거치면(검수 뒤) 지운 기록에 이어 붙인다
  const again = gateReport(g, (s) => (s === 'LME는 3,043달러다.' ? ['C3'] : []));
  assert.deepEqual(again.report.markets.al1.now, []);
  assert.equal(again.report.checks.removed.length, removed.length + 1);
  // 저장본에는 남은 결함 집계가 붙는다 — 게이트를 거친 뒤라 H가 남지 않는다
  const f = finalizeReport(r);
  assert.equal(f.quality.counts.H, 0);
  assert.equal(f.quality.removed, removed.length);
}
assert.deepEqual(distinctItems([{ title: 'a', text: '스무 자가 넘는 충분히 긴 공통 요인 설명이다.' }, { title: 'a ', text: '스무 자가 넘는 다른 공통 요인 설명이기도 하다.' }, { title: 'b', text: '짧다' }]).length, 1);

console.log('quality tests passed');
