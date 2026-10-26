// api/_lib/quality.js — 리포트 품질 결함 판정·집계 (기준: docs/quality.md). 네트워크 없는 순수 함수.
// 문장·칸 판정(sentenceIssues·headlineIssue·oneLinerIssue·whyIssue)은 게시 게이트(gate.js)와 같이 쓴다 — 집계와 삭제가 같은 규칙.
// 저장된 리포트(sources·fx·notices 포함)를 받는다. 옛 리포트처럼 없는 정보가 필요한 검사는 건너뛴다.
import { MARKET_NAMES, DIR_KO } from './interpret.js';
import { isHalted } from './market-metrics.js';
import { bigNums, isResultsArticle } from './cite.js';

export const SEV = { F1: 'H', F2: 'H', F3: 'M', F4: 'M', C1: 'H', C2: 'H', C3: 'H', G1: 'M', G2: 'H', S1: 'L', S2: 'L', S3: 'M' };
export const MARKET_KEYS = Object.keys(MARKET_NAMES);
const DIR_WORD = { up: '강세', down: '약세' };
const DAY = 86400000;
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// 리포트의 모든 화면 문장 [{where, text}] (순수 함수)
export function reportTexts(report) {
  const out = [];
  const add = (where, t) => { if (typeof t === 'string' && t.trim()) out.push({ where, text: t }); };
  const b = report?.brief;
  if (b && !b.error) {
    add('brief.one_liner', b.one_liner);
    add('brief.lead', b.lead);
    (b.common ?? []).forEach((c, i) => { add(`brief.common[${i}].title`, c.title); add(`brief.common[${i}].text`, c.text); });
  }
  for (const k of MARKET_KEYS) {
    const m = report?.markets?.[k];
    if (!m || m.error) continue;
    add(`${k}.headline`, m.headline);
    (m.now ?? []).forEach((t, i) => add(`${k}.now[${i}]`, t));
    (m.why ?? []).forEach((w, i) => add(`${k}.why[${i}]`, `${w.title} ${w.text}`));
    (m.impact ?? []).forEach((x, i) => add(`${k}.impact[${i}]`, x.text));
    add(`${k}.outlook.view`, m.outlook?.view);
    (m.outlook?.watch ?? []).forEach((t, i) => add(`${k}.outlook.watch[${i}]`, t));
    add(`${k}.outlook.up`, m.outlook?.up);
    add(`${k}.outlook.down`, m.outlook?.down);
  }
  return out;
}

export const sentencesOf = (t) => String(t ?? '').split(/(?<=[다요]\.)\s+/).filter(Boolean);

// ─── 고시·월간 통계 (F1) ──────────────────────────────────────────────────────
// 화면에 숫자로 나올 수 있는 고시·통계 값과 그 기준일. 주간 고시·야드 시세는 14일, 관세청 월간 단가는 그 달 1일부터 80일이
// 지나면 "현재 값"이 아니다(관세청은 다음 달 중순 공개라 평소에도 한 달 늦다) (순수 함수)
const fmtNum = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export function noticeFacts(snap) {
  const out = [];
  const kr = snap?.scrap_kr;
  if (kr?.base_date && kr.items?.length) out.push({ label: '국내 알루미늄 스크랩 매입가', date: kr.base_date, max_days: 14, unit: '원', nums: kr.items.map(i => fmtNum(i.price)) });
  for (const [code, name] of [['us', '미국'], ['ca', '캐나다']]) {
    const g = snap?.scrap_overseas?.[code];
    if (g?.date && g.items?.length) out.push({ label: `${name} 야드 매입가`, date: g.date, max_days: 14, unit: '달러', nums: g.items.map(i => fmtNum(i.usd_t)) });
  }
  for (const [cc, name] of [['CN', '중국'], ['RU', '러시아']]) {
    for (const r of (snap?.anthracite_customs?.countries?.[cc] ?? []).filter(x => x.usd_per_t).slice(-4)) {
      out.push({ label: `관세청 무연탄 ${name}산 ${r.ym}`, date: `${r.ym}-01`, max_days: 80, unit: '달러', nums: [fmtNum(r.usd_per_t)] });
    }
  }
  return out;
}
// 날짜 표기. "○일"만으로는 날짜가 아니다 — 입력의 "1일 +0.5%"(하루 변동)를 날짜로 보면 휴장 시세 서술이 빠져나간다
const DATED = /\d{1,2}월|\d{4}-\d{2}|지난\s?(?:주|달)/;
const numRe = (n, unit) => new RegExp(`(^|[^\\d.,])${n.replace(/,/g, '').split('').map(c => (c === '.' ? '\\.' : c)).join(',?')}(?![\\d]|[.,]\\d)\\s*(?:${unit})`);

