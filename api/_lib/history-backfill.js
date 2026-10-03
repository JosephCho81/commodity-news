// api/_lib/history-backfill.js — price_history_market 과거분 채우기 (1년 범위·30일 추이용)
// 스냅샷은 하루 1행씩만 쌓이므로, 시계열이 짧으면 각 소스의 과거 데이터로 한 번에 채운다.
// 소스: 중국 선물=신랑재경 일봉(정산가), LME=westmetall 표, 환율=frankfurter(ECB), 해외 스크랩=recycleinme 상세 1년치.

import { ZCE_SYMBOLS } from './zce-futures.js';
import { fetchLmeHistory } from './lme-data.js';
import { decodeDataPage } from './recycleinme.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const LB_TO_T = 2204.62;

// 같은 날짜는 기존 값이 우선(실측 스냅샷이 백필보다 정확), scrap은 등급 단위로 합친다 (순수 함수 — 테스트 대상)
export function mergeHistory(existing, incoming, maxDays) {
  const byDate = new Map();
  for (const e of incoming) if (e?.d) byDate.set(e.d, { ...e });
  for (const e of existing) {
    if (!e?.d) continue;
    const inc = byDate.get(e.d) ?? {};
    const scrap = (inc.scrap || e.scrap) ? { ...(inc.scrap ?? {}), ...(e.scrap ?? {}) } : undefined;
    byDate.set(e.d, { ...inc, ...e, ...(scrap ? { scrap } : {}) });
  }
  return [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-maxDays);
}

// 신랑재경 일봉 응답("var x=([...]);") → [{d, v}] — 정산가(s) 우선, 없으면 종가(c)
export function parseSinaDaily(text, bounds) {
  const m = /\((\[[\s\S]*\])\)/.exec(String(text));
  if (!m) return [];
  return JSON.parse(m[1])
    .map(r => ({ d: r.d, v: Number(r.s) > 0 ? Number(r.s) : Number(r.c) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d) && r.v >= bounds[0] && r.v <= bounds[1]);
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function futuresSeries(key, since) {
  const sym = ZCE_SYMBOLS[key];
  const text = await getText(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20x=/InnerFuturesNewService.getDailyKLine?symbol=${sym.sina}`);
  return parseSinaDaily(text, sym.bounds).filter(r => r.d >= since);
}

async function fxSeries(since) {
  const text = await getText(`https://api.frankfurter.app/${since}..?from=USD&to=KRW,CNY`);
  const rates = JSON.parse(text).rates ?? {};
  return Object.entries(rates).map(([d, r]) => ({ d, usdkrw: r.KRW, cnyusd: r.CNY ? +(1 / r.CNY).toFixed(6) : undefined }));
}

async function scrapSeries(code, grade, perLb, since) {
  const page = code === 'us' ? 'Us Scrap Prices' : 'Canada Scrap Prices';
  const html = await getText(`https://www.recycleinme.com/scrappricedetailedlisting/${encodeURIComponent(page)}/${encodeURIComponent(grade)}/1`);
  const rows = decodeDataPage(html)?.props?.oneyeardata ?? [];
  return rows
    .map(r => ({ d: String(r.Dat ?? '').slice(0, 10), v: Math.round(Number(r.closePrice) * (perLb ? LB_TO_T : 1)) }))
    .filter(r => r.d >= since && r.v >= 200 && r.v <= 12000);
}

// 현재 스냅샷에 있는 항목만 과거분을 채운다. 개별 소스 실패는 건너뛴다(부분 백필 허용).
export async function buildBackfill(snap, futuresKeys, days = 400) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = new Map();
  const put = (d, patch) => rows.set(d, { ...(rows.get(d) ?? { d }), ...patch });
  const putScrap = (d, k, v) => { const r = rows.get(d) ?? { d }; r.scrap = { ...(r.scrap ?? {}), [k]: v }; rows.set(d, r); };
  const failed = [];
  const tasks = [
    ...futuresKeys.filter(k => snap.futures?.[k]).map(k => futuresSeries(k, since)
      .then(s => s.forEach(r => put(r.d, { [k]: r.v }))).catch(() => failed.push(k))),
    fetchLmeHistory().then(s => s.filter(r => r.date >= since).forEach(r => put(r.date, { lme: r.price }))).catch(() => failed.push('lme')),
    fxSeries(since).then(s => s.forEach(({ d, ...v }) => put(d, v))).catch(() => failed.push('fx')),
  ];
  for (const [code, g] of Object.entries(snap.scrap_overseas ?? {})) {
    if (code === 'uk') continue; // 톤 단위 2개 등급 — 상세 경로 미확인
    for (const it of g.items ?? []) {
      tasks.push(scrapSeries(code, it.grade, it.usd_lb != null, since)
        .then(s => s.forEach(r => putScrap(r.d, `${code}:${it.grade}`, r.v))).catch(() => failed.push(`${code}:${it.grade}`)));
    }
  }
  await Promise.all(tasks);
  console.log(`[Backfill] ${rows.size}일치 생성${failed.length ? ` — 실패 ${failed.join(', ')}` : ''}`);
  return [...rows.values()];
}
