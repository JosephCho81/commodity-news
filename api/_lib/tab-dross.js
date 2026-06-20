// api/_lib/tab-dross.js — 2차 알루미늄(스크랩·드로스·탈산제) 탭 모듈
// 스프레드(LME×함량·전해 vs 주조 선물)·스크랩은 결정적 수집값, LLM은 해석만.
// 드로스 자체 거래가는 공시가 없어 절대 숫자로 만들지 않는다(NULL 원칙).

import { toNumber, dedupKeyIssues, attachSourceMeta } from './validate.js';
import { saveToFirestore, getFromFirestore } from './firebase.js';
import { fetchCNYUSDRate, fetchJPYUSDRate } from './exchange-rate.js';
import { fetchLmePrice } from './lme-data.js';
import { fetchUsAluminumPrice, fetchJapanScrapPrices } from './scrap-data.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchDrossNews, buildDrossNewsSection } from './dross-news.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory, issuesToHistory, readPriceHistory, savePriceHistory } from './cache-store.js';
import { getDrossPrompt } from '../_prompts/dross.js';

export const recency = 'month';
export const maxTokens = 3800;

// ─── 지역별 라이브 스크랩/알루미늄 시세 ──────────────────────────────────────
// 무료 라이브 도매 소스만 사용(전부 당일/수일 내): 미국=recycleinme 거래가,
// 중국=SHFE 1차/2차 선물, 일본=dokindokin 딜러가. 유럽은 무료 라이브 도매 부재로 제외.
// 원통화는 보조표시용으로 보존하고 표시는 USD로 통일.
function buildScrapLive({ usAl, futures, japanScrap, cnyRate, jpyRate }) {
  const regions = [];

  if (usAl?.usd_per_mt > 0) {
    regions.push({
      region: '미국', source: 'recycleinme', date: usAl.date ?? null,
      note: '거래가(LME+미국 프리미엄 기준)',
      items: [{ label: '알루미늄 거래가', usd: usAl.usd_per_mt }],
    });
  }

  const cnItems = [];
  if (futures?.al?.settle && cnyRate) cnItems.push({ label: '1차 알루미늄', usd: Math.round(futures.al.settle * cnyRate), cny: futures.al.settle });
  if (futures?.ad?.settle && cnyRate) cnItems.push({ label: '2차 알루미늄(재생합금)', usd: Math.round(futures.ad.settle * cnyRate), cny: futures.ad.settle });
  if (cnItems.length) {
    regions.push({
      region: '중국', source: 'SHFE', date: futures?.al?.date ?? futures?.ad?.date ?? null,
      note: '상하이 선물 정산가', items: cnItems,
    });
  }

  if (japanScrap?.prices && jpyRate) {
    const jpItems = Object.entries(japanScrap.prices)
      .map(([label, jpy]) => ({ label, usd: Math.round(Number(jpy) * jpyRate), jpy: Number(jpy) }))
      .filter(it => it.usd > 0);
    if (jpItems.length) {
      regions.push({
        region: '일본', source: 'dokindokin', date: japanScrap.date ?? null,
        note: '오사카 딜러 스크랩가', items: jpItems,
      });
    }
  }

  return regions.length ? { regions } : null;
}

export async function prefetch(token) {
  const [lmeData, usAl, japanScrap, futures, drossNews, prev, newsHistory, krNews, priceHistory, cnyUsd, jpyUsd] = await Promise.all([
    fetchLmePrice().catch(() => null),
    fetchUsAluminumPrice().catch(() => null),
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
  return { lmeData, usAl, japanScrap, futures, drossNews, prev, newsHistory, krNews, priceHistory, cnyUsd, jpyUsd };
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
  const { lmeData, futures, usAl, japanScrap } = ctx;
  const cnyRate = ctx.cnyUsd?.rate ?? null;
  const jpyRate = ctx.jpyUsd?.rate ?? null;
  const usd = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
  let context = '\n\n【결정적 수집 데이터 — 아래 USD 수치만 사용, 다른 숫자·통화 금지】\n';
  if (lmeData?.price) context += `LME 1차 알루미늄 Cash: ${usd(lmeData.price)}/MT (${lmeData.date ?? ''})\n`;
  const alUsd = (futures?.al?.settle && cnyRate) ? futures.al.settle * cnyRate : null;
  const adUsd = (futures?.ad?.settle && cnyRate) ? futures.ad.settle * cnyRate : null;
  if (alUsd) context += `SHFE(중국) 1차 알루미늄: ${usd(alUsd)}/MT (${futures.al.change_pct ?? ''})\n`;
  if (adUsd) context += `SHFE(중국) 2차 알루미늄: ${usd(adUsd)}/MT (${futures.ad.change_pct ?? ''})\n`;
  if (alUsd && adUsd) {
    context += `→ 1차-2차 가격차: ${usd(alUsd - adUsd)}/MT (축소=2차가 1차에 근접=재생 원료 강세 / 확대=2차 저평가)\n`;
  }
  // 라이브 지역 시세(전부 USD 환산). 미국=recycleinme 거래가, 일본=dokindokin 딜러가. 유럽은 무료 라이브 부재로 제외.
  if (usAl?.usd_per_mt) context += `미국 알루미늄 거래가: ${usd(usAl.usd_per_mt)}/MT (${usAl.date ?? ''})\n`;
  if (japanScrap?.prices && jpyRate) {
    context += `\n[일본 스크랩 (dokindokin, ${japanScrap.date})]\n`;
    for (const [k, v] of Object.entries(japanScrap.prices)) context += `${k}: ${usd(Number(v) * jpyRate)}/MT\n`;
  }

  return prompt + context + buildDrossNewsSection(ctx.drossNews);
}

export async function postProcess({ parsed, ctx, searchResults, token }) {
  const { lmeData, usAl, japanScrap, futures, drossNews } = ctx;

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

  // 3. 스크랩 — 지역별 라이브 시세(미국 recycleinme·중국 SHFE·일본 dokindokin, 전부 USD 환산).
  //    유럽은 무료 라이브 도매 소스 부재로 제외.
  parsed.scrap = parsed.scrap ?? {};
  parsed.scrap.live = buildScrapLive({
    usAl, futures, japanScrap,
    cnyRate, jpyRate: ctx.jpyUsd?.rate ?? null,
  });
  delete parsed.scrap.matrix; // 구 매트릭스 제거(구 캐시 호환)

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