// ─── 휴장 시세 (F2) ──────────────────────────────────────────────────────────
const SERIES_WORD = {
  sf: /FeSi|페로실리콘/, sm: /SiMn|실리콘망간|실리망간/, lme: /LME/, al: /SHFE 1차|1차 알루미늄/, ad: /2차 알루미늄|주조합금|ADC12/,
  jm: /원료탄|점결탄/, j: /코크스/, rb: /철근/, hc: /열연/,
};
// 지난 움직임을 단정하는 서술만 — "하락은 선물에서만 확인된다", "새로 보여줄 재료" 같은 문장은 움직임 서술이 아니다(2026-10-04~08 점검)
const MOVE = /(?:상승|하락|반등|급등|급락|반락)(?:했|하며|해(?!도))|올랐|올라$|내렸|떨어졌|뛰었/;
const NOW_WORD = /오늘|이날|하루|전일|간밤|이번\s?주|금주|최근\s?1?주/;
// 같은 절 안에 시점어와 움직임이 함께 있어야 한다 — "1개월 -3.16% 내려 있으나 최근 1주 낙폭은 줄었다"는 새 움직임 서술이 아니다
const clauses = (s) => s.split(/,|(?:지만|으나|는데|고)\s/).map(c => c.trim());
const HALT_WORD = /휴장|연휴|국경절|춘절|멈춘|멈췄|거래가?\s?(?:없|중단)/;
// 시장별 휴장으로 멈춘 시세 키(halted)와 움직이는 시세 키(live). 저장된 시장 지표의 시세 날짜와 리포트 날짜로 판정
export function seriesState(report) {
  const halted = {}, live = {};
  for (const k of MARKET_KEYS) {
    const series = report?.markets?.[k]?.metrics?.series ?? [];
    halted[k] = series.filter(s => isHalted(s.date, report.date)).map(s => s.key);
    live[k] = series.filter(s => !isHalted(s.date, report.date)).map(s => s.key);
  }
  return { halted, live };
}

// ─── 환율 방향 (C1) ──────────────────────────────────────────────────────────
// 환율 서술 바로 뒤가 조건("~가 이어지면", "~할 경우")이면 사실 서술이 아니다
const IF_AFTER = /^[^.]{0,12}?(?:면\s|면,|경우|때\s)/;
const FX_WEAK = [/원화(?:가|는|의)?\s*(?:추가\s*)?약세/g, /(?:원\/달러|환율)(?:은|는|이|가)?\s*(?:[^.\s]+\s){0,2}?(?:상승|올랐|올라|오르|높아)/g];
const FX_STRONG = [/원화(?:가|는|의)?\s*(?:추가\s*)?강세/g, /(?:원\/달러|환율)(?:은|는|이|가)?\s*(?:[^.\s]+\s){0,2}?(?:하락|내렸|내려|떨어|낮아)/g];
// "원/달러 하락은 원가를 낮춘다"처럼 주제(은·는)로 쓴 일반 설명도 사실 서술이 아니다(이어졌다·나타났다 같은 서술은 사실)
const GENERAL_AFTER = /^(?:은|는)\s(?![^.]{0,8}(?:이어졌|계속됐|나타났|보였|확대됐))/;
const claims = (s, list) => list.some(re => [...s.matchAll(re)].some(m => {
  const after = s.slice((m.index ?? 0) + m[0].length);
  return !IF_AFTER.test(after) && !GENERAL_AFTER.test(after);
}));
const SCENARIO = /outlook\.(up|down)$/; // 시나리오 문장("~하면 ~할 수 있다")

