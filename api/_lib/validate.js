// api/_lib/validate.js — 결정적 가격 검증 + 뉴스 중복 제거 계층
// 원칙: LLM이 출력한 가격은 절대 검증 없이 통과시키지 않는다.

// ─── 숫자 정규화 ────────────────────────────────────────────────────────────
// "5,950" → 5950, "약 6000"/"N/A"/0 이하/NaN → null
export function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const cleaned = String(v).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// ─── 품목별 hard bound (프롬프트 참고범위보다 ±30% 넓게) ────────────────────
export const PRICE_BOUNDS = {
  fesi_cny:              [4000, 9000],   // 참고 5,500~7,000
  femn_cny:              [5000, 11000],  // 참고 6,500~8,500
  simn_cny:              [3500, 8500],   // 참고 4,800~6,500
  anthracite_china_fob:  [60, 280],      // 참고 100~180
  anthracite_russia_fob: [50, 220],      // 참고 80~150
  anthracite_cif_korea:  [60, 320],
  lme_al:                [1500, 4500],   // src/utils/format.ts isValidLmePrice와 동일
  mn_ore_cif:            [2, 12],        // USD/dmtu
  cny_usd:               [0.10, 0.18],
  usd_krw:               [1000, 1900],
};

// ─── bound + 전일 대비 변동률 검증 ──────────────────────────────────────────
// 반환: { value: number|null, rejected: boolean, reason: string|null }
export function validatePrice(raw, boundKey, prevValue = null, maxDailyChangePct = 10) {
  const value = toNumber(raw);
  if (value === null) {
    return { value: null, rejected: false, reason: raw == null ? null : `숫자 변환 실패: ${String(raw).slice(0, 30)}` };
  }
  const bounds = PRICE_BOUNDS[boundKey];
  if (bounds && (value < bounds[0] || value > bounds[1])) {
    return { value: null, rejected: true, reason: `${boundKey} bound [${bounds[0]}~${bounds[1]}] 위반: ${value}` };
  }
  const prev = toNumber(prevValue);
  if (prev !== null) {
    const changePct = Math.abs((value - prev) / prev) * 100;
    if (changePct > maxDailyChangePct) {
      return { value: null, rejected: true, reason: `${boundKey} 전일(${prev}) 대비 ${changePct.toFixed(1)}% 변동 > 한계 ${maxDailyChangePct}%` };
    }
  }
  return { value, rejected: false, reason: null };
}

// ─── carry-forward: 검증 실패/null 시 전일값 이월 ───────────────────────────
// as_of는 전일 데이터의 as_of(없으면 전일 캐시 날짜)를 유지 — 어제 가격을 오늘 것처럼 표시 금지
// 반환: { value, as_of, source, carried_over } 또는 전일값도 없으면 null
export function carryForward(prev, prevDate, { valueKey = 'price_cny', asOfKey = 'price_as_of', sourceKey = 'price_source' } = {}) {
  const prevValue = toNumber(prev?.[valueKey]);
  if (prevValue === null) return null;
  return {
    value: prevValue,
    as_of: prev?.[asOfKey] ?? prevDate ?? null,
    source: prev?.[sourceKey] ?? null,
    carried_over: true,
  };
}

// ─── 검색 내레이션·불확실 표현 제거 (결정적 후처리) ─────────────────────────
// "이번 검색 결과에 확인되지 않으며" 류 문구는 프롬프트 금지만으로 재발이 반복됨.
// 절(clause) 단위로 먼저 걷어내고, 그래도 남으면 해당 문장 전체를 제거한다.

// "…검색 결과에 확인되지 않으며, " 같은 연결절 — 콤마/세미콜론까지 제거
const NARRATION_CLAUSES = [
  /[^.,;]*검색[^.,;]*(?:확인|포착|발견)되지\s*않[^.,;]*[,;，]\s*/g,
  /[^.,;]*검색\s*결과[^.,;]*(?:없|부재|불가)[^.,;]*[,;，]\s*/g,
];

