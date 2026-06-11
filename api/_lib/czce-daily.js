// api/_lib/czce-daily.js — 정저우상품거래소 공식 일일 정적파일 소스 (SF/SM)
// URL 패턴: /cn/DFSStaticFiles/Future/{yyyy}/{yyyymmdd}/FutureDataDaily.txt (GBK)
// sina 장애 시 fallback + 가격 시계열 콜드스타트 백필에 사용.

// 컬럼: 합약코드|전정산|시가|고가|저가|종가|금일정산|...|거래량|미결제약정|...
// 품목별 주력 = 미결제약정 최대 월물 (순수 함수 — 테스트 대상)
export function parseCzceText(text, productPrefix) {
  const num = (s) => {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let best = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith(productPrefix)) continue;
    const c = line.split('|').map(s => s.trim());
    if (c.length < 11) continue;
    if (!/^[A-Z]{1,2}\d{3}$/.test(c[0])) continue;
    const oi = num(c[10]) ?? 0;
    if (!best || oi > best.open_interest) {
      const settle = num(c[6]);
      const prev = num(c[1]);
      if (settle === null) continue;
      best = {
        contract: c[0],
        settle,
        prev_settle: prev,
        change: prev !== null ? +(settle - prev).toFixed(2) : null,
        volume: num(c[9]),
        open_interest: oi,
      };
    }
  }
  return best;
}

async function decodeGbk(res) {
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    // ICU에 gbk가 없는 환경 — 숫자·코드는 ASCII라 latin1로도 파싱 가능
    return new TextDecoder('latin1').decode(buf);
  }
}

export async function fetchCzceDaily(dateStr) {
  const ymd = dateStr.replace(/-/g, '');
  const url = `http://www.czce.com.cn/cn/DFSStaticFiles/Future/${ymd.slice(0, 4)}/${ymd}/FutureDataDaily.txt`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`czce HTTP ${res.status}`);
  return decodeGbk(res);
}

/**
 * 합금철 가격 시계열 콜드스타트 백필 — 최근 N일 SF/SM 정산가.
 * 휴장일은 자동 스킵. 병렬 fetch (정적파일이라 빠름).
 * @returns {Promise<Array<{d: string, sf: number|null, sm: number|null}>>} 날짜 오름차순
 */
export async function backfillZceHistory(days = 14) {
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.now() + 9 * 3600000 - (i + 1) * 86400000).toISOString().slice(0, 10)
  );
  const settled = await Promise.allSettled(dates.map(async (d) => {
    const text = await fetchCzceDaily(d);
    const sf = parseCzceText(text, 'SF');
    const sm = parseCzceText(text, 'SM');
    return { d, sf: sf?.settle ?? null, sm: sm?.settle ?? null };
  }));
  const rows = settled
    .filter(s => s.status === 'fulfilled' && (s.value.sf || s.value.sm))
    .map(s => s.value)
    .sort((a, b) => a.d.localeCompare(b.d));
  console.log(`[ZCE] 백필: ${rows.length}/${days}일 수집`);
  return rows;
}