// 원/달러 실제 방향: 1주·1개월이 같은 쪽일 때만 'down'(원화 강세)·'up'(원화 약세), 아니면 null
export function fxTrend(fx) {
  if (!fx || fx.w1_pct == null || fx.m1_pct == null) return null;
  if (fx.w1_pct < 0 && fx.m1_pct < 0) return 'down';
  if (fx.w1_pct > 0 && fx.m1_pct > 0) return 'up';
  return null;
}
// 원/달러 방향과 반대되는 서술인가. trend 'down' = 원/달러 하락 = 원화 강세
export function contradictsFx(sentence, trend) {
  if (!trend) return false;
  const s = String(sentence);
  const wonWeak = claims(s, FX_WEAK), wonStrong = claims(s, FX_STRONG);
  return trend === 'down' ? wonWeak && !wonStrong : wonStrong && !wonWeak;
}

// fx: 리포트에 저장한 원/달러 지표(없으면 호출부가 시계열로 계산해 넘긴다)
export function auditContext(report, fx = report?.fx) {
  const date = report?.date;
  const stale = (n) => !!date && daysBetween(n.date, date) > n.max_days;
  return { date, trend: fxTrend(fx), notices: (report?.notices ?? []).filter(stale), ...seriesState(report ?? {}) };
}

// 한 문장의 결함 ID 목록 — F1 오래된 고시·통계 숫자를 날짜 없이, F2 휴장 시세를 새 움직임으로, C1 환율 방향 반대
export function sentenceIssues(s, where, ctx) {
  const out = new Set();
  if (!DATED.test(s) && ctx.notices.some(n => n.nums.some(x => numRe(x, n.unit).test(s)))) out.add('F1');
  if (clauses(s).some(c => MOVE.test(c) && NOW_WORD.test(c)) && !HALT_WORD.test(s) && !DATED.test(s)) {
    const k = where.split('.')[0];
    const halted = k === 'brief' ? Object.values(ctx.halted).flat() : (ctx.halted[k] ?? []);
    // 시장의 시세가 모두 멈췄으면 품목 이름 없이 "이번 주 하락했다"고 써도 휴장 시세를 새 움직임으로 쓴 것이다(시나리오 문장 제외)
    const allHalted = k !== 'brief' && halted.length > 0 && !(ctx.live[k] ?? []).length && !SCENARIO.test(where);
    if (allHalted || halted.some(key => SERIES_WORD[key]?.test(s))) out.add('F2');
  }
  if (!SCENARIO.test(where) && contradictsFx(s, ctx.trend)) out.add('C1');
  return [...out];
}
// G2 원인 칸 근거 — 기사가 있는 날 근거 번호 없는 원인, 근거 번호 없이 코드 숫자도 말하지 않는 원인(지어낸 서술일 수 있다)
export function whyIssue(w, m) {
  const src = (w?.src ?? []).filter(n => Number.isInteger(n));
  if (src.length) return null;
  if ((m?.sources ?? []).length) return 'G2';
  return bigNums(`${w?.title ?? ''} ${w?.text ?? ''}`).length ? null : 'G2';
}

// C2 시장 제목의 방향 단어가 코드 판정과 반대. "달러 강세로 알루미늄이 밀렸다"의 통화 강세·약세는 시장 방향이 아니다(2026-10-03)
// "철강 수요 약세"처럼 수요·심리의 강세·약세도 가격 방향이 아니다
const CCY_DIR = /(?:달러|원화|엔화|유로|위안|수요|소비|거래|심리|구매)(?:화)?\s?(?:강세|약세)/g;
export const headlineIssue = (m) => {
  const opposite = { up: '약세', down: '강세' }[m?.direction];
  const h = String(m?.headline ?? '').replace(CCY_DIR, '');
  return !!opposite && h.includes(opposite) && !h.includes(DIR_WORD[m.direction]);
};
// C2 한 줄 요약의 시장 방향이 코드 판정과 다름 — 보합인데 강세·약세라고 쓴 것 포함. "알루미늄"은 1차·2차 어느 쪽과도 맞지 않을 때만
const ONE_LINER_NAMES = [[['ferro'], '합금철|페로실리콘|실리콘망간'], [['al1', 'al2'], '알루미늄'], [['recarb'], '가탄제|원료탄|코크스'], [['steel'], '철강|철근|열연']];
export function oneLinerIssue(oneLiner, markets) {
  return ONE_LINER_NAMES.some(([keys, names]) => {
    const said = new RegExp(`(?:${names})[^,·]{0,12}?(강세|약세)`).exec(String(oneLiner ?? '').replace(CCY_DIR, ''))?.[1];
    if (!said) return false;
    const dirs = keys.map(k => markets?.[k]?.direction).filter(Boolean);
    return dirs.length > 0 && !dirs.includes('mixed') && !dirs.some(d => DIR_WORD[d] === said);
  });
}

