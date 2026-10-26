// api/_lib/judge.js — LLM 일관성 검수(docs/quality.md C3). 완성된 리포트의 문장을 번호로 넘기고, 문제 문장의 번호만 받는다.
// 문장을 고쳐 쓰지 않는다 — 고른 문장은 게시 게이트(gate.js)가 지운다. 실패·시간 부족이면 검수 없이 저장본을 유지한다.
import { MARKET_KEYS, reportTexts, sentencesOf } from './quality.js';
import { DIR_KO, FOCUS, fxDirectionLine, krwLine } from './interpret.js';
import { isHalted } from './market-metrics.js';
import { isResultsArticle } from './cite.js';
import { finalizeReport } from './gate.js';

export const KINDS = ['contradiction', 'stale', 'unsupported'];
// 한 번에 지울 수 있는 문장 수 상한 — 검수 LLM의 과잉 판정이 리포트를 비우지 않게.
// 코드 숫자를 주지 않았던 첫 시험 실행(2026-10-26)에서 맞는 문장 8개를 골랐다 — glove-news(8)보다 낮게 둔다
export const MAX_REMOVALS = 5;
export const MIN_BUDGET_MS = 45000;
// 제목·한 줄 요약은 검수 대상에서 뺀다 — 지우면 코드 방향 판정으로 대체되는데, 그 판정은 C2 규칙이 이미 본다
const SKIP = /\.headline$|brief\.one_liner$|\.title$/;

