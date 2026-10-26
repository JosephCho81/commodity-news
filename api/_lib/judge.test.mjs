// node api/_lib/judge.test.mjs — LLM 일관성 검수(judge.js) 회귀 테스트 (npm test). 네트워크 없이 callAgent를 주입한다
import assert from 'node:assert/strict';
import { buildJudgeInput, judgeIssues, judgeAndFinalize, MAX_REMOVALS, MIN_BUDGET_MS } from './judge.js';
import { finalizeReport } from './gate.js';
import { recentDays } from '../audit.js';

const report = () => ({
  date: '2026-10-26', fx: { value: 1324.45, w1_pct: -0.57, m1_pct: -2.26 },
  notices: [{ label: '국내 알루미늄 스크랩 매입가', date: '2026-10-15', max_days: 14, unit: '원', nums: ['2,000'] }],
  markets: {
    recarb: {
      market: 'recarb', name: '가탄제', direction: 'down',
      metrics: { series: [{ key: 'jm', label: '원료탄 선물', unit: '달러/톤', value: 211, date: '2026-10-23', d1_pct: 0.5, w1_pct: -4.09, m1_pct: -12.08, y_low: 146, y_high: 253, y_pos: 60 }], krw: { price_pct: -4.09, fx_pct: -1.58, krw_pct: -5.61 } },
      headline: '원료 약세', now: ['원료탄 선물이 내렸다.', '항구 코크스 재고가 부족하지 않았다.'], now_src: [[], [1]],
      why: [{ region: '중국', title: '수요 약화', text: '철강 수요가 약해졌다.', src: [1] }],
      impact: [{ area: '원가', text: '원가가 낮아진다.' }],
      outlook: { view: '재고가 감소해 현물은 천천히 내린다.', watch: [], up: null, down: null },
      sources: [{ id: 1, published: '2026-10-23T03:42:00Z', repeat: true, title: 'Mysteel午报' }],
    },
  },
  brief: { one_liner: '가탄제 약세', lead: '가탄제는 약세다.', common: [] },
});

{
  const { input, sids } = buildJudgeInput(report());
  assert.match(input, /가탄제 방향\(주간 시세 기준\): 약세 — 가탄제\(무연탄 기반[^\n]*\n  원료탄 선물: 211 달러\/톤 \(2026-10-23\) 1일 0.5% · 1주 -4.09%/);   // 검수도 해설과 같은 코드 숫자를 본다
  assert.match(input, /원\/달러 1,324.45원.*원화 강세/);
  assert.match(input, /국내 알루미늄 스크랩 매입가: 2026-10-15 기준 2,000원/);
  assert.match(input, /원화 환산 주간 변동: 달러 가격 -4.09%, 원\/달러 -1.58%\(원화 강세\) → 원화 기준 -5.61%/);
  assert.match(input, /\(recarb\.now\[1\]\) \{근거: 2026-10-23\(3일 전\) 이전 보도\} 항구 코크스 재고가 부족하지 않았다\./);
  assert.match(input, /\(recarb\.now\[0\]\) \{근거: 숫자 줄\}/);
  assert.equal(Object.values(sids).some(x => /headline|one_liner/.test(x.where)), false);   // 제목·한 줄 요약은 검수하지 않는다
  const view = Object.entries(sids).find(([, v]) => v.where === 'recarb.outlook.view')[0];
  // 모르는 번호·종류·중복은 버린다
  const issues = judgeIssues({ issues: [
    { sid: view, kind: 'contradiction', reason: '재고 부족이 없다는 문장과 모순' },
    { sid: view, kind: 'stale', reason: '중복' },
    { sid: 'S999', kind: 'stale', reason: '없는 번호' },
    { sid: 'S1', kind: 'attribution', reason: '없는 종류' },
  ] }, sids);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].where, 'recarb.outlook.view');
  // 상한
  const many = { issues: Object.keys(sids).map(sid => ({ sid, kind: 'unsupported', reason: 'x' })) };
  assert.ok(judgeIssues(many, sids).length <= MAX_REMOVALS);
}

// 검수 → 고른 문장 삭제 → 다시 집계. 시간이 모자라거나 실패하면 저장본을 그대로 둔다
{
  const full = finalizeReport(report());
  const { sids } = buildJudgeInput(full);
  const pick = Object.entries(sids).find(([, v]) => v.where === 'recarb.outlook.view')[0];
  let calls = 0;
  const callAgent = async (args) => { calls++; assert.equal(args.label, 'judge'); assert.ok(args.timeoutMs <= 60000); return { json: { issues: [{ sid: pick, kind: 'contradiction', reason: '모순' }] }, usage: { cost: { total_cost: 0.001 } } }; };
  const j = await judgeAndFinalize(full, { callAgent, budgetMs: 120000 });
  assert.equal(j.issues, 1);
  assert.equal(j.report.markets.recarb.outlook.view, null);
  assert.equal(j.report.checks.judge[0].kind, 'contradiction');
  assert.ok(j.report.checks.removed.some(x => x.id === 'C3'));
  assert.equal(j.cost_usd, 0.001);

  assert.match((await judgeAndFinalize(full, { callAgent, budgetMs: MIN_BUDGET_MS - 1 })).skipped, /남은 시간 45초/);
  assert.equal(calls, 1);                                                                  // 시간 부족이면 부르지 않는다
  const failed = await judgeAndFinalize(full, { callAgent: async () => { throw new Error('Agent HTTP 500'); }, budgetMs: 120000 });
  assert.deepEqual(failed, { error: 'Agent HTTP 500' });
  const bad = await judgeAndFinalize(full, { callAgent: async () => ({ json: null, text: 'oops' }), budgetMs: 120000 });
  assert.match(bad.error, /JSON 파싱 실패/);
  const none = await judgeAndFinalize(full, { callAgent: async () => ({ json: { issues: [] } }), budgetMs: 120000 });
  assert.equal(none.issues, 0);
  assert.deepEqual(none.report.markets, full.markets);
}

// 점검 주소의 최근 N일 — 리포트는 주말에도 만든다
assert.deepEqual(recentDays(3, Date.parse('2026-10-26T00:00:00Z')), ['2026-10-26', '2026-10-25', '2026-10-24']);

console.log('judge tests passed');
