// api/_lib/recycleinme.js — 해외 알루미늄 스크랩 야드 매입가 (recycleinme, 결정적)
// 국가별 목록 페이지의 data-page(Inertia JSON)에 등급별 최신가가 들어 있다 — 헤드리스 불필요.
// 사이트 라벨이 섞여 있다: "Canada Scrap Prices" 페이지는 제목·Category가 UK로 나오지만, 같은 값이
// 상단 시세 띠에는 Canada로 표시되고 단위도 북미식 lb다. 그래서 그 페이지의 lb 행은 캐나다,
// 톤 단위 행(Zorba·Wheel)만 영국으로 본다. (2026-10-03 확인, 사이트가 라벨을 고치면 재검토)

const LB_TO_T = 2204.62;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

export const SCRAP_COUNTRIES = { us: '미국', ca: '캐나다', uk: '영국' };
const PAGES = ['Us Scrap Prices', 'Canada Scrap Prices'];

function countryOf(row, perLb) {
  if (row?.Category === 'US Scrap Prices') return 'us';
  if (row?.Category === 'UK Scrap Prices' || row?.Category === 'Canada Scrap Prices') return perLb ? 'ca' : 'uk';
  return null;
}

const ALUMINUM_RE = /(^|\s)(al|alum|aluminum|aluminium)\b|ubc|zorba|acsr/i;

export function decodeDataPage(html) {
  const m = String(html).match(/data-page="((?:[^"]|&quot;)*)"/);
  if (!m) return null;
  return JSON.parse(m[1]
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

// 목록 JSON → { us: {date, items[]}, ca: ..., uk: ... } (알루미늄 등급만)
// 단위: Pound/Lbs → usd_lb, Tons → usd_t. open은 직전 종가라 change = close - open.
export function parseScrapListing(page) {
  const groups = page?.props?.latestPricesForCategories;
  if (!groups || typeof groups !== 'object') return {};
  const out = {};
  for (const row of Object.values(groups).flat()) {
    const grade = String(row?.Subcat ?? '').trim();
    if (!ALUMINUM_RE.test(grade)) continue;
    const close = Number(row.ClosePrice), open = Number(row.OpenPrice);
    if (!(close > 0)) continue;
    const perLb = /^(pound|lbs?)$/i.test(row.Units ?? '');
    const perT = /^tons?$/i.test(row.Units ?? '');
    if (!perLb && !perT) continue;
    const code = countryOf(row, perLb);
    if (!code) continue;
    const usdT = perLb ? close * LB_TO_T : close;
    // 비현실값 제거 — 상한은 구리 혼합 등급(Al-Cu 라디에이터 ≈ 8,900달러)까지 허용
    if (usdT < 200 || usdT > 12000) continue;
    const date = String(row.Dat ?? '').slice(0, 10) || null;
    const item = {
      grade,
      usd_lb: perLb ? +close.toFixed(4) : null,
      usd_t: Math.round(usdT),
      change_pct: open > 0 ? +(((close - open) / open) * 100).toFixed(2) : null,
      date,
      currency: row.Currency ?? null,
      term: row.PriceTerm || null,
    };
    out[code] ??= { date: null, items: [] };
    if (!out[code].items.some(i => i.grade === grade)) out[code].items.push(item);
    if (date && (!out[code].date || date > out[code].date)) out[code].date = date;
  }
  return out;
}

async function fetchListing(page) {
  const url = `https://www.recycleinme.com/scrappricelisting/${encodeURIComponent(page)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeDataPage(await res.text());
}

// 국가별 목록을 모두 받아 합친다. 한 페이지가 실패해도 다른 페이지에 섞여 온 행으로 보충된다.
export async function fetchOverseasAluminumScrap() {
  const pages = await Promise.all(PAGES.map(p =>
    fetchListing(p).catch(e => { console.warn(`[recycleinme] ${p} 실패:`, e.message); return null; })));
  const merged = {};
  for (const p of pages) {
    for (const [code, g] of Object.entries(parseScrapListing(p))) {
      merged[code] ??= { date: null, items: [] };
      for (const it of g.items) if (!merged[code].items.some(i => i.grade === it.grade)) merged[code].items.push(it);
      if (g.date && (!merged[code].date || g.date > merged[code].date)) merged[code].date = g.date;
    }
  }
  const summary = Object.entries(merged).map(([k, v]) => `${k}=${v.items.length}`).join(' ');
  console.log(`[recycleinme] 알루미늄 스크랩 ${summary || '0'}`);
  return merged;
}
