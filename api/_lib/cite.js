// api/_lib/cite.js — 해설 문장의 인용 근거 검증(docs/quality.md G2). LLM은 근거 문장 번호("기사-문장")만 달고,
// 코드가 그 번호의 원문 문장을 찾아 문장 속 숫자가 인용 문장이나 코드 숫자 줄에 있는지 대조한다. 없는 번호·없는 숫자면 그 문장을 버린다.

// 실적 기사 — 지난 분기 실적(예: 2026-10-24 Hydro 3분기 EBITDA)을 지금 수급의 원인으로 쓰지 않게 표시한다.
// 선물사 "季报"(분기 시황 리포트)는 실적이 아니라 빼 둔다
// "Q4 MJP"(분기 계약가)처럼 분기 표기만 있는 시황 기사는 실적이 아니다 — 분기 표기는 실적 단어와 함께일 때만
export const RESULTS_RE = /(?:Q[1-4]|[1-4]Q|(?:first|second|third|fourth)[- ]quarter|quarterly)\s*(?:FY\d{2,4}\s*)?(?:results|earnings|EBITDA|net profit|profit|revenue|loss|sales)|net profit|net loss|financial results|earnings|EBITDA|业绩|净利|분기\s*(?:실적|영업이익|매출)|영업이익|순이익/i;
export const isResultsArticle = (a) => RESULTS_RE.test(String(a?.title ?? ''));

// 기사 본문 → 문장 목록(번호 매김 단위). 입력 조립(buildInput)과 검증이 같은 함수를 써야 번호가 맞는다.
// 제목만 쓰는 기사(철강금속신문)는 제목이 1번 문장이다
export function articleSentences(a) {
  const s = String(a?.body ?? '').split('\n')
    // 중국어 기사는 문장 사이 공백이 없다 — 。！？ 뒤는 공백 없이도 나눈다
    .flatMap(p => p.split(/(?<=[.!?])\s+|(?<=[。！？；])/)).map(t => t.trim()).filter(t => t.length >= 8);
  return s.length ? s : (a?.title_only && a.title ? [a.title] : []);
}
export const numberedBody = (a, i) => articleSentences(a).map((t, k) => `[${i + 1}-${k + 1}] ${t}`).join('\n');