const INSTRUCTIONS = `당신은 국내 제강사 구매팀이 읽는 원자재(합금철·알루미늄·가탄제·철강) 시황 리포트의 사실 검수자입니다.
【코드 사실】은 거래소·고시 숫자로 코드가 계산한 것이라 틀릴 수 없습니다. 【문장 목록】의 각 문장에는 근거 기사의 날짜·표시가 붙어 있습니다.
아래 문제가 확실한 문장의 번호만 고릅니다. 문제가 확실하지 않으면 고르지 않습니다. 문장을 고쳐 쓰지 않습니다.
숫자를 다시 계산하지 않습니다. 【코드 사실】과 같은 숫자(가격·변동률·원화 환산 변동률·1년 범위·분기 대비)를 그대로 쓴 문장은 그 숫자 때문에 고르지 않습니다.
기사 근거가 붙은 문장은 기사를 볼 수 없으므로 내용이 근거 없다는 이유로 고르지 않습니다.
- contradiction: 【코드 사실】(시장 방향·원/달러 방향·휴장)과 반대되는 서술, 또는 같은 리포트의 다른 문장과 정면으로 모순되는 서술(예: 같은 시장에서 "항구 재고가 감소해 지지"와 "재고 부족이 없다"). 두 문장 중 근거가 약하거나 코드 사실과 어긋나는 쪽 하나만 고른다.
- stale: 근거가 실적 기사(지난 분기)·이전 보도·7일 넘은 기사이거나 휴장으로 멈춘 시세인데, 지금·이번 주에 새로 일어나는 일처럼 현재형으로 쓴 문장. 오래된 고시가·월간 통계를 날짜 없이 현재 값처럼 쓴 문장.
- unsupported: 근거 표시가 "숫자 줄"인 문장 가운데, 【코드 사실】로 확인할 수 없는 구체적 사실(사건·정책·수급·수요 판단)이나 【코드 사실】에 없는 숫자를 단정한 문장. 근거 표시가 없거나 기사인 문장은 이 종류로 고르지 않는다.
reason은 한 문장으로 무엇이 왜 문제인지 쓴다.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['sid', 'kind', 'reason'],
        properties: { sid: { type: 'string', description: '문장 번호(예 S12)' }, kind: { type: 'string', enum: KINDS }, reason: { type: 'string' } },
      },
    },
  },
};

// 문장의 근거 기사 설명 — 칸별로 아는 만큼(원인: src, 지금: now_src)
function sourceNote(report, where) {
  const m = /^(\w+)\.(why|now)\[(\d+)\]/.exec(where);
  if (!m || !MARKET_KEYS.includes(m[1])) return '';
  const mk = report.markets?.[m[1]];
  const ids = m[2] === 'why' ? mk?.why?.[Number(m[3])]?.src : mk?.now_src?.[Number(m[3])];
  if (!Array.isArray(ids)) return '';
  if (!ids.length) return ' {근거: 숫자 줄}';
  const notes = ids.map(n => {
    if (n === 0) return '거시 헤드라인';
    const a = mk.sources?.[n - 1];
    if (!a) return `기사 ${n}`;
    const age = Math.round((Date.parse(`${report.date}T06:00:00+09:00`) - Date.parse(a.published)) / 86400000);
    return `${a.published.slice(0, 10)}(${age}일 전)${a.repeat ? ' 이전 보도' : ''}${isResultsArticle(a) ? ' 실적 기사' : ''}`;
  });
  return ` {근거: ${notes.join(', ')}}`;
}

// 검수 입력 — 코드 사실 + 번호 매긴 문장 목록. sids: 번호 → {where, text} (순수 함수)
export function buildJudgeInput(report) {
  const facts = [`오늘: ${report.date}`];
  for (const k of MARKET_KEYS) {
    const m = report.markets?.[k];
    if (!m?.direction || m.error) continue;
    facts.push(`${m.name ?? k} 방향(주간 시세 기준): ${DIR_KO[m.direction]} — ${FOCUS[k]}`);
    // 해설 입력의 숫자 줄과 같은 값 — 검수가 맞는 숫자를 "근거 없음"으로 고르지 않게(2026-10-26 시험 실행 8건 오판)
    for (const s of m.metrics?.series ?? []) {
      facts.push(`  ${s.label}: ${s.value} ${s.unit} (${s.date}${isHalted(s.date, report.date) ? ', 휴장 — 멈춘 가격' : ''}) 1일 ${s.d1_pct ?? '-'}% · 1주 ${s.w1_pct ?? '-'}% · 1개월 ${s.m1_pct ?? '-'}% · 1년 범위 ${s.y_low}~${s.y_high}, 현재 위치 ${s.y_pos}%`);
    }
    const q = m.metrics?.quarter;
    if (q?.usd_pct != null) facts.push(`  ${q.quarter} 시작 전(${q.base_date}) 대비: 달러 기준 ${q.usd_pct}%, 원화 기준 ${q.krw_pct}%`);
    const kl = krwLine(m.metrics?.krw, report.fx);
    if (kl) facts.push(`  ${kl}`);
  }
  const fxLine = fxDirectionLine(report.fx);
  if (fxLine) facts.push(fxLine.replace(/^【[^】]+】\s*/, '원/달러 '));
  for (const n of report.notices ?? []) facts.push(`${n.label}: ${n.date} 기준 ${n.nums.join(', ')}${n.unit}`);
  const sids = {};
  const lines = [];
  let n = 0;
  for (const t of reportTexts(report)) {
    if (SKIP.test(t.where)) continue;
    for (const s of sentencesOf(t.text)) {
      const sid = `S${++n}`;
      sids[sid] = { where: t.where, text: s };
      lines.push(`[${sid}] (${t.where})${sourceNote(report, t.where)} ${s}`);
    }
  }
  return { input: `【코드 사실】\n${facts.join('\n')}\n\n【문장 목록】\n${lines.join('\n')}`, sids };
}

// 검수 결과 → 지울 문장 목록. 모르는 번호·종류는 버리고 상한까지만 (순수 함수)
export function judgeIssues(json, sids) {
  const out = [];
  for (const x of json?.issues ?? []) {
    const hit = sids[String(x?.sid ?? '').trim()];
    if (!hit || !KINDS.includes(x.kind) || out.some(o => o.where === hit.where && o.text === hit.text)) continue;
    out.push({ id: 'C3', kind: x.kind, reason: String(x.reason ?? '').slice(0, 160), ...hit });
    if (out.length >= MAX_REMOVALS) break;
  }
  return out;
}

// 리포트 검수 한 번. 반환: { issues, extra(gate.js extraIssues), cost_usd }
export async function judgeReport(report, { callAgent, model = undefined, timeoutMs = 60000 }) {
  const { input, sids } = buildJudgeInput(report);
  if (!Object.keys(sids).length) return { issues: [], extra: () => [], cost_usd: 0 };
  const res = await callAgent({ instructions: INSTRUCTIONS, input, schema: SCHEMA, model, maxOutputTokens: 6000, label: 'judge', timeoutMs }); // 추론 토큰이 상한을 먼저 쓰면 빈 응답(2026-10-26 Luna 2000 토큰)
  if (!res.json) throw new Error(`검수 JSON 파싱 실패: ${String(res.text).slice(0, 160)}`);
  const issues = judgeIssues(res.json, sids);
  const keys = new Set(issues.map(i => `${i.where}|${i.text}`));
  return { issues, extra: (s, where) => (keys.has(`${where}|${s}`) ? ['C3'] : []), cost_usd: res.usage?.cost?.total_cost ?? 0 };
}

// 검수 → 고른 문장을 게이트로 지운 리포트. 함수 300초 한도 — 남은 시간이 45초 미만이면 건너뛴다.
// 저장은 호출부가 한다. 검수가 실패해도 이미 저장한 리포트가 남는다(예외를 밖으로 던지지 않는다)
/** @returns {Promise<{ report?: any, issues?: number, cost_usd?: number, skipped?: string, error?: string }>} */
export async function judgeAndFinalize(full, { callAgent, budgetMs, model = undefined }) {
  if (budgetMs < MIN_BUDGET_MS) return { skipped: `남은 시간 ${Math.round(budgetMs / 1000)}초` };
  let j;
  try {
    j = await judgeReport(full, { callAgent, model, timeoutMs: Math.min(60000, budgetMs - 20000) });
  } catch (e) {
    return { error: e.message };
  }
  const judged = { ...full, checks: { ...(full.checks ?? {}), judge: j.issues.map(({ kind, reason, where, text }) => ({ kind, reason, where, text })) } };
  return { report: j.issues.length ? finalizeReport(judged, j.extra) : judged, issues: j.issues.length, cost_usd: j.cost_usd };
}
