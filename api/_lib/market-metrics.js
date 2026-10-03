// api/_lib/market-metrics.js — 시장별 결정적 지표 (변동률·1년 위치·방향·구매 신호·환율 효과)
// LLM은 이 값을 해석만 한다. 방향과 구매 신호는 숫자 규칙으로 정하고 LLM이 바꾸지 못한다.

const TRADING = { d1: 1, w1: 5, m1: 21 };
const DIR_PCT = 1.5; // 주간 ±1.5% 이상이면 방향 있음

// history: [{d, key: value}] 오래된 순 → 특정 키의 지표 (순수 함수 — 테스트 대상)
export function seriesStats(history, key) {
  const rows = history.filter(r => Number.isFinite(r?.[key]));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const back = (n) => (rows.length > n ? rows[rows.length - 1 - n][key] : null);
  const pct = (prev) => (prev ? +(((last[key] - prev) / prev) * 100).toFixed(2) : null);
  const yearAgo = new Date(Date.parse(last.d) - 365 * 86400000).toISOString().slice(0, 10);
  const year = rows.filter(r => r.d >= yearAgo).map(r => r[key]);
  const lo = Math.min(...year), hi = Math.max(...year);
  return {
    value: last[key],
    date: last.d,
    d1_pct: pct(back(TRADING.d1)),
    w1_pct: pct(back(TRADING.w1)),
    m1_pct: pct(back(TRADING.m1)),
    y_low: lo,
    y_high: hi,
    y_pos: hi > lo ? Math.round(((last[key] - lo) / (hi - lo)) * 100) : 50, // 0=1년 최저, 100=1년 최고
    spark: rows.slice(-30).map(r => r[key]),
  };
}

// 주간·월간 변동으로 방향 결정. 주간이 기준이고, 월간이 반대면 '혼조'
export function direction(stats) {
  if (!stats || stats.w1_pct == null) return 'flat';
  const w = stats.w1_pct, m = stats.m1_pct ?? 0;
  if (w >= DIR_PCT) return m <= -DIR_PCT * 2 ? 'mixed' : 'up';
  if (w <= -DIR_PCT) return m >= DIR_PCT * 2 ? 'mixed' : 'down';
  return 'flat';
}

// 구매자(제강사) 관점: 가격 하락 = 유리. 철강 업황은 원자재 수요 관점.
export function buySignal(dir, kind = 'price') {
  if (kind === 'demand') return { up: '수요 개선', down: '수요 약함', flat: '수요 보합', mixed: '수요 혼조' }[dir];
  return { up: '구매 불리', down: '구매 유리', flat: '관망', mixed: '관망' }[dir];
}

// 시장 정의: 주 지표(방향 판정)와 보조 지표. ccy는 원화 환산 시 사용(USD 표시가는 환율 효과 계산)
export const MARKET_SERIES = {
  ferro:  { kind: 'price', main: 'sf', keys: [['sf', 'FeSi 선물(ZCE)', 'CNY/t'], ['sm', 'SiMn 선물(ZCE)', 'CNY/t']], ccy: 'CNY' },
  al1:    { kind: 'price', main: 'lme', keys: [['lme', 'LME 알루미늄', 'USD/t'], ['al', 'SHFE 1차 알루미늄', 'CNY/t']], ccy: 'USD' },
  al2:    { kind: 'price', main: 'ad', keys: [['ad', 'SHFE 2차 알루미늄(주조합금)', 'CNY/t'], ['al', 'SHFE 1차 알루미늄', 'CNY/t']], ccy: 'CNY' },
  recarb: { kind: 'price', main: 'jm', keys: [['jm', '원료탄 선물(DCE)', 'CNY/t'], ['j', '코크스 선물(DCE)', 'CNY/t']], ccy: 'CNY' },
  steel:  { kind: 'demand', main: 'rb', keys: [['rb', '철근 선물(SHFE)', 'CNY/t'], ['hc', '열연 선물(SHFE)', 'CNY/t']], ccy: 'CNY' },
};

// 원화 구매가 = 현지 가격 변동 + 환율 변동. CNY 표시 품목은 CNY→KRW 교차환율(USD/KRW ÷ USD/CNY) 변동을 쓴다.
export function krwEffect(history, mainKey, ccy) {
  const local = seriesStats(history, mainKey);
  const fxRows = history
    .filter(r => Number.isFinite(r.usdkrw) && (ccy === 'USD' || Number.isFinite(r.cnyusd)))
    .map(r => ({ d: r.d, fx: ccy === 'USD' ? r.usdkrw : r.usdkrw * r.cnyusd }));
  const fx = seriesStats(fxRows, 'fx');
  if (local?.w1_pct == null || fx?.w1_pct == null) return null;
  const total = +(((1 + local.w1_pct / 100) * (1 + fx.w1_pct / 100) - 1) * 100).toFixed(2);
  return { price_pct: local.w1_pct, fx_pct: fx.w1_pct, krw_pct: total, basis: '주간' };
}

export function marketMetrics(market, history) {
  const def = MARKET_SERIES[market];
  const series = def.keys.map(([key, label, unit]) => ({ key, label, unit, ...(seriesStats(history, key) ?? {}) }))
    .filter(s => s.value != null);
  const main = series.find(s => s.key === def.main) ?? null;
  const dir = direction(main);
  return {
    market,
    direction: dir,
    signal: buySignal(dir, def.kind),
    series,
    krw: def.kind === 'price' ? krwEffect(history, def.main, def.ccy) : null,
  };
}
