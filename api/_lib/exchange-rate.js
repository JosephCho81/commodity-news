// api/lib/exchange-rate.js — CNY/USD 일일 환율 (frankfurter.app, 무료/키 불필요)

const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * CNY/USD 환율 반환 (1 CNY = X USD)
 * 하루 1회 Firestore 캐시 사용, 실패 시 fallback
 */
export async function fetchCNYUSDRate(token, { saveToFirestore, getFromFirestore } = {}) {
  const today = getKSTDate();
  const docId = `CNY_USD_${today}`;

  // 1. Firestore 캐시 확인
  if (token && getFromFirestore) {
    try {
      const cached = await getFromFirestore(token, 'exchange_rate', docId);
      if (cached?.rate) {
        const rate = parseFloat(cached.rate);
        if (rate > 0) {
          console.log(`[ExRate] 캐시 HIT: 1 CNY = ${rate} USD`);
          return rate;
        }
      }
    } catch (e) {
      console.warn('[ExRate] 캐시 읽기 실패:', e.message);
    }
  }

  // 2. frankfurter.app API 호출 (1 CNY = X USD)
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=CNY&to=USD', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.USD;
    if (!rate || typeof rate !== 'number') throw new Error('rates.USD 없음');

    console.log(`[ExRate] API 성공: 1 CNY = ${rate} USD (≈ ${(1 / rate).toFixed(2)} CNY/USD)`);

    // 3. Firestore 저장
    if (token && saveToFirestore) {
      saveToFirestore(token, 'exchange_rate', docId, {
        rate: String(rate),
        date: today,
      }).catch(e => console.warn('[ExRate] 저장 실패:', e.message));
    }

    return rate;
  } catch (e) {
    console.warn(`[ExRate] API 실패, fallback 사용: ${e.message}`);
    return 0.1379; // fallback ≈ 7.25 CNY/USD
  }
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
