// api/_lib/market-metrics.js — 시장별 결정적 지표 (변동률·1년 위치·방향·분기 대비 변동·환율 효과)
// LLM은 이 값을 해석만 한다. 방향은 숫자 규칙으로 정하고 LLM이 바꾸지 못한다.
// 중국 선물(CNY)은 화면·LLM 입력 모두 달러로만 쓴다(위안 표시 금지) — 날짜별 환율로 여기서 환산한다.

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

// 시장 정의: 주 지표(방향 판정)와 보조 지표
export const MARKET_SERIES = {
  ferro:  { main: 'sf', keys: [['sf', 'FeSi 선물(ZCE)'], ['sm', 'SiMn 선물(ZCE)']] },
  al1:    { main: 'lme', keys: [['lme', 'LME 알루미늄'], ['al', 'SHFE 1차 알루미늄']] },
  al2:    { main: 'ad', keys: [['ad', 'SHFE 2차 알루미늄(주조합금)'], ['al', 'SHFE 1차 알루미늄']] },
  recarb: { main: 'jm', keys: [['jm', '원료탄 선물(DCE)'], ['j', '코크스 선물(DCE)']] },
  steel:  { main: 'rb', keys: [['rb', '철근 선물(SHFE)'], ['hc', '열연 선물(SHFE)']] },
};
export const CNY_KEYS = ['sf', 'sm', 'al', 'ad', 'jm', 'j', 'rb', 'hc'];

// 날짜별로 그날(없으면 직전) 환율을 붙인다. 환율 행은 수집일, 가격 행은 거래일이라 날짜가 어긋나기 때문.
// 위안 키 → USD/t(정수), krw_{키} → 원/t. 그 이전 환율이 없는 행은 환산하지 않는다(추정값 금지). (순수 함수)
export function withConverted(history) {
  let cnyusd = null, usdkrw = null;
  return history.map(r => {
    if (Number.isFinite(r.cnyusd)) cnyusd = r.cnyusd;
    if (Number.isFinite(r.usdkrw)) usdkrw = r.usdkrw;
    const out = { d: r.d, usdkrw: r.usdkrw };
    if (Number.isFinite(r.lme)) out.lme = r.lme;
    for (const k of CNY_KEYS) if (Number.isFinite(r[k]) && cnyusd) out[k] = Math.round(r[k] * cnyusd);
    if (usdkrw) for (const k of ['lme', ...CNY_KEYS]) if (Number.isFinite(out[k])) out[`krw_${k}`] = out[k] * usdkrw;
    return out;
  });
}

// 이번 분기 시작 직전(전 분기 마지막 거래일) 대비 변동. 입찰이 분기 단위라 직전 입찰 시점의 기준선 역할.
// 분기는 asOf(오늘) 기준 — 중국 연휴처럼 가격이 멈춰 있어도 분기가 뒤로 밀리지 않는다.
// 원화는 마지막 가격 × 최신 원/달러라 휴장 중에도 환율 변동은 반영된다. conv: withConverted 결과 (순수 함수)
export function quarterChange(conv, key, asOf) {
  const rows = conv.filter(r => Number.isFinite(r[key]));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const [y, m] = (asOf ?? last.d).split('-').map(Number);
  const q = Math.floor((m - 1) / 3);
  const qStart = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const base = rows.filter(r => r.d < qStart).pop();
  const fxNow = conv.filter(r => Number.isFinite(r.usdkrw)).pop()?.usdkrw;
  if (!base) return null;
  const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? +(((a - b) / b) * 100).toFixed(2) : null);
  return {
    quarter: `${y} ${q + 1}분기`,
    base_date: base.d,
    base: base[key],
    usd_pct: pct(last[key], base[key]),
    krw_pct: fxNow ? pct(last[key] * fxNow, base[`krw_${key}`]) : null,
  };
}

// 원화 구매가 주간 변동 = 달러 가격 변동 + 원/달러 변동
export function krwEffect(conv, mainKey) {
  const usd = seriesStats(conv, mainKey);
  const krw = seriesStats(conv, `krw_${mainKey}`);
  if (usd?.w1_pct == null || krw?.w1_pct == null) return null;
  const fx = +(((1 + krw.w1_pct / 100) / (1 + usd.w1_pct / 100) - 1) * 100).toFixed(2);
  return { price_pct: usd.w1_pct, fx_pct: fx, krw_pct: krw.w1_pct, basis: '주간' };
}

export function marketMetrics(market, history) {
  const def = MARKET_SERIES[market];
  const conv = withConverted(history);
  const asOf = history.length ? history[history.length - 1].d : null;
  const series = def.keys.map(([key, label]) => ({
    key,
    label: !CNY_KEYS.includes(key) ? label : label.endsWith(')') ? `${label.slice(0, -1)}, 달러 환산)` : `${label} (달러 환산)`,
    unit: 'USD/t',
    ...(seriesStats(conv, key) ?? {}),
  })).filter(s => s.value != null);
  const main = series.find(s => s.key === def.main) ?? null;
  return {
    market,
    direction: direction(main),
    quarter: quarterChange(conv, def.main, asOf),
    series,
    krw: market === 'steel' ? null : krwEffect(conv, def.main),
  };
}
