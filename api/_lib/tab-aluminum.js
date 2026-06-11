// api/_lib/tab-aluminum.js — 알루미늄 탭 모듈
// LME(westmetall)·스크랩(scrapmonster/dokindokin) 직접 수집값이 주 가격 — LLM은 해석만.

import { toNumber, validatePrice, dedupKeyIssues, attachSourceMeta } from './validate.js';
import { fetchLmePrice, fetchAluminumOutlook } from './lme-data.js';
import { fetchScrapPrices, fetchJapanScrapPrices } from './scrap-data.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory, issuesToHistory, readPriceHistory, savePriceHistory } from './cache-store.js';
import { getAluminumPrompt } from '../_prompts/aluminum.js';

export const recency = 'week';
export const maxTokens = 3000;

export async function prefetch(token) {
  const [lmeData, outlookText, scrapPrices, japanScrap, prev, newsHistory, krNews, priceHistory] = await Promise.all([
    fetchLmePrice(),
    fetchAluminumOutlook(),
    fetchScrapPrices(),
    fetchJapanScrapPrices(),
    fetchPrevDayData(token, 'aluminum'),
    readNewsHistory(token, 'aluminum'),
    fetchKoreanSteelNews('aluminum', 6).catch(() => []),
    readPriceHistory(token, 'aluminum'),
  ]);
  return { lmeData, outlookText, scrapPrices, japanScrap, prev, newsHistory, krNews, priceHistory };
}

export function buildPrompt(ctx) {
  let prompt = getAluminumPrompt(getKSTDate());

  if (ctx.prev) {
    const p = ctx.prev.data;
    prompt += `\n\n【전일 데이터 (${ctx.prev.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】\n`;
    prompt += `전일 LME: ${p.lme?.price ?? 'N/A'} USD/MT (변동: ${p.lme?.change ?? 'N/A'} USD)\n`;
    prompt += `전일 move_reason 요약: ${p.lme?.move_reason?.slice(0, 80) ?? 'N/A'}\n`;
    prompt += `전일 스크랩 요약: ${p.scrap?.weekly_summary?.slice(0, 100) ?? 'N/A'}\n`;
    prompt += `→ 오늘 위 수치 대비 달라진 것 구체적 서술. 달라진 것 없으면 "전일 대비 보합" 명시.\n`;
  }

  // LME·스크랩 실시간 수집 데이터 주입
  let context = '\n\n【LME 실시간 수집 데이터 — move_reason/market_status 작성 시 반드시 아래 LME 공식 가격만 사용】\n';
  const { lmeData, outlookText, scrapPrices, japanScrap } = ctx;
  if (lmeData) {
    const fmt = (v) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const priceFormatted = fmt(lmeData.price);
    const changeFormatted = lmeData.change !== null ? `${parseFloat(lmeData.change) >= 0 ? '+' : ''}${fmt(lmeData.change)}` : null;
    context += `\n[LME Cash Settlement — westmetall.com 파싱값]\n`;
    context += `현재가: ${priceFormatted} USD/MT\n`;
    if (changeFormatted !== null) context += `전일 대비: ${changeFormatted} USD/MT\n`;
    if (lmeData.change_pct) context += `등락률: ${lmeData.change_pct}\n`;
    context += `기준일: ${lmeData.date}\n`;
    context += `[주의] move_reason 작성 시 반드시 위 ${priceFormatted} USD/MT 숫자 사용. 다른 수치 금지.\n`;
  }
  if (outlookText) context += `\n[가격 전망 참고]\n${outlookText}\n`;
  const scrapSection = (title, obj, fmt) => {
    if (!obj || Object.keys(obj).length === 0) return '';
    let s = `\n[${title}]\n`;
    for (const [k, v] of Object.entries(obj)) s += `${k}: ${fmt(v)}\n`;
    return s;
  };
  context += scrapSection('미국 알루미늄 스크랩 (USD/톤, scrapmonster.com)', scrapPrices?.us, v => `$${v.toLocaleString('en-US')}/톤`);
  context += scrapSection('유럽 알루미늄 스크랩 (USD/톤)', scrapPrices?.eu, v => `$${v.toLocaleString('en-US')}/톤`);
  context += scrapSection('중국 알루미늄 스크랩 (CNY/톤)', scrapPrices?.cn, v => `${v.toLocaleString('en-US')} CNY/톤`);
  if (japanScrap?.prices) {
    context += scrapSection(`Japan Aluminum Scrap (JPY/톤, ${japanScrap.date})`, japanScrap.prices, v => `${v.toLocaleString('en-US')}円/톤`);
  }
  return prompt + context;
}

export async function postProcess({ parsed, ctx, searchResults, token }) {
  const { lmeData, scrapPrices, japanScrap } = ctx;

  // 1. LME 가격 주입 — 직접 수집값 우선, 실패 시 Perplexity 값 검증 → 전일값 이월
  if (lmeData) {
    console.log(`[LME] 가격 주입 (${lmeData.source}): ${lmeData.price} USD/톤 (${lmeData.date})`);
    parsed.lme = {
      ...parsed.lme,
      price:        lmeData.price,
      change:       lmeData.change,
      change_pct:   lmeData.change_pct,
      date:         lmeData.date,
      holiday_note: lmeData.holiday_note ?? null,
      source:       lmeData.source,
      carried_over: false,
    };
  } else {
    console.warn('[LME] 직접 fetch 전부 실패 — Perplexity 가격 검증 시도');
    const prevLme = ctx.prev?.data?.lme ?? null;
    const v = validatePrice(parsed.lme?.price, 'lme_al', prevLme?.price);
    if (v.reason) console.warn('[Validate] lme:', v.reason);
    if (v.value !== null) {
      parsed.lme = { ...parsed.lme, price: v.value, source: 'perplexity', carried_over: false };
    } else if (toNumber(prevLme?.price) !== null) {
      console.warn('[Validate] lme: 전일값 이월');
      parsed.lme = {
        ...parsed.lme,
        price:        toNumber(prevLme.price),
        change:       null,
        change_pct:   null,
        date:         prevLme.date ?? ctx.prev?.date ?? null,
        source:       'carried',
        carried_over: true,
      };
    } else {
      parsed.lme = { ...parsed.lme, price: null, source: 'perplexity' };
    }
  }

  // 2. 스크랩 가격 직접 수집값 주입 (한 줄에 한 품목 — LLM 문자열 의존 제거)
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

  // 3. key_issues 결정적 중복 제거 + 출처 부여
  if (parsed.lme) {
    parsed.lme.key_issues = attachSourceMeta(
      dedupKeyIssues(parsed.lme.key_issues ?? [], ctx.newsHistory),
      searchResults
    );
  }

  // 4. 가격 시계열 적립 (westmetall 직접 수집값만 — LLM 무관) + 응답 부착
  if (token && lmeData?.price && toNumber(lmeData.price)) {
    ctx.priceHistory = await savePriceHistory(token, 'aluminum', ctx.priceHistory, {
      d: lmeData.date ?? getKSTDate(),
      lme: toNumber(lmeData.price),
    });
  }
  if (ctx.priceHistory?.length > 0) {
    parsed._price_history = ctx.priceHistory;
  }
}

export function isValid(parsed) {
  return !!(parsed.lme?.price || parsed.lme?.market_status);
}

export function newsItems(parsed, todayKST) {
  return issuesToHistory(parsed.lme?.key_issues, todayKST, 'lme');
}
