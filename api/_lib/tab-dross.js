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
import { drossRecoveryValues } from './market-config.js';
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

function buildScrapMatrix({ scrapPrices, japanScrap, cnyRate, jpyRate }) {
  const staleMap = scrapPrices?.stale ?? {};
  const sources = [
    { region: '미국', data: scrapPrices?.us, cur: 'USD', rate: 1, stale: !!staleMap.us },
    { region: '유럽', data: scrapPrices?.eu, cur: 'USD', rate: 1, stale: !!staleMap.eu },
    { region: '중국', data: scrapPrices?.cn, cur: 'CNY', rate: cnyRate, stale: !!staleMap.cn },
    { region: '일본', data: japanScrap?.prices, cur: 'JPY', rate: jpyRate, stale: false },
  ];
  const rowMap = new Map();   // rowId -> { grade, cells }
  const regionsWithData = [];
  const staleRegions = [];
  for (const src of sources) {
    if (!src.data || typeof src.data !== 'object') continue;
    let any = false;
    for (const [rawLabel, rawVal] of Object.entries(src.data)) {
      const rowId = scrapRowId(rawLabel);
      if (!rowId) continue;
      const raw = Number(String(rawVal).replace(/,/g, ''));
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const usd = src.cur === 'USD'
        ? Math.round(raw)
        : (src.rate ? Math.round(raw * src.rate) : null);
      if (!rowMap.has(rowId)) {
        const def = SCRAP_ROW_DEFS.find(([id]) => id === rowId);
        rowMap.set(rowId, { grade: def ? def[1] : rowId, cells: {} });
      }
      const row = rowMap.get(rowId);
      if (!row.cells[src.region]) {   // 같은 행에 여러 라벨이 매핑되면 먼저 본 값 유지
        row.cells[src.region] = { usd, raw: Math.round(raw), cur: src.cur };
        any = true;
      }
    }
    if (any) {
      regionsWithData.push(src.region);
      if (src.stale) staleRegions.push(src.region);  // 실시간 교체 실패로 여전히 동결인 지역
    }
  }
  const rows = SCRAP_ROW_DEFS.map(([id]) => rowMap.get(id)).filter(Boolean);
  if (rows.length === 0) return null;
  return { regions: regionsWithData, rows, staleRegions };
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

  // 결정적 수집값 주입 — 선물(1차 vs 2차)·LME·스크랩
  const { lmeData, futures, scrapPrices, japanScrap } = ctx;
  let context = '\n\n【결정적 수집 데이터 — 아래 수치만 사용, 다른 숫자 금지】\n';
  if (lmeData?.price) context += `LME 1차 알루미늄 Cash: ${lmeData.price} USD/MT (${lmeData.date ?? ''})\n`;
  if (futures?.al?.settle) context += `SHFE 1차 알루미늄 정산: ${futures.al.settle} CNY/MT (${futures.al.change_pct ?? ''})\n`;
  if (futures?.ad?.settle) context += `SHFE 2차 알루미늄 정산: ${futures.ad.settle} CNY/MT (${futures.ad.change_pct ?? ''})\n`;
  if (futures?.al?.settle && futures?.ad?.settle) {
    context += `→ 1차-2차 가격차: ${futures.al.settle - futures.ad.settle} CNY/MT (축소=좁아짐 → 2차 알루미늄 강세=원료비 상승 압력 / 확대=2차 저평가)\n`;
  }
  const scrapSection = (title, obj, unit) => {
    if (!obj || Object.keys(obj).length === 0) return '';
    let s = `\n[${title}]\n`;
    for (const [k, v] of Object.entries(obj)) s += `${k}: ${Number(v).toLocaleString('en-US')} ${unit}\n`;
    return s;
  };
  context += scrapSection('미국 알루미늄 스크랩 (USD/MT)', scrapPrices?.us, 'USD/MT');
  context += scrapSection('유럽 알루미늄 스크랩 (USD/MT)', scrapPrices?.eu, 'USD/MT');
  context += scrapSection('중국 알루미늄 스크랩 (CNY/MT)', scrapPrices?.cn, 'CNY/MT');
  if (japanScrap?.prices) context += scrapSection(`일본 알루미늄 스크랩 (JPY/MT, ${japanScrap.date})`, japanScrap.prices, 'JPY/MT');

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
    recovery_values: drossRecoveryValues(lmeData?.price), // LME×함량%, '가정'
    note: 'SHFE 가격은 CNY를 당일 환율로 USD 환산(괄호 안 CNY 원값). 1차-2차 가격차=1차 알루미늄이 2차보다 비싼 폭(좁아질수록 2차 강세=원료비 상승). 함량별 금속가치는 가정값. 드로스 거래가는 공시가 부재로 미표시.',
  };

  // 2. 선물 스트립 — 전해/주조 (거래소 공식)
  parsed.futures = [futures?.al, futures?.ad].filter(Boolean);

  // 3. 스크랩 — 품목(폐기물)별 × 대륙 비교 매트릭스 (전부 USD 환산, 결정적)
  //    중국(CNY)·일본(JPY)은 당일 환율로 USD 환산, 원통화는 보조표시용으로 보존.
  parsed.scrap = parsed.scrap ?? {};
  parsed.scrap.matrix = buildScrapMatrix({
    scrapPrices, japanScrap,
    cnyRate, jpyRate: ctx.jpyUsd?.rate ?? null,
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
