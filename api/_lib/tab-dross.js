// api/_lib/tab-dross.js — 2차 알루미늄(스크랩·드로스·탈산제) 탭 모듈
// 스프레드(LME×함량·전해 vs 주조 선물)·스크랩은 결정적 수집값, LLM은 해석만.
// 드로스 자체 거래가는 공시가 없어 절대 숫자로 만들지 않는다(NULL 원칙).

import { toNumber, dedupKeyIssues, attachSourceMeta } from './validate.js';
import { saveToFirestore, getFromFirestore } from './firebase.js';
import { fetchCNYUSDRate, fetchJPYUSDRate } from './exchange-rate.js';
import { fetchLmePrice } from './lme-data.js';
import { fetchScrapPrices, fetchJapanScrapPrices } from './scrap-data.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchDrossNews, buildDrossNewsSection } from './dross-news.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory, issuesToHistory, readPriceHistory, savePriceHistory } from './cache-store.js';
import { getDrossPrompt } from '../_prompts/dross.js';

export const recency = 'month';
export const maxTokens = 3800;

// ─── 스크랩 매트릭스 (품목별 × 대륙) ─────────────────────────────────────────
// 우리 수집 라벨(scrap-data.js의 고정 키)을 캐논 품목 행으로 정규화 — LLM 무관, 결정적.
const SCRAP_ROW_DEFS = [
  ['UBC',      'UBC (음료캔)'],
  ['6063',     '6063 압출'],
  ['CAST',     'Old Cast (주물)'],
  ['SHEET',    'Old Sheet (판재)'],
  ['ZORBA',    'Zorba (혼합)'],
  ['CUTTINGS', 'Cuttings (절단재)'],
  ['TURNINGS', 'Turnings (선반칩)'],
  ['5052',     '5052'],
  ['INGOT',    'Ingots (잉곳)'],
  ['RADIATOR', 'Radiator'],
];

function scrapRowId(label) {
  const s = String(label).toLowerCase();
  if (s.includes('ubc')) return 'UBC';
  if (s.includes('6063')) return '6063';
  if (s.includes('old cast') || s.includes('cast aluminum')) return 'CAST';
  if (s.includes('sheet')) return 'SHEET';
  if (s.includes('zorba')) return 'ZORBA';
  if (s.includes('cutting')) return 'CUTTINGS';
  if (s.includes('turning')) return 'TURNINGS';
  if (s.includes('5052')) return '5052';
  if (s.includes('ingot')) return 'INGOT';
  if (s.includes('radiator')) return 'RADIATOR';
  return null; // 분류 불가 — 노이즈 방지 위해 매트릭스에서 제외
}

// 금속 함량이 높아 LME 대비 일정 비율 이상이어야 정상인 등급(동결/오류값 걸러내기용).
// 이 등급이 LME×0.5 미만이면 갱신지연·오파싱으로 보고 표시하지 않는다(잘못된 저가 노출 금지).
const SCRAP_METAL_RICH = new Set(['UBC', '6063', 'CAST', 'SHEET', 'ZORBA', '5052', 'CUTTINGS', 'INGOT']);

function buildScrapMatrix({ scrapPrices, japanScrap, cnyRate, jpyRate, lmeUsd }) {
  const floor = (Number.isFinite(lmeUsd) && lmeUsd > 0) ? lmeUsd * 0.5 : null;
  const sources = [
    { region: '미국', data: scrapPrices?.us, cur: 'USD', rate: 1 },
    { region: '유럽', data: scrapPrices?.eu, cur: 'USD', rate: 1 },
    { region: '중국', data: scrapPrices?.cn, cur: 'CNY', rate: cnyRate },
    { region: '일본', data: japanScrap?.prices, cur: 'JPY', rate: jpyRate },
  ];
  const rowMap = new Map();   // rowId -> { grade, cells }
  const regionsWithData = new Set();
  for (const src of sources) {
    if (!src.data || typeof src.data !== 'object') continue;
    for (const [rawLabel, rawVal] of Object.entries(src.data)) {
      const rowId = scrapRowId(rawLabel);
      if (!rowId) continue;
      const raw = Number(String(rawVal).replace(/,/g, ''));
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const usd = src.cur === 'USD'
        ? Math.round(raw)
        : (src.rate ? Math.round(raw * src.rate) : null);
      // LME 대비 비현실적으로 낮은 금속함량 등급은 동결/오류값 → 제외(잘못된 저가 노출 금지)
      if (floor && usd != null && SCRAP_METAL_RICH.has(rowId) && usd < floor) continue;
      if (!rowMap.has(rowId)) {
        const def = SCRAP_ROW_DEFS.find(([id]) => id === rowId);
        rowMap.set(rowId, { grade: def ? def[1] : rowId, cells: {} });
      }
      const row = rowMap.get(rowId);
      if (!row.cells[src.region]) {   // 같은 행에 여러 라벨이 매핑되면 먼저 본 값 유지
        row.cells[src.region] = { usd, raw: Math.round(raw), cur: src.cur };
        regionsWithData.add(src.region);
      }
    }
  }
  const rows = SCRAP_ROW_DEFS.map(([id]) => rowMap.get(id)).filter(Boolean);
  if (rows.length === 0) return null;
  const regions = ['미국', '유럽', '중국', '일본'].filter(r => regionsWithData.has(r));
  return { regions, rows };
}

