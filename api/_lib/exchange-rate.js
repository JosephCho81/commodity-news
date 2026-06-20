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