// 절 제거 후에도 남아 있으면 문장째 제거할 패턴
const UNCERTAINTY_PATTERN = new RegExp([
  '확인되지\\s*않', '포착되지\\s*않', '발견되지\\s*않',
  '확인\\s*불가', '미확인', '확인되지\\s*못',
  '정보\\s*없음', '정보\\s*부재', '데이터\\s*부재', '데이터\\s*없음',
  '구체적\\s*(?:데이터|수치)\\s*미확보', '최신\\s*동향\\s*미확보',
  '이번\\s*검색', '검색\\s*결과에', '검색\\s*범위',
].join('|'));

export function stripUncertainty(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const re of NARRATION_CLAUSES) out = out.replace(re, '');
  out = out
    .split(/(?<=\.)\s+/)
    .filter(s => !UNCERTAINTY_PATTERN.test(s))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (out !== text) console.log(`[Sanitize] 불확실 문구 제거: "${text.slice(0, 60)}…" → "${out.slice(0, 60)}…"`);
  return out.length > 0 ? out : null;
}

// 객체·배열을 재귀 순회하며 모든 문자열 필드에 stripUncertainty 적용 (in-place 아님)
export function stripUncertaintyDeep(value) {
  if (typeof value === 'string') return stripUncertainty(value);
  if (Array.isArray(value)) return value.map(stripUncertaintyDeep);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripUncertaintyDeep(v);
    return out;
  }
  return value;
}

// ─── 뉴스 중복 제거 (결정적) ────────────────────────────────────────────────
export const NEWS_DUP_JACCARD_THRESHOLD = 0.6;

function normalizeTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * @param {string} title - 새 뉴스 제목
 * @param {string|null} url - 새 뉴스 URL (있으면)
 * @param {Array<{t: string, u?: string|null}>} historyItems - 최근 보도 목록
 */
export function isDuplicateNews(title, url, historyItems) {
  if (!Array.isArray(historyItems) || historyItems.length === 0) return false;
  const norm = normalizeTitle(title);
  if (norm.length < 2) return false;
  const grams = bigrams(norm);
  for (const h of historyItems) {
    if (url && h.u && url === h.u) return true;
    const hNorm = normalizeTitle(h.t);
    if (hNorm.length < 2) continue;
    if (jaccard(grams, bigrams(hNorm)) >= NEWS_DUP_JACCARD_THRESHOLD) return true;
  }
  return false;
}

// key_issues 배열에서 히스토리 중복분 제거 (통과분만 반환)
export function dedupKeyIssues(issues, historyItems) {
  if (!Array.isArray(issues)) return [];
  return issues.filter(issue => {
    const dup = isDuplicateNews(issue?.title, issue?.url ?? null, historyItems);
    if (dup) console.log(`[Dedup] 중복 이슈 제거: ${issue?.title}`);
    return !dup;
  });
}

// ─── search_results 대조로 이슈에 url/발행일 부여 (LLM에 URL을 묻지 않음) ───
// 제목 토큰이 search_result 제목과 일부 겹치면 best-effort 매칭
export function attachSourceMeta(issues, searchResults) {
  if (!Array.isArray(issues) || !Array.isArray(searchResults) || searchResults.length === 0) return issues ?? [];
  for (const issue of issues) {
    if (!issue?.title || issue.url) continue;
    const issueGrams = bigrams(normalizeTitle(`${issue.title} ${issue.what ?? ''}`));
    let best = null, bestScore = 0;
    for (const sr of searchResults) {
      if (!sr?.title) continue;
      const score = jaccard(issueGrams, bigrams(normalizeTitle(sr.title)));
      if (score > bestScore) { bestScore = score; best = sr; }
    }
    if (best && bestScore >= 0.15) {
      issue.url = best.url ?? null;
      if (!issue.published_date && best.date) issue.published_date = best.date;
    }
  }
  return issues;
}