export async function prefetch(token) {
  const [lmeData, scrapPrices, japanScrap, futures, drossNews, prev, newsHistory, krNews, priceHistory, cnyUsd, jpyUsd] = await Promise.all([
    fetchLmePrice().catch(() => null),
    fetchScrapPrices().catch(() => null),
    fetchJapanScrapPrices().catch(() => null),
    fetchZceFutures(['al', 'ad']).catch(() => ({})),
    fetchDrossNews().catch(() => null),
    fetchPrevDayData(token, 'dross'),
    readNewsHistory(token, 'dross'),
    fetchKoreanSteelNews('aluminum', 6).catch(() => []),
    readPriceHistory(token, 'dross'),
    fetchCNYUSDRate(token, { saveToFirestore, getFromFirestore }).catch(() => null),
    fetchJPYUSDRate(token, { saveToFirestore, getFromFirestore }).catch(() => null),
  ]);
  return { lmeData, scrapPrices, japanScrap, futures, drossNews, prev, newsHistory, krNews, priceHistory, cnyUsd, jpyUsd };
}

export function buildPrompt(ctx) {
  let prompt = getDrossPrompt(getKSTDate());

  if (ctx.prev) {
    const p = ctx.prev.data;
    prompt += `\n\n【전일 데이터 (${ctx.prev.date}) — 오늘과 비교해 달라진 것 서술】\n`;
    prompt += `전일 판단: 원료 ${p.headline_judgment?.feedstock ?? 'N/A'} · 수요 ${p.headline_judgment?.demand ?? 'N/A'} · 1차-2차 가격차 ${p.headline_judgment?.spread ?? 'N/A'}\n`;
    prompt += `전일 종합: ${p.market_summary?.slice(0, 120) ?? 'N/A'}\n`;
    prompt += `→ 달라진 것 없으면 "전일 수준 유지" 명시.\n`;
  }

  // 결정적 수집값 주입 — 전부 USD로 환산해 주입(서술도 USD만 쓰게). CNY/JPY는 LLM에 노출하지 않음.
  const { lmeData, futures, scrapPrices, japanScrap } = ctx;
  const cnyRate = ctx.cnyUsd?.rate ?? null;
  const jpyRate = ctx.jpyUsd?.rate ?? null;
  const usd = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
  let context = '\n\n【결정적 수집 데이터 — 아래 USD 수치만 사용, 다른 숫자·통화 금지】\n';
  if (lmeData?.price) context += `LME 1차 알루미늄 Cash: ${usd(lmeData.price)}/MT (${lmeData.date ?? ''})\n`;
  const alUsd = (futures?.al?.settle && cnyRate) ? futures.al.settle * cnyRate : null;
  const adUsd = (futures?.ad?.settle && cnyRate) ? futures.ad.settle * cnyRate : null;
  if (alUsd) context += `SHFE 1차 알루미늄: ${usd(alUsd)}/MT (${futures.al.change_pct ?? ''})\n`;
  if (adUsd) context += `SHFE 2차 알루미늄: ${usd(adUsd)}/MT (${futures.ad.change_pct ?? ''})\n`;
  if (alUsd && adUsd) {
    context += `→ 1차-2차 가격차: ${usd(alUsd - adUsd)}/MT (축소=2차가 1차에 근접=재생 원료 강세 / 확대=2차 저평가)\n`;
  }
  // 스크랩은 전부 USD로 환산해 주입(중국 CNY·일본 JPY → USD)
  const scrapSection = (title, obj, rate) => {
    if (!obj || Object.keys(obj).length === 0 || !rate) return '';
    let s = `\n[${title}]\n`;
    for (const [k, v] of Object.entries(obj)) s += `${k}: ${usd(Number(v) * rate)}/MT\n`;
    return s;
  };
  context += scrapSection('미국 알루미늄 스크랩', scrapPrices?.us, 1);
  context += scrapSection('유럽 알루미늄 스크랩', scrapPrices?.eu, 1);
  context += scrapSection('중국 알루미늄 스크랩', scrapPrices?.cn, cnyRate);
  if (japanScrap?.prices) context += scrapSection(`일본 알루미늄 스크랩 (${japanScrap.date})`, japanScrap.prices, jpyRate);

  return prompt + context + buildDrossNewsSection(ctx.drossNews);
}

