// api/_lib/snapshot.js — 시장 숫자 스냅샷 (하루 1회 수집, 모든 화면이 같은 값을 쓴다)
// 숫자는 결정적 소스에서만 가져오고, 수집 실패한 항목은 null + errors에 기록(추정값으로 채우지 않음).
// 저장: commodity_cache/market_snapshot_{KST날짜} + market_snapshot_latest, 시계열은 price_history_market.

import { saveToFirestore, getFromFirestore } from './firebase.js';
import { fetchLmePrice } from './lme-data.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchUSDKRWRate, fetchCNYUSDRate, fetchJPYUSDRate } from './exchange-rate.js';
import { fetchOverseasAluminumScrap } from './recycleinme.js';
import { fetchAnthraciteImports } from './customs.js';
import { getKSTDate, readPriceHistory } from './cache-store.js';
import { buildBackfill, mergeHistory } from './history-backfill.js';

export const FUTURES_KEYS = ['sf', 'sm', 'jm', 'j', 'al', 'ad', 'rb', 'hc'];
const HISTORY_DAYS = 400; // 1년 범위(최저·최고) 계산용
const BACKFILL_BELOW = 200; // 시계열이 이보다 짧으면 과거분을 소스에서 채운다

// 스냅샷 → 시계열 행들 (순수 함수 — 테스트 대상)
// 값마다 실제 거래일 날짜로 넣는다. 수집일로 넣으면 휴장일에 직전 값이 한 번 더 쌓여 변동률이 0으로 왜곡된다.
export function toHistoryEntries(snap) {
  const rows = new Map();
  const put = (d, k, v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') || !(v > 0)) return;
    rows.set(d, { ...(rows.get(d) ?? { d }), [k]: v });
  };
  put(snap.lme_al?.date, 'lme', Number(snap.lme_al?.price));
  for (const k of FUTURES_KEYS) put(snap.futures?.[k]?.date, k, Number(snap.futures?.[k]?.settle));
  // 환율 수집일 = 조회일. 주말에는 직전 영업일 값이라 넣지 않는다
  const fxDate = snap.fx?.usd_krw?.date;
  const dow = fxDate ? new Date(`${fxDate}T00:00:00Z`).getUTCDay() : 0;
  if (dow !== 0 && dow !== 6) {
    put(fxDate, 'usdkrw', snap.fx?.usd_krw?.rate);
    put(fxDate, 'cnyusd', snap.fx?.cny_usd?.rate);
  }
  for (const [code, g] of Object.entries(snap.scrap_overseas ?? {})) {
    for (const it of g.items ?? []) {
      if (!(it.usd_t > 0) || !it.date) continue;
      const r = rows.get(it.date) ?? { d: it.date };
      r.scrap = { ...(r.scrap ?? {}), [`${code}:${it.grade}`]: it.usd_t };
      rows.set(it.date, r);
    }
  }
  return [...rows.values()].sort((x, y) => x.d.localeCompare(y.d));
}

export async function collectSnapshot(token) {
  const helpers = { saveToFirestore, getFromFirestore };
  const errors = [];
  const guard = (name, p) => p.catch(e => { errors.push(`${name}: ${e.message}`); return null; });

  const [usdKrw, cnyUsd, jpyUsd, lme, futures, scrapOverseas, krLatest, customs] = await Promise.all([
    guard('usd_krw', fetchUSDKRWRate(token, helpers)),
    guard('cny_usd', fetchCNYUSDRate(token, helpers)),
    guard('jpy_usd', fetchJPYUSDRate(token, helpers)),
    guard('lme_al', fetchLmePrice()),
    guard('futures', fetchZceFutures(FUTURES_KEYS)),
    guard('scrap_overseas', fetchOverseasAluminumScrap()),
    token ? guard('scrap_kr', getFromFirestore(token, 'kr_scrap_weekly', '_latest')) : Promise.resolve(null),
    guard('anthracite_customs', fetchAnthraciteImports()),
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
  if (!customs) errors.push('anthracite_customs: 수집 실패 또는 인증키 없음');

  return {
    date: getKSTDate(),
    collected_at: new Date().toISOString(),
    fx,
    lme_al: lme,
    futures: futures ?? {},
    scrap_overseas: scrapOverseas ?? {},
    scrap_kr: scrapKr,
    anthracite_customs: customs,
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
    const incoming = history.length < BACKFILL_BELOW ? await buildBackfill(snap, FUTURES_KEYS, HISTORY_DAYS).catch(() => []) : [];
    // 방금 수집한 실측값이 우선, 그다음 기존 기록, 백필은 빈 칸만 채운다
    const merged = mergeHistory(toHistoryEntries(snap), mergeHistory(history, incoming, HISTORY_DAYS), HISTORY_DAYS);
    await saveToFirestore(token, 'commodity_cache', 'price_history_market', { items: JSON.stringify(merged), updated_at: String(Date.now()) });
  }
  console.log(`[Snapshot] ${snap.date} 수집 완료 — 누락 ${snap.errors.length}건${snap.errors.length ? ': ' + snap.errors.join(' / ') : ''}`);
  return snap;
}