// 거시 헤드라인 — buildMacroSection이 줄마다 "[0-k]"를 단다
export const macroLines = (macroSection) => [...String(macroSection ?? '').matchAll(/^\[0-(\d+)\] (.*)$/gm)].map(m => m[2]);

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
export const normNum = (s) => s.replace(/,/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
// 1~2자리 정수(월·일·분기·개수)는 대조하지 않는다 — numbersOk와 같은 기준
export const bigNums = (t) => (String(t).match(NUM_RE) ?? []).map(normNum).filter(n => !/^\d{1,2}$/.test(n));

// ─── 엄격 대조(2026-11-17 사용자 지시 "원문과 맞춰") ───────────────────────────
// 위 bigNums는 1~2자리 정수를 날짜·개수로 보고 넘겨 "30%"를 "40%"로 바꿔도 통과했고, "1만1000"을 1과 1000으로 따로 봐 느슨했다.
// 아래는 리포트 해설(cite·numbersOk)과 세계 동향이 함께 쓴다.
// - 단위가 붙은 1~2자리 수(30%, 톤당 80달러)는 같은 수가 원문(인용 문장·코드 숫자 줄·입력)에 있어야 한다
// - 만·억·천이 붙은 수는 풀어 쓴 값이 원문에 있어야 한다. 원문이 万·亿·만·억으로 쓴 수는 풀어서 비교하고,
//   영어 million·billion을 만·억으로 바꾼 수(45 million → 4,500만)는 환산이라 받지 않는다
// - "45백만 톤"·"2.5십억 달러"는 같은 수가 million·Mt·百万·billion과 함께 원문에 있어야 한다
const UNIT_VAL = { 천: 1e3, 만: 1e4, 억: 1e8, 千: 1e3, 万: 1e4, 亿: 1e8, 萬: 1e4, 億: 1e8 };
const toNum = (s) => Number(String(s).replace(/,/g, ''));
// 문장 속 만·억 단위 수의 값 목록. 이어 붙은 꼴("1억4000만", "1만1000")은 한 수로 합친다 (순수 함수)
export function unitNumbers(s, units = '천만억千万亿萬億') {
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s?([${units}])`, 'g');
  const toks = [...String(s).matchAll(re)].map(m => ({ at: m.index, end: m.index + m[0].length, v: toNum(m[1]) * UNIT_VAL[m[2]], unit: UNIT_VAL[m[2]] }));
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    let { v, end, unit } = toks[i];
    while (toks[i + 1] && toks[i + 1].at - end <= 1 && toks[i + 1].unit < unit) { i++; v += toks[i].v; end = toks[i].end; unit = toks[i].unit; }
    // 끝에 붙은 작은 수("1만1000"의 1000) — 뒤에 또 단위·%·날짜가 오지 않을 때만
    const tail = /^\s?(\d[\d,]*)(?![\d.]|\s?(?:[천만억千万亿萬億%년월일개곳주차]))/.exec(String(s).slice(end));
    if (tail && toNum(tail[1]) < unit) v += toNum(tail[1]);
    out.push(String(Math.round(v)));
  }
  return out;
}
// 원문 숫자 값 집합 — 모든 숫자(1~2자리 포함) + "11 000" 꼴 + 万·亿·만·억을 풀어 쓴 값 (순수 함수)
export function sourceValues(texts) {
  const out = new Set();
  for (const s of texts.map(String)) {
    for (const n of s.match(NUM_RE) ?? []) out.add(normNum(n));
    for (const m of s.matchAll(/\d{1,3}(?:[   ]\d{3})+(?!\d)/g)) out.add(m[0].replace(/\D/g, ''));
    for (const v of unitNumbers(s)) out.add(v);
    // 퍼센트로 쓰인 수는 "30%"로 따로 — 문장의 30%가 원문의 "30일"과 맞아떨어지지 않게
    for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(?:%|％|percent|per cent|pct|퍼센트|个百分点)/gi)) out.add(`${normNum(m[1])}%`);
  }
  return out;
}
const SMALL_UNIT_RE = /(?<![\d.,])(\d{1,2}(?:\.\d+)?)\s?(%|퍼센트|포인트|달러|원|톤|kg|배럴)/g;
const SCALE_SRC = { 백만: '(?:million|mln|mn|m\\b|mt\\b|百万)', 십억: '(?:billion|bn|bln|十亿)' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 원문 값(values)·원문 글(texts, 백만·십억 규모어 확인용 — 없으면 수만 본다)에 없는 수 목록 (순수 함수)
export function strictMissing(text, values, texts = null) {
  const t = String(text);
  const miss = [];
  for (const m of t.matchAll(SMALL_UNIT_RE)) {
    const pct = /^(%|퍼센트)$/.test(m[2]);
    if (!values.has(pct ? `${normNum(m[1])}%` : normNum(m[1]))) miss.push(m[0]);
  }
  for (const v of unitNumbers(t, '천만억')) if (!values.has(v)) miss.push(`${v}(만·억 풀어 쓴 값)`);
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(백만|십억)/g)) {
    const n = m[1].replace(/,/g, '');
    const ok = texts
      ? texts.some(s => new RegExp(`(?<![\\d.])${esc(n)}\\s?${SCALE_SRC[m[2]]}`, 'i').test(String(s).replace(/(\d),(?=\d{3})/g, '$1')))
      : values.has(normNum(n));
    if (!ok) miss.push(m[0]);
  }
  return miss;
}

// 인용 번호 풀이 — 없는 번호가 하나라도 있으면 null
export function resolveCites(cite, articles, macro = []) {
  const out = [];
  for (const raw of (cite ?? []).map(String)) {
    // "[2-3]"·" 2 - 3 " 같은 표기 차이는 받는다
    const m = /^(\d+)(?:-(\d+))?$/.exec(raw.replace(/[[\]\s]/g, ''));
    if (!m) return null;
    const ai = Number(m[1]);
    const all = ai === 0 ? macro : (articles[ai - 1] ? articleSentences(articles[ai - 1]) : []);
    // 기사 번호만 단 경우("2")는 그 기사 전체와 대조한다 — 문장 번호보다 약하지만, 형식 하나로 해설이 통째로 지워지지 않게
    const s = m[2] ? all[Number(m[2]) - 1] : (all.length ? all.join(' ') : undefined);
    if (!s) return null;
    out.push({ article: ai, sentence: s });
  }
  return out;
}

// 문장 하나 검증. requireCite: 기사가 있는 날의 원인(why). 근거 없이 쓸 수 있는 문장은 코드 숫자를 말하는 문장뿐
/** @returns {{ ok: true, articles: number[] } | { ok: false, reason: string }} */
export function citeCheck(text, cite, { articles, macro = [], codeNumbers, requireCite = false }) {
  const resolved = resolveCites(cite, articles, macro);
  if (!resolved) return { ok: false, reason: `없는 근거 번호 ${JSON.stringify(cite)}` };
  const nums = bigNums(text);
  if (!resolved.length) {
    if (requireCite) return { ok: false, reason: '근거 문장 번호 없음' };
    // 근거 없는 문장은 숫자 서술만 — 숫자가 없거나 코드 숫자 줄에 없는 숫자가 있으면 지어낸 서술일 수 있다(2026-10-26 철강 업황 원인)
    if (!nums.length || nums.some(n => !codeNumbers.has(n))) return { ok: false, reason: '근거 문장 번호 없음(코드 숫자를 말하는 문장 아님)' };
    const strict = strictMissing(text, codeNumbers);
    if (strict.length) return { ok: false, reason: `코드 숫자에 없는 수 ${strict.join(',')}` };
    return { ok: true, articles: [] };
  }
  const pool = new Set([...codeNumbers, ...sourceValues(resolved.map(r => r.sentence))]);
  const miss = nums.filter(n => !pool.has(n));
  if (miss.length) return { ok: false, reason: `인용 문장·코드 숫자에 없는 숫자 ${miss.join(',')}` };
  // 1~2자리 단위 수·만·억 수 — 규모어(백만·십억)는 인용 문장에서 확인한다
  const strict = strictMissing(text, pool, resolved.map(r => r.sentence));
  if (strict.length) return { ok: false, reason: `인용 문장·코드 숫자에 없는 수 ${strict.join(',')}` };
  return { ok: true, articles: [...new Set(resolved.map(r => r.article))] };
}

// 입력에서 코드가 만든 숫자 줄(【근거 기사】 앞)의 숫자 — 1~2자리 수까지 모두(엄격 대조에 쓴다)
export const codeNumbersOf = (input) => sourceValues([String(input).split('【근거 기사】')[0]]);
