// api/_lib/tab-recarburizer.js — 가탄제 탭 모듈

import { toNumber, validatePrice, dedupKeyIssues, attachSourceMeta } from './validate.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory, issuesToHistory } from './cache-store.js';
import { getRecarburizerPrompt } from '../_prompts/recarburizer.js';

export const recency = 'month'; // 월 단위 시세 (FOB 공시 등)
export const maxTokens = 3000;

export async function prefetch(token) {
  const [prev, newsHistory, chainFutures, krNews] = await Promise.all([
    fetchPrevDayData(token, 'recarburizer'),
    readNewsHistory(token, 'recarburizer'),
    fetchZceFutures(['jm', 'j']).catch(() => ({})), // 원료탄·코크스 = 원가 신호
    fetchKoreanSteelNews('recarburizer', 6).catch(() => []),
  ]);
  return { prev, newsHistory, chainFutures, krNews };
}

export function buildPrompt(ctx) {
  let prompt = getRecarburizerPrompt(getKSTDate());

  if (ctx.prev) {
    const p = ctx.prev.data;
    prompt += `\n\n【전일 데이터 (${ctx.prev.date}) — 반드시 아래 수치와 오늘을 비교】\n`;
    prompt += `전일 중국 FOB: ${p.china_price?.fob_qinhuangdao ?? p.china_price?.price_range_text ?? 'N/A'} USD/MT\n`;
    prompt += `전일 러시아 FOB: ${p.russia_price?.fob_murmansk ?? p.russia_price?.price_range_text ?? 'N/A'} USD/MT\n`;
    prompt += `전일 시장 요약: ${p.market_summary?.slice(0, 100) ?? 'N/A'}\n`;
    prompt += `→ 오늘 위 수치 대비 달라진 것 구체적 서술. 달라진 것 없으면 "전월 수준 유지" 명시.\n`;
  }

  return prompt;
}

export async function postProcess({ parsed, ctx, searchResults }) {
  const prevRec = ctx.prev?.data ?? null;

  // 월 시세 특성상 변동률 한계 15%로 완화 — 검증 실패/null은 전일값 이월
  const applyPrice = (obj, field, boundKey, prevObj) => {
    if (!obj) return;
    const v = validatePrice(obj[field], boundKey, prevObj?.[field], 15);
    if (v.reason) console.warn(`[Validate] ${boundKey}: ${v.reason}`);
    if (v.value !== null) {
      obj[field] = v.value;
      obj.carried_over = false;
      return;
    }
    const prevVal = toNumber(prevObj?.[field]);
    if (prevVal !== null) {
      console.warn(`[Validate] ${boundKey}: 전일값 이월 (${prevVal})`);
      obj[field] = prevVal;
      obj.as_of = prevObj?.as_of ?? prevObj?.date ?? ctx.prev?.date ?? null;
      obj.source = prevObj?.source ?? null;
      obj.carried_over = true;
    } else {
      obj[field] = null; // 콜드스타트 — price_range_text로 degrade
    }
  };
  applyPrice(parsed.china_price,  'fob_qinhuangdao', 'anthracite_china_fob',  prevRec?.china_price);
  applyPrice(parsed.russia_price, 'fob_murmansk',    'anthracite_russia_fob', prevRec?.russia_price);
  if (parsed.china_price)  parsed.china_price.cif_korea  = validatePrice(parsed.china_price.cif_korea,  'anthracite_cif_korea').value;
  if (parsed.russia_price) parsed.russia_price.cif_korea = validatePrice(parsed.russia_price.cif_korea, 'anthracite_cif_korea').value;

  parsed.key_issues = attachSourceMeta(
    dedupKeyIssues(parsed.key_issues ?? [], ctx.newsHistory),
    searchResults
  );
}

export function isValid(parsed) {
  return !!(
    parsed.china_price?.price_range_text || parsed.china_price?.fob_qinhuangdao ||
    parsed.global_market?.headline || parsed.market_summary
  );
}

export function newsItems(parsed, todayKST) {
  return issuesToHistory(parsed.key_issues, todayKST);
}
