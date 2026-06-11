// api/_lib/ferro-fetch.js — 합금철 탭 사전 데이터 수집 + 3품목 Perplexity 호출
// (환율·전일 데이터·뉴스 히스토리·ZCE 선물·국내 RSS·가격 시계열 + 백필)

import { saveToFirestore, getFromFirestore } from './firebase.js';
import { callPerplexity, parseJSON } from './perplexity.js';
import { fetchCNYUSDRate, fetchUSDKRWRate } from './exchange-rate.js';
import { fetchZceFutures, backfillZceHistory } from './zce-futures.js';
import { fetchKoreanSteelNews, buildKrNewsSection } from './rss-news.js';
import { fetchPrevDayData, readNewsHistory, buildExclusionSection, readPriceHistory } from './cache-store.js';
import { getFesiPrompt } from '../_prompts/fesi.js';
import { getFemnPrompt } from '../_prompts/femn.js';
import { getSimnPrompt } from '../_prompts/simn.js';

export async function prefetchFerroalloy(token) {
  let exchangeInfo = null, krwInfo = null;
  let prevFerroalloy = null;
  let newsHistory = [];
  let zce = {};
  let krNews = [];
  let priceHistory = [];
  try {
    [exchangeInfo, krwInfo, prevFerroalloy, newsHistory, zce, krNews, priceHistory] = await Promise.all([
      fetchCNYUSDRate(token, { saveToFirestore, getFromFirestore }),
      fetchUSDKRWRate(token, { saveToFirestore, getFromFirestore }),
      fetchPrevDayData(token, 'ferroalloy'),
      readNewsHistory(token, 'ferroalloy'),
      fetchZceFutures(['sf', 'sm']).catch(() => ({})),
      fetchKoreanSteelNews('ferroalloy', 8).catch(() => []),
      readPriceHistory(token, 'ferroalloy'),
    ]);
  } catch (e) {
    console.warn('[Ferroalloy] 사전 데이터 fetch 실패:', e.message);
  }

  // 시계열 콜드스타트 — 데이터가 부족하면 czce 공식 과거 파일로 백필
  if (priceHistory.length < 5) {
    try {
      const backfill = await backfillZceHistory(14);
      const known = new Set(priceHistory.map(h => h.d));
      priceHistory = [...priceHistory, ...backfill.filter(b => !known.has(b.d))]
        .sort((a, b) => a.d.localeCompare(b.d));
    } catch (e) {
      console.warn('[Ferroalloy] 시계열 백필 실패:', e.message);
    }
  }

  return {
    exchangeInfo, krwInfo, prevFerroalloy, newsHistory, zce, krNews, priceHistory,
    exchangeRate: exchangeInfo?.rate ?? null,
    krwRate: krwInfo?.rate ?? null,
    prevData: prevFerroalloy?.data ?? null,
  };
}

// 3품목 병렬 Perplexity 호출 (월 단위 시세 — recency: month)
export async function callFerroProducts(todayKST, ctx) {
  const krNewsSection = buildKrNewsSection(ctx.krNews,
    '아래는 국내 전문지 보도 — 한국 국내 공급(korea_supply)·시황 서술에 사실 근거로 활용. 제목에 없는 내용 지어내기 금지.\n');

  console.log('[Perplexity] 합금철 3품목 병렬 호출 시작');
  const pplxOpts = { recency: 'month', withMeta: true };
  const { prevData, newsHistory } = ctx;
  return Promise.allSettled([
    callPerplexity(getFesiPrompt(todayKST, prevData?.fesi) + buildExclusionSection(newsHistory, 'fesi') + krNewsSection, { maxTokens: 2500, ...pplxOpts }),
    callPerplexity(getFemnPrompt(todayKST, prevData?.femn) + buildExclusionSection(newsHistory, 'femn') + krNewsSection, { maxTokens: 2000, ...pplxOpts }),
    callPerplexity(getSimnPrompt(todayKST, prevData?.simn) + buildExclusionSection(newsHistory, 'simn') + krNewsSection, { maxTokens: 2000, ...pplxOpts }),
  ]);
}

// 개별 파싱 + 전일 캐시 fallback (이월 데이터임을 명시 — 오늘 데이터처럼 보이지 않게)
export function parseProduct(settled, fallback, name) {
  if (settled.status === 'fulfilled') {
    try { return parseJSON(settled.value.content); }
    catch (e) { console.warn(`[${name}] JSON 파싱 실패 — fallback 사용`); }
  } else {
    console.warn(`[${name}] 호출 실패 — fallback 사용:`, settled.reason?.message);
  }
  if (fallback) return { ...fallback, carried_over: true };
  return null;
}