export function auditReport(report, fx = report?.fx) {
  const ctx = auditContext(report, fx);
  const { date } = ctx;
  const defects = [];
  const flag = (id, where, text = '') => {
    if (!defects.some(d => d.id === id && d.where === where)) defects.push({ id, sev: SEV[id], where, text: String(text).slice(0, 160) });
  };
  for (const t of reportTexts(report)) {
    for (const s of sentencesOf(t.text)) {
      for (const id of sentenceIssues(s, t.where, ctx)) flag(id, t.where, s);
      if (/USD|US\$|위안|CNY|元/.test(s)) flag('S2', t.where, s);
    }
  }

  const genAt = Date.parse(`${date}T06:00:00+09:00`);
  let citeDropped = 0;
  for (const k of MARKET_KEYS) {
    const m = report?.markets?.[k];
    if (!m) { flag('S3', k, '시장 없음'); continue; }
    if (m.error) { flag('S3', k, `해설 실패: ${String(m.error).slice(0, 80)}`); continue; }
    if (!m.headline || !(m.now ?? []).length) flag('S3', k, '제목·지금 칸 비었음');
    if (headlineIssue(m)) flag('C2', `${k}.headline`, m.headline);
    citeDropped += (m.dropped ?? []).filter(d => String(d).startsWith('G2')).length;
    const src = m.sources ?? [];
    const why = m.why ?? [];
    why.forEach((w, i) => {
      if (whyIssue(w, m)) flag('G2', `${k}.why[${i}]`, `${w.title} — 근거 없음`);
      const arts = (w.src ?? []).filter(n => n > 0).map(n => src[n - 1]).filter(Boolean);
      if (!arts.length) return;
      if (arts.every(a => a.repeat || (genAt - Date.parse(a.published)) / 3600000 > 72)) flag('F3', `${k}.why[${i}]`, `${w.title} — ${arts.map(a => `${a.published.slice(0, 10)}${a.repeat ? ' 이전 보도' : ''}`).join(', ')}`);
      if (arts.every(isResultsArticle)) flag('F4', `${k}.why[${i}]`, `${w.title} — 실적 기사: ${arts.map(a => a.title).join(' / ').slice(0, 100)}`);
    });
    const distinct = new Set(why.flatMap(w => (w.src ?? []).filter(n => n > 0)));
    if (why.length >= 2 && src.length >= 2 && distinct.size < 2) flag('G1', `${k}.why`, `원인 ${why.length}개가 기사 ${distinct.size}건(근거 기사 ${src.length}건 중)`);
  }
  const b = report?.brief;
  if (!b || b.error) flag('S3', 'brief', b?.error ?? '브리핑 없음');
  if (b && oneLinerIssue(b.one_liner, report?.markets)) flag('C2', 'brief.one_liner', b.one_liner);
  const seen = new Set();
  (b?.common ?? []).forEach((c, i) => {
    const title = String(c.title ?? '').trim();
    if (seen.has(title)) flag('S1', `brief.common[${i}]`, `제목 중복: ${title}`);
    seen.add(title);
    if (String(c.text ?? '').replace(/\s/g, '').length < 20) flag('S1', `brief.common[${i}]`, `본문 짧음: ${c.text}`);
  });

  const counts = { H: 0, M: 0, L: 0 };
  const by_id = {};
  for (const d of defects) { counts[d.sev]++; by_id[d.id] = (by_id[d.id] ?? 0) + 1; }
  // removed: 게시 게이트가 저장 전에 지운 문장, cite_dropped: 생성 단계 인용 대조로 버린 문장 — 남은 결함이 아니라 생성 품질 추이
  return { version: 1, date, counts, by_id, removed: (report?.checks?.removed ?? []).length, cite_dropped: citeDropped, defects };
}

export { DIR_KO };