export async function postProcess({ parsed, ctx, searchResults, token }) {
  const { lmeData, scrapPrices, japanScrap, futures, drossNews } = ctx;

  // 1. 스프레드 — 전부 결정적 계산. 드로스 자체가는 절대 만들지 않음(null 고정).
  // 표시는 USD 단일 통화(요청). SHFE는 CNY 정산가를 환율로 환산하고 원본 CNY는 보조표시용으로 보존.
  const primary = toNumber(futures?.al?.settle);
  const secondary = toNumber(futures?.ad?.settle);
  const cnyRate = ctx.cnyUsd?.rate ?? null;
  const cnyToUsdInt = (cny) => (cny && cnyRate) ? Math.round(cny * cnyRate) : null;
  const spreadCny = (primary && secondary) ? primary - secondary : null;
  parsed.spread = {
    lme_usd: toNumber(lmeData?.price),
    primary_shfe: primary,
    primary_usd: cnyToUsdInt(primary),
    secondary_shfe: secondary,
    secondary_usd: cnyToUsdInt(secondary),
    prim_sec_spread: spreadCny,
    prim_sec_spread_usd: cnyToUsdInt(spreadCny),
    prim_sec_spread_pct: (primary && secondary)
      ? `${(((primary - secondary) / secondary) * 100).toFixed(1)}%` : null,
    cny_usd_rate: cnyRate,
    note: 'SHFE 가격은 당일 환율로 USD 환산(괄호 안은 위안 원값). 1차-2차 가격차 = 1차 알루미늄이 2차보다 비싼 폭.',
  };

  // 2. 선물 스트립 — 전해/주조 (거래소 공식)
  parsed.futures = [futures?.al, futures?.ad].filter(Boolean);

  // 2-1. 원료(공급)은 드로스만 — '스크랩' 포함 문장을 결정적으로 제거(LLM 잔여 멘션 차단).
  //      한국어 종결('다.') 경계로 분리 후 스크랩 문장 삭제. 비면 null.
  const dropScrap = (txt) => {
    if (!txt || !String(txt).includes('스크랩')) return txt ?? null;
    const kept = String(txt).split(/(?<=다\.)\s+/).filter(s => !s.includes('스크랩'));
    const out = kept.join(' ').trim();
    return out || null;
  };
  if (parsed.supply) {
    parsed.supply.signal = dropScrap(parsed.supply.signal);
    parsed.supply.drivers = dropScrap(parsed.supply.drivers);
    parsed.supply.outlook = dropScrap(parsed.supply.outlook);
  }

  // 3. 스크랩 — 품목(폐기물)별 × 대륙 비교 매트릭스 (전부 USD 환산, 결정적)
  //    중국(CNY)·일본(JPY)은 당일 환율로 USD 환산, 원통화는 보조표시용으로 보존.
  parsed.scrap = parsed.scrap ?? {};
  parsed.scrap.matrix = buildScrapMatrix({
    scrapPrices, japanScrap,
    cnyRate, jpyRate: ctx.jpyUsd?.rate ?? null,
    lmeUsd: toNumber(lmeData?.price),
  });

  // 4. 뉴스 — 국내/해외 직표시(LLM 미경유) + 규제 워치 출처
  if (drossNews) {
    parsed._dross_news_kr = drossNews.domestic;
    parsed._dross_news_global = drossNews.overseas;
    parsed._dross_regulation = drossNews.regulation;
  }

  // 5. key_issues·regulation_watch 결정적 중복제거 + 출처 부여
  parsed.key_issues = attachSourceMeta(
    dedupKeyIssues(parsed.key_issues ?? [], ctx.newsHistory), searchResults);
  if (Array.isArray(parsed.regulation_watch)) {
    parsed.regulation_watch = attachSourceMeta(parsed.regulation_watch, searchResults);
  }

  // 6. 가격 시계열 (전해/주조 정산가만 — 결정적) + 응답 부착
  if (token && (primary || secondary)) {
    ctx.priceHistory = await savePriceHistory(token, 'dross', ctx.priceHistory, {
      d: futures?.al?.date ?? futures?.ad?.date ?? getKSTDate(),
      primary: primary ?? null,
      secondary: secondary ?? null,
    });
  }
  if (ctx.priceHistory?.length > 0) parsed._price_history = ctx.priceHistory;
}

export function isValid(parsed) {
  return !!(
    parsed.market_summary ||
    parsed.spread?.primary_shfe || parsed.spread?.lme_usd ||
    parsed.scrap?.weekly_summary ||
    (parsed._dross_news_kr?.length || parsed._dross_news_global?.length)
  );
}

export function newsItems(parsed, todayKST) {
  return issuesToHistory(parsed.key_issues, todayKST, 'dross');
}
