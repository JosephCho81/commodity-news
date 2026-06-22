// api/lib/exchange-rate.js — CNY/USD 일일 환율 (frankfurter.app, 무료/키 불필요)

import { PRICE_BOUNDS } from './validate.js';

const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// _latest 문서에서 마지막 성공 환율 읽기 (bound 체크 포함)
async function readLatestRate(token, getFromFirestore, pairKey, bounds) {
  if (!token || !getFromFirestore) return null;
  try {
    const doc = await getFromFirestore(token, 'exchange_rate', `${pairKey}_latest`);
    const rate = parseFloat(doc?.rate);
    if (rate > 0 && (!bounds || (rate >= bounds[0] && rate <= bounds[1]))) {
      return { rate, date: doc.date ?? null };
    }
  } catch (e) {
    console.warn(`[ExRate] ${pairKey}_latest 읽기 실패:`, e.message);
  }
  return null;
}

async function fetchRate(token, helpers, { pairKey, from, to, bounds, constantFallback }) {
  const { saveToFirestore, getFromFirestore } = helpers;
  const today = getKSTDate();
  const docId = `${pairKey}_${today}`;

  // 1. 오늘자 Firestore 캐시
  if (token && getFromFirestore) {
    try {
      const cached = await getFromFirestore(token, 'exchange_rate', docId);
      if (cached?.rate) {
        const rate = parseFloat(cached.rate);
        if (rate > 0) {
          console.log(`[ExRate] 캐시 HIT: 1 ${from} = ${rate} ${to}`);
          return { rate, source: 'cache', date: today };
        }
      }
    } catch (e) {
      console.warn('[ExRate] 캐시 읽기 실패:', e.message);
    }
  }

  // 2. frankfurter.app API
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.[to];
    if (!rate || typeof rate !== 'number') throw new Error(`rates.${to} 없음`);

    console.log(`[ExRate] API 성공: 1 ${from} = ${rate} ${to}`);

    if (token && saveToFirestore) {
      const payload = { rate: String(rate), date: today };
      Promise.all([
        saveToFirestore(token, 'exchange_rate', docId, payload),
        saveToFirestore(token, 'exchange_rate', `${pairKey}_latest`, payload),
      ]).catch(e => console.warn('[ExRate] 저장 실패:', e.message));
    }

    return { rate, source: 'api', date: today };
  } catch (e) {
    console.warn(`[ExRate] API 실패: ${e.message} — _latest fallback 시도`);
  }

  // 3. 마지막 성공값 (_latest)
  const latest = await readLatestRate(token, getFromFirestore, pairKey, bounds);
  if (latest) {
    console.warn(`[ExRate] _latest 사용: 1 ${from} = ${latest.rate} ${to} (${latest.date} 기준)`);
    return { rate: latest.rate, source: 'cache_latest', date: latest.date };
  }

  // 4. 최후의 상수
  console.warn(`[ExRate] 상수 fallback 사용: ${constantFallback}`);
  return { rate: constantFallback, source: 'constant', date: null };
}

/**
 * CNY/USD 환율 (1 CNY = X USD)
 * @returns {Promise<{ rate: number, source: 'cache'|'api'|'cache_latest'|'constant', date: string|null }>}
 */
export async function fetchCNYUSDRate(token, helpers = {}) {
  return fetchRate(token, helpers, {
    pairKey: 'CNY_USD', from: 'CNY', to: 'USD',
    bounds: PRICE_BOUNDS.cny_usd, constantFallback: 0.1379,
  });
}

/**
 * USD/KRW 환율 (1 USD = X KRW)
 * @returns {Promise<{ rate: number, source: 'cache'|'api'|'cache_latest'|'constant', date: string|null }>}
 */
export async function fetchUSDKRWRate(token, helpers = {}) {
  return fetchRate(token, helpers, {
    pairKey: 'USD_KRW', from: 'USD', to: 'KRW',
    bounds: PRICE_BOUNDS.usd_krw, constantFallback: 1480,
  });
}

/**
 * JPY/USD 환율 (1 JPY = X USD)
 * @returns {Promise<{ rate: number, source: 'cache'|'api'|'cache_latest'|'constant', date: string|null }>}
 */
export async function fetchJPYUSDRate(token, helpers = {}) {
  return fetchRate(token, helpers, {
    pairKey: 'JPY_USD', from: 'JPY', to: 'USD',
    bounds: PRICE_BOUNDS.jpy_usd, constantFallback: 0.0064,
  });
}

