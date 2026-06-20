// api/_lib/tab-dross.js — 2차 알루미늄(스크랩·드로스·탈산제) 탭 모듈
// 스프레드(LME×함량·전해 vs 주조 선물)·스크랩은 결정적 수집값, LLM은 해석만.
// 드로스 자체 거래가는 공시가 없어 절대 숫자로 만들지 않는다(NULL 원칙).

import { toNumber, dedupKeyIssues, attachSourceMeta } from './validate.js';
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

export async function prefetch(token) {
  const [lmeData, scrapPrices, japanScrap, futures, drossNews, prev, newsHistory, krNews, priceHistory] = await Promise.all([
    fetchLmePrice().catch(() => null),
    fetchScrapPrices().catch(() => null),
    fetchJapanScrapPrices().catch(() => null),
    fetchZceFutures(['al', 'ad']).catch(() => ({})),
    fetchDrossNews().catch(() => null),
    fetchPrevDayData(token, 'dross'),
    readNewsHistory(token, 'dross'),
    fetchKoreanSteelNews('aluminum', 6).catch(() => []),
    readPriceHistory(token, 'dross'),
  ]);
  return { lmeData, scrapPrices, japanScrap, futures, drossNews, prev, newsHistory, krNews, priceHistory };
}

export function buildPrompt(ctx) {
  let prompt = getDrossPrompt(getKSTDate());

  if (ctx.prev) {
    const p = ctx.prev.data;
    prompt += `\n\n【전일 데이터 (${ctx.prev.date}) — 오늘과 비교해 달라진 것 서술】\n`;
    prompt += `전일 판단: 원료 ${p.headline_judgment?.feedstock ?? 'N/A'} · 수요 ${p.headline_judgment?.demand ?? 'N/A'} · 스프레드 ${p.headline_judgment?.spread ?? 'N/A'}\n`;
    prompt += `전일 종합: ${p.market_summary?.slice(0, 120) ?? 'N/A'}\n`;
    prompt += `→ 달라진 것 없으면 "전일 수준 유지" 명시.\n`;
  }

  // 결정적 수집값 주입 — 선물(전해 vs 주조)·LME·스크랩
  const { lmeData, futures, scrapPrices, japanScrap } = ctx;
  let context = '\n\n【결정적 수집 데이터 — 아래 수치만 사용, 다른 숫자 금지】\n';
  if (lmeData?.price) context += `LME 알루미늄(전해 신지금) Cash: ${lmeData.price} USD/MT (${lmeData.date ?? ''})\n`;
  if (futures?.al?.settle) context += `SHFE 전해알루미늄(1차) 정산: ${futures.al.settle} CNY/MT (${futures.al.change_pct ?? ''})\n`;
  if (futures?.ad?.settle) context += `SHFE 주조알루미늄합금(2차) 정산: ${futures.ad.settle} CNY/MT (${futures.ad.change_pct ?? ''})\n`;
  if (futures?.al?.settle && futures?.ad?.settle) {
    context += `→ 전해-주조 스프레드: ${futures.al.settle - futures.ad.settle} CNY/MT (좁을수록 2차/스크랩 채산성 양호)\n`;
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
  const primary = toNumber(futures?.al?.settle);
  const secondary = toNumber(futures?.ad?.settle);
  parsed.spread = {
    lme_usd: toNumber(lmeData?.price),
    primary_shfe: primary,
    secondary_shfe: secondary,
    prim_sec_spread: (primary && secondary) ? primary - secondary : null,
    prim_sec_spread_pct: (primary && secondary)
      ? `${(((primary - secondary) / secondary) * 100).toFixed(1)}%` : null,
    recovery_values: drossRecoveryValues(lmeData?.price), // LME×함량%, '가정'
    note: 'LME×함량% = 함량별 내재 금속가치(가정). 드로스 거래가는 공시가 부재로 미표시.',
  };

  // 2. 선물 스트립 — 전해/주조 (거래소 공식)
  parsed.futures = [futures?.al, futures?.ad].filter(Boolean);

  // 3. 스크랩 직접 수집값 주입 (한 줄에 한 품목)
  if (Array.isArray(parsed.scrap?.regions)) {
    const fmtNum = (v) => Number(v).toLocaleString('en-US');
    const directItems = {
      '미국': scrapPrices?.us ? Object.entries(scrapPrices.us).map(([grade, v]) => ({ grade, price: `$${fmtNum(v)}/MT` })) : null,
      '유럽': scrapPrices?.eu ? Object.entries(scrapPrices.eu).map(([grade, v]) => ({ grade, price: `$${fmtNum(v)}/MT` })) : null,
      '중국': scrapPrices?.cn ? Object.entries(scrapPrices.cn).map(([grade, v]) => ({ grade, price: `CNY ${fmtNum(v)}/MT` })) : null,
      '일본': japanScrap?.prices ? Object.entries(japanScrap.prices).map(([grade, v]) => ({ grade, price: `JPY ${fmtNum(v)}/MT` })) : null,
    };
    for (const r of parsed.scrap.regions) {
      const items = directItems[r.region];
      if (items?.length) r.price_items = items;
    }
  }

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
