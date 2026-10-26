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
    return { ok: true, articles: [] };
  }
  const pool = new Set([...codeNumbers, ...resolved.flatMap(r => bigNums(r.sentence))]);
  const miss = nums.filter(n => !pool.has(n));
  if (miss.length) return { ok: false, reason: `인용 문장·코드 숫자에 없는 숫자 ${miss.join(',')}` };
  return { ok: true, articles: [...new Set(resolved.map(r => r.article))] };
}

// 입력에서 코드가 만든 숫자 줄(【근거 기사】 앞)의 숫자
export const codeNumbersOf = (input) => new Set(bigNums(String(input).split('【근거 기사】')[0]));
