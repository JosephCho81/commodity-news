// api/_lib/snapshot.js — 시장 숫자 스냅샷 (하루 1회 수집, 모든 화면이 같은 값을 쓴다)
// 숫자는 결정적 소스에서만 가져오고, 수집 실패한 항목은 null + errors에 기록(추정값으로 채우지 않음).
// 저장: commodity_cache/market_snapshot_{KST날짜} + market_snapshot_latest, 시계열은 price_history_market.

import { saveToFirestore, getFromFirestore } from './firebase.js';
import { fetchLmePrice } from './lme-data.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchUSDKRWRate, fetchCNYUSDRate, fetchJPYUSDRate } from './exchange-rate.js';
import { fetchOverseasAluminumScrap } from './recycleinme.js';
import { getKSTDate, readPriceHistory, savePriceHistory } from './cache-store.js';

export const FUTURES_KEYS = ['sf', 'sm', 'jm', 'j', 'al', 'ad', 'rb', 'hc'];
const HISTORY_DAYS = 400; // 1년 범위(최저·최고) 계산용

// 스냅샷 → 시계열 1행 (순수 함수 — 테스트 대상)
export function toHistoryEntry(snap) {
  const e = { d: snap.date };
  const lme = Number(snap.lme_al?.price);
  if (lme > 0) e.lme = lme;
  for (const k of FUTURES_KEYS) {
    const v = Number(snap.futures?.[k]?.settle);
    if (v > 0) e[k] = v;
  }
  if (snap.fx?.usd_krw?.rate > 0) e.usdkrw = snap.fx.usd_krw.rate;
  if (snap.fx?.cny_usd?.rate > 0) e.cnyusd = snap.fx.cny_usd.rate;
  const scrap = {};
  for (const [code, g] of Object.entries(snap.scrap_overseas ?? {})) {
    for (const it of g.items ?? []) if (it.usd_t > 0) scrap[`${code}:${it.grade}`] = it.usd_t;
  }
  if (Object.keys(scrap).length) e.scrap = scrap;
  return e;
}

export async function collectSnapshot(token) {
  const helpers = { saveToFirestore, getFromFirestore };
  const errors = [];
  const guard = (name, p) => p.catch(e => { errors.push(`${name}: ${e.message}`); return null; });

  const [usdKrw, cnyUsd, jpyUsd, lme, futures, scrapOverseas, krLatest] = await Promise.all([
    guard('usd_krw', fetchUSDKRWRate(token, helpers)),
    guard('cny_usd', fetchCNYUSDRate(token, helpers)),
    guard('jpy_usd', fetchJPYUSDRate(token, helpers)),
    guard('lme_al', fetchLmePrice()),
    guard('futures', fetchZceFutures(FUTURES_KEYS)),
    guard('scrap_overseas', fetchOverseasAluminumScrap()),
    token ? guard('scrap_kr', getFromFirestore(token, 'kr_scrap_weekly', '_latest')) : Promise.resolve(null),
  ]);

  // 환율 상수 fallback은 숫자처럼 보이지만 실측이 아니다 — 스냅샷에는 넣지 않는다
  const fx = {};
  for (const [k, v] of [['usd_krw', usdKrw], ['cny_usd', cnyUsd], ['jpy_usd', jpyUsd]]) {
    if (v && v.source !== 'constant') fx[k] = { rate: v.rate, date: v.date, source: v.source };
    else errors.push(`${k}: 실측값 없음`);
  }
  if (!lme) errors.push('lme_al: 수집 실패');
  for (const k of FUTURES_KEYS) if (!futures?.[k]) errors.push(`futures.${k}: 수집 실패`);
  for (const c of ['us', 'ca']) if (!scrapOverseas?.[c]?.items?.length) errors.push(`scrap_overseas.${c}: 수집 실패`);

  let scrapKr = null;
  try { scrapKr = krLatest?.record ? JSON.parse(krLatest.record) : null; } catch { scrapKr = null; }
  if (!scrapKr?.items?.length) errors.push('scrap_kr: 보관 기록 없음');

  return {
    date: getKSTDate(),
    collected_at: new Date().toISOString(),
    fx,
    lme_al: lme,
    futures: futures ?? {},
    scrap_overseas: scrapOverseas ?? {},
    scrap_kr: scrapKr,
    anthracite_customs: null, // 관세청 월간 수입단가 — 인증키 등록 후 연결
    errors,
  };
}

// 수집 → 저장 → 시계열 갱신. cron이 탭 생성 전에 호출한다.
export async function refreshSnapshot(token) {
  const snap = await collectSnapshot(token);
  if (token) {
    const payload = { data: JSON.stringify(snap), date: snap.date, collected_at: snap.collected_at };
    await Promise.all([
      saveToFirestore(token, 'commodity_cache', `market_snapshot_${snap.date}`, payload),
      saveToFirestore(token, 'commodity_cache', 'market_snapshot_latest', payload),
    ]);
    const history = await readPriceHistory(token, 'market');
    await savePriceHistory(token, 'market', history, toHistoryEntry(snap), HISTORY_DAYS);
  }
  console.log(`[Snapshot] ${snap.date} 수집 완료 — 누락 ${snap.errors.length}건${snap.errors.length ? ': ' + snap.errors.join(' / ') : ''}`);
  return snap;
}