/**
 * 특정 과거일자 USD/KRW 환율 (1 USD = X KRW) — 원가 환율분해의 '전월 대비' 기준점.
 * frankfurter historical: GET /{YYYY-MM-DD} (주말/공휴일이면 직전 영업일로 자동 조정).
 * historical 값은 불변이므로 Firestore에 영구 캐시. 실패 시 null(상수 fallback 없음 —
 * 분해는 정확한 실거래 환율이 있을 때만 수행).
 * @returns {Promise<{ rate: number, source: 'cache'|'api', date: string }|null>}
 */
export async function fetchUSDKRWRateOn(dateStr, token, helpers = {}) {
  const { saveToFirestore, getFromFirestore } = helpers;
  const bounds = PRICE_BOUNDS.usd_krw;
  const docId = `USD_KRW_${dateStr}`;

  if (token && getFromFirestore) {
    try {
      const cached = await getFromFirestore(token, 'exchange_rate', docId);
      const rate = parseFloat(cached?.rate);
      if (rate > 0 && rate >= bounds[0] && rate <= bounds[1]) {
        return { rate, source: 'cache', date: cached.date ?? dateStr };
      }
    } catch (e) {
      console.warn(`[ExRate] historical 캐시 읽기 실패 (${dateStr}):`, e.message);
    }
  }

  try {
    const res = await fetch(`https://api.frankfurter.app/${dateStr}?from=USD&to=KRW`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.KRW;
    if (!rate || typeof rate !== 'number') throw new Error('rates.KRW 없음');
    if (rate < bounds[0] || rate > bounds[1]) throw new Error(`bound 위반: ${rate}`);
    const actualDate = data.date ?? dateStr; // 영업일로 조정된 실제 날짜
    if (token && saveToFirestore) {
      saveToFirestore(token, 'exchange_rate', docId, { rate: String(rate), date: actualDate })
        .catch(e => console.warn('[ExRate] historical 저장 실패:', e.message));
    }
    console.log(`[ExRate] historical ${dateStr}→${actualDate}: 1 USD = ${rate} KRW`);
    return { rate, source: 'api', date: actualDate };
  } catch (e) {
    console.warn(`[ExRate] historical ${dateStr} 실패: ${e.message}`);
    return null;
  }
}

/**
 * 원화 원가 환율분해 — 전월 대비 원가 변동을 '시세 기여 vs 환율 기여'로 분리(전부 결정적).
 * 돈 직결 로직이므로 LLM을 거치지 않는다. 입력이 부족하면 가능한 항목만 채우고 null 반환 가능.
 * 단위: USD/MT × (KRW/USD) = KRW/MT.
 * @param {{ cifUsdNow:number|null, cifUsdPrev:number|null, rateNow:number|null, ratePrev:number|null, basis?:string }} a
 * @returns {{ basis:string|null, fx_contrib:number|null, px_contrib:number|null, total:number|null, line:string|null }|null}
 */
export function computeFxCostBreakdown({ cifUsdNow, cifUsdPrev, rateNow, ratePrev, basis = null }) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;
  const usdNow = n(cifUsdNow), usdPrev = n(cifUsdPrev), rNow = n(rateNow), rPrev = n(ratePrev);
  if (!rNow || !rPrev) return null; // 전월 대비 비교 불가
  const delta = rNow - rPrev;
  // 환율 기여: 전월 USD 단가를 고정하고 환율 변동분만 (USD 시세와 무관한 순수 환율 효과)
  const fx_contrib = usdPrev ? Math.round(usdPrev * delta) : null;
  // 시세 기여: USD 단가 변동분 × 현재 환율
  const px_contrib = (usdNow && usdPrev) ? Math.round((usdNow - usdPrev) * rNow) : null;
  const total = (fx_contrib !== null && px_contrib !== null) ? fx_contrib + px_contrib : null;
  if (fx_contrib === null && px_contrib === null) return null;
  const won = (x) => `${x >= 0 ? '+' : ''}${x.toLocaleString('ko-KR')}원`;
  let line = null;
  if (total !== null) {
    line = `전월 대비 원화원가 ${won(total)}/MT (환율 ${won(fx_contrib)} · 시세 ${won(px_contrib)})`;
  } else if (fx_contrib !== null) {
    line = `환율 변동분 ${won(fx_contrib)}/MT (전월 USD 단가 기준, 시세 비교는 데이터 부족)`;
  }
  return { basis, fx_contrib, px_contrib, total, line };
}

/**
 * CNY 숫자값을 USD로 변환
 * @param {string|number} val - "5950" or 5950 or "5,950"
 * @param {number} rate - 1 CNY = X USD (예: 0.1379)
 * @returns {string|null} - "821" (정수, 천단위 콤마)
 */
export function cnyToUsd(val, rate) {
  if (!val || !rate) return null;
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num) || num <= 0) return null;
  const usd = num * rate;
  // x,xxx.xx format (2 decimal, thousands separator)
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
