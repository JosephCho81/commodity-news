// api/_lib/tab-aluminum.js — 1차 알루미늄(LME 신지금) 탭 모듈
// LME(westmetall) 직접 수집값이 주 가격 — LLM은 해석만.
// 스크랩·드로스·2차합금은 tab-dross.js(2차 알루미늄)로 분리됨.

import { toNumber, validatePrice, dedupKeyIssues, attachSourceMeta } from './validate.js';
import { fetchLmePrice, fetchAluminumOutlook } from './lme-data.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory, issuesToHistory, readPriceHistory, savePriceHistory } from './cache-store.js';
import { getAluminumPrompt } from '../_prompts/aluminum.js';

export const recency = 'week';
export const maxTokens = 3000;

export async function prefetch(token) {
  const [lmeData, outlookText, prev, newsHistory, krNews, priceHistory] = await Promise.all([
    fetchLmePrice(),
    fetchAluminumOutlook(),
    fetchPrevDayData(token, 'aluminum'),
    readNewsHistory(token, 'aluminum'),
    fetchKoreanSteelNews('aluminum', 6).catch(() => []),
    readPriceHistory(token, 'aluminum'),
  ]);
  return { lmeData, outlookText, prev, newsHistory, krNews, priceHistory };
}

export function buildPrompt(ctx) {
  let prompt = getAluminumPrompt(getKSTDate());

  if (ctx.prev) {
    const p = ctx.prev.data;
    prompt += `\n\n【전일 데이터 (${ctx.prev.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】\n`;
    prompt += `전일 LME: ${p.lme?.price ?? 'N/A'} USD/MT (변동: ${p.lme?.change ?? 'N/A'} USD)\n`;
    prompt += `전일 move_reason 요약: ${p.lme?.move_reason?.slice(0, 80) ?? 'N/A'}\n`;
    prompt += `→ 오늘 위 수치 대비 달라진 것 구체적 서술. 달라진 것 없으면 "전일 대비 보합" 명시.\n`;
  }

  // LME 실시간 수집 데이터 주입
  let context = '\n\n【LME 실시간 수집 데이터 — move_reason/market_status 작성 시 반드시 아래 LME 공식 가격만 사용】\n';
  const { lmeData, outlookText } = ctx;
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
  return prompt + context;
}

export async function postProcess({ parsed, ctx, searchResults, token }) {
  const { lmeData } = ctx;

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

  // 2. key_issues 결정적 중복 제거 + 출처 부여
  if (parsed.lme) {
    parsed.lme.key_issues = attachSourceMeta(
      dedupKeyIssues(parsed.lme.key_issues ?? [], ctx.newsHistory),
      searchResults
    );
  }

  // 3. 가격 시계열 적립 (westmetall 직접 수집값만 — LLM 무관) + 응답 부착
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
