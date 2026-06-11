// api/_lib/market-config.js — 시장·입찰 관련 수동 설정 (사용자가 직접 관리)

// 합금철 중국 수출 관세율 — 변경 시 MOFCOM 공식 고시 확인 후 수정
export const FERRO_EXPORT_TARIFFS = {
  fesi: { pct: 25, misc_usd: 15, hs: 'HS 72022100, 72022900' },
  femn: { pct: 20, misc_usd: 15, hs: 'HS 72021100, 72021900' },
  simn: { pct: 20, misc_usd: 15, hs: 'HS 72023000' },
};

// 한국 착 환산용 해상운임 가정 (중국 → 한국, USD/MT). 명시적 '가정'으로 UI에 표기됨.
export const FREIGHT_CN_KR_USD_PER_MT = 50;

// 품목별 입찰 월 (1~12). 설정하면 "지난 입찰 시점 대비 ±%" 배지가 표시된다.
// 예: { fesi: [3, 9], simn: [3, 9], femn: [1, 7] } — 미설정 시 배지 숨김.
export const BID_MONTHS = {
  fesi: [],
  femn: [],
  simn: [],
};

// 가격 시계열에서 직전 입찰 월의 첫 데이터를 기준점으로 찾는다.
// @param {Array<{d: string}>} history - 날짜 오름차순, 품목 값 필드 포함
// @param {number[]} bidMonths - 입찰 월 배열
// @param {string} valueKey - history 항목에서 읽을 값 필드명
// @returns {{ baseline: number, date: string }|null}
export function findBidBaseline(history, bidMonths, valueKey) {
  if (!Array.isArray(history) || history.length === 0) return null;
  if (!Array.isArray(bidMonths) || bidMonths.length === 0) return null;
  const now = new Date(Date.now() + 9 * 3600000);
  // 최근 12개월 내 가장 가까운 과거 입찰 월 산출
  for (let back = 0; back < 12; back++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const m = dt.getMonth() + 1;
    if (!bidMonths.includes(m)) continue;
    const ym = `${dt.getFullYear()}-${String(m).padStart(2, '0')}`;
    const entry = history.find(h => h.d?.startsWith(ym) && h[valueKey] != null);
    if (entry) return { baseline: entry[valueKey], date: entry.d };
    return null; // 입찰 월은 찾았으나 데이터 없음 — 표시 생략
  }
  return null;
}
