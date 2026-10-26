// api/_lib/gate.js — 게시 게이트: H(사실 오류) 판정 문장을 저장 전에 지운다(docs/quality.md). 판정은 quality.js와 같은 함수.
// 문장을 고쳐 쓰지 않고 지우기만 한다. 제목·한 줄 요약이 비면 코드가 아는 사실(방향 판정)로만 채운다.
import { MARKET_NAMES, DIR_KO } from './interpret.js';
import { MARKET_KEYS, SEV, auditContext, auditReport, headlineIssue, oneLinerIssue, sentenceIssues, sentencesOf, whyIssue } from './quality.js';

// 긴 접속어부터 — "이에"가 먼저 맞으면 "이에 따라"에서 "따라"가 남는다
const LINKED = /^(?:이에 따라|이로 인해|이 때문에|그 결과|따라서|이에|이는)\s*,?\s*/;
const len = (t) => String(t ?? '').replace(/\s/g, '').length;
// 공통 요인 제목이 겹치거나 본문이 20자 미만이면 뺀다(S1) (순수 함수)
export const distinctItems = (items, min = 20) => (items ?? []).filter(c => len(c.text) >= min)
  .filter((c, i, a) => a.findIndex(x => String(x.title ?? '').trim() === String(c.title ?? '').trim()) === i);

// extraIssues(s, where) → 추가 결함 ID(LLM 일관성 검수 결과). 반환: { report, removed }
/** @param {any} report @param {(s: string, where: string) => string[]} [extraIssues] */
export function gateReport(report, extraIssues = () => []) {
  const ctx = auditContext(report);
  const removed = [];
  const clean = (where, text) => {
    if (typeof text !== 'string' || !text.trim()) return text ?? null;
    const kept = [];
    let dropped = false;
    for (const s of sentencesOf(text)) {
      const ids = [...sentenceIssues(s, where, ctx), ...extraIssues(s, where)].filter(id => SEV[id] === 'H');
      if (ids.length) { removed.push({ id: ids[0], where, text: s }); dropped = true; continue; }
      // 바로 앞 문장을 지웠으면 그 문장을 받는 접속어("이에", "이 때문에")를 뗀다
      kept.push(dropped ? s.replace(LINKED, '') : s);
      dropped = false;
    }
    return kept.length ? kept.join(' ') : null;
  };
  // 짧은 항목(지금·원인·영향·변수·공통 요인)은 한 문장이라도 걸리면 통째로 뺀다 — 남은 문장이 지운 문장에 기댄다
  const item = (where, text) => {
    const before = removed.length;
    const out = clean(where, text);
    return removed.length > before ? null : out;
  };
  const r = structuredClone(report);

  for (const k of MARKET_KEYS) {
    const m = r.markets?.[k];
    if (!m || m.error) continue;
    // now와 문장별 근거(now_src)는 같은 순서 — 함께 지운다
    const nowKept = (m.now ?? []).map((t, i) => ({ t: item(`${k}.now[${i}]`, t), src: m.now_src?.[i] })).filter(x => x.t);
    m.now = nowKept.map(x => x.t);
    if (m.now_src) m.now_src = nowKept.map(x => x.src);
    m.why = (m.why ?? []).filter((w, i) => {
      const where = `${k}.why[${i}]`;
      const g2 = whyIssue(w, m);
      if (g2) { removed.push({ id: g2, where, text: `${w.title ?? ''} ${w.text ?? ''}`.trim() }); return false; }
      return item(where, `${w.title ?? ''} ${w.text ?? ''}`.trim());
    });
    m.impact = (m.impact ?? []).filter((x, i) => item(`${k}.impact[${i}]`, x.text ?? ''));
    if (m.outlook) {
      m.outlook = {
        ...m.outlook,
        view: clean(`${k}.outlook.view`, m.outlook.view),
        watch: (m.outlook.watch ?? []).map((t, i) => item(`${k}.outlook.watch[${i}]`, t)).filter(Boolean),
        up: clean(`${k}.outlook.up`, m.outlook.up),
        down: clean(`${k}.outlook.down`, m.outlook.down),
      };
    }
    const head = clean(`${k}.headline`, m.headline);
    if (!head || headlineIssue({ ...m, headline: head })) {
      if (head) removed.push({ id: 'C2', where: `${k}.headline`, text: m.headline });
      // 대신 쓰는 제목은 코드 방향 판정뿐 — 지어내지 않는다
      m.headline = m.direction ? `${MARKET_NAMES[k]} ${DIR_KO[m.direction]}` : null;
    } else m.headline = head;
  }

  const b = r.brief;
  if (b && !b.error) {
    b.lead = clean('brief.lead', b.lead);
    b.common = distinctItems((b.common ?? []).filter((c, i) => item(`brief.common[${i}].text`, `${c.title ?? ''} ${c.text ?? ''}`.trim())));
    const one = clean('brief.one_liner', b.one_liner);
    if (!one || oneLinerIssue(one, r.markets)) {
      if (one) removed.push({ id: 'C2', where: 'brief.one_liner', text: b.one_liner });
      b.one_liner = MARKET_KEYS.filter(k => r.markets?.[k]?.direction && !r.markets[k].error)
        .map(k => `${MARKET_NAMES[k]} ${DIR_KO[r.markets[k].direction]}`).join(' · ') || null;
    } else b.one_liner = one;
  }

  // 검수 뒤 다시 거치면 앞서 지운 기록에 이어 붙인다(같은 칸·문장은 한 번)
  const all = [...(r.checks?.removed ?? []), ...removed].filter((x, i, a) => a.findIndex(y => y.where === x.where && y.text === x.text) === i);
  r.checks = { ...(r.checks ?? {}), removed: all };
  return { report: r, removed };
}

// 저장 직전: 게시 게이트(H 결함 문장 삭제) → 남은 결함 집계. 화면 API(get-report)는 quality·checks를 내보내지 않는다
/** @param {any} report @param {(s: string, where: string) => string[]} [extraIssues] */
export function finalizeReport(report, extraIssues = undefined) {
  const { report: gated } = gateReport(report, extraIssues);
  return { ...gated, quality: auditReport(gated) };
}
