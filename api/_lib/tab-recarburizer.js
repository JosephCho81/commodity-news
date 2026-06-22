// api/_lib/tab-recarburizer.js — 가탄제 탭 모듈

import { toNumber, validatePrice, dedupKeyIssues, attachSourceMeta } from './validate.js';
import { saveToFirestore, getFromFirestore } from './firebase.js';
import { fetchUSDKRWRate, fetchUSDKRWRateOn, computeFxCostBreakdown } from './exchange-rate.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory, issuesToHistory } from './cache-store.js';
import { getRecarburizerPrompt } from '../_prompts/recarburizer.js';

export const recency = 'month'; // 월 단위 시세 (FOB 공시 등)
export const maxTokens = 3000;

// 오늘(KST) 기준 N일 전 날짜 (YYYY-MM-DD)
function daysAgoKST(n) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 - n * 86400000).toISOString().slice(0, 10);
}

export async function prefetch(token) {
  const helpers = { saveToFirestore, getFromFirestore };
  const [prev, newsHistory, chainFutures, krNews, usdKrw, usdKrwPrev] = await Promise.all([
    fetchPrevDayData(token, 'recarburizer'),
    readNewsHistory(token, 'recarburizer'),
    fetchZceFutures(['jm', 'j']).catch(() => ({})), // 원료탄·코크스 = 원가 신호
    fetchKoreanSteelNews('recarburizer', 6).catch(() => []),
    fetchUSDKRWRate(token, helpers).catch(() => null),       // 현재 환율
    fetchUSDKRWRateOn(daysAgoKST(30), token, helpers).catch(() => null), // 전월(30일 전) 기준점
  ]);
  return { prev, newsHistory, chainFutures, krNews, usdKrw, usdKrwPrev };
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

  // 환율 결정값 주입 — LLM은 이 수치를 해석만(새 숫자 필드 생성 금지). 원화 원가 서술용.
  const rNow = ctx.usdKrw?.rate ?? null;
  const rPrev = ctx.usdKrwPrev?.rate ?? null;
  if (rNow) {
    prompt += `\n【원/달러 환율 — 결정적 수치, 원화 원가 서술에 반드시 반영】\n`;
    prompt += `현재 USD/KRW: ${Math.round(rNow)}원 (${ctx.usdKrw?.date ?? ''} 기준)\n`;
    if (rPrev) {
      const d = Math.round(rNow - rPrev);
      prompt += `전월(30일 전) USD/KRW: ${Math.round(rPrev)}원 → 전월 대비 ${d >= 0 ? '+' : ''}${d}원\n`;
    }
    prompt += `→ 무연탄은 USD로 수입되므로 원화 원가는 'USD 시세 × 환율'. `;
    prompt += `market_summary와 global_market.outlook에서 USD 시세 변동과 환율 변동을 분리해 서술. `;
    prompt += `USD 시세가 보합이라도 환율 상승 시 원화 원가가 상승함을 명시.\n`;
  }

  return prompt;
}

// price_range_text "100~180 USD/MT" → [100, 180]. 파싱 실패 시 null.
function parseUsdRange(text) {
  if (!text) return null;
  const m = String(text).match(/(\d[\d,]*\.?\d*)\s*[~\-–]\s*(\d[\d,]*\.?\d*)/);
  if (!m) return null;
  const lo = parseFloat(m[1].replace(/,/g, '')), hi = parseFloat(m[2].replace(/,/g, ''));
  if (!(lo > 0) || !(hi > 0)) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

// 가격 객체에서 KRW 환산 대상 USD 단일값/범위 추출(원가 근접 순: CIF 한국 > FOB).
// 반환: { usd:number|null, range:[lo,hi]|null, basis:string }
function pickUsdBasis(p, fobField) {
  if (!p) return { usd: null, range: null, basis: null };
  const cif = toNumber(p.cif_korea);
  if (cif) return { usd: cif, range: null, basis: 'CIF 한국' };
  const fob = toNumber(p[fobField]);
  if (fob) return { usd: fob, range: null, basis: 'FOB' };
  const range = parseUsdRange(p.price_range_text);
  if (range) return { usd: null, range, basis: 'FOB 범위' };
  return { usd: null, range: null, basis: null };
}

// USD→KRW 환산값을 가격 객체에 부착(결정적). 단일값은 krw_per_mt, 범위는 krw_range.
function attachKrw(p, basisInfo, rateNow) {
  if (!p || !rateNow) return;
  if (basisInfo.usd) {
    p.krw_per_mt = Math.round(basisInfo.usd * rateNow);
    p.krw_basis = basisInfo.basis;
  } else if (basisInfo.range) {
    const lo = Math.round(basisInfo.range[0] * rateNow);
    const hi = Math.round(basisInfo.range[1] * rateNow);
    p.krw_range = `${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}원/MT`;
    p.krw_basis = basisInfo.basis;
  }
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

  // 환율 원가분해 — 전부 결정적(LLM 미경유). 돈 직결 로직.
  buildFx(parsed, ctx, prevRec);
}

// parsed.fx 조립 + 가격 객체 KRW 환산 부착. 환율(현재)이 없으면 parsed.fx = null.
function buildFx(parsed, ctx, prevRec) {
  if (!ctx.usdKrw?.rate) { parsed.fx = null; return; }
  // 표시·계산을 모두 '정수 원' 단위로 통일 — 화면의 1532-1518=14와 delta가 어긋나지 않게.
  const rateNow = Math.round(ctx.usdKrw.rate);
  const ratePrev = ctx.usdKrwPrev?.rate ? Math.round(ctx.usdKrwPrev.rate) : null;

  // 각 가격에 KRW 환산 부착(중국·러시아)
  const cnBasis = pickUsdBasis(parsed.china_price, 'fob_qinhuangdao');
  const ruBasis = pickUsdBasis(parsed.russia_price, 'fob_murmansk');
  attachKrw(parsed.china_price, cnBasis, rateNow);
  attachKrw(parsed.russia_price, ruBasis, rateNow);

  // 대표 분해 1건: 중국 우선, 단일 USD 있는 쪽 선택(범위만 있으면 분해 생략·민감도만)
  const rep = cnBasis.usd ? { basis: cnBasis, price: parsed.china_price, label: '중국 무연탄' }
            : ruBasis.usd ? { basis: ruBasis, price: parsed.russia_price, label: '러시아 무연탄' }
            : cnBasis.range ? { basis: cnBasis, price: parsed.china_price, label: '중국 무연탄' }
            : ruBasis.range ? { basis: ruBasis, price: parsed.russia_price, label: '러시아 무연탄' }
            : null;

  const delta = ratePrev != null ? rateNow - ratePrev : null;
  const deltaPct = ratePrev ? `${(((rateNow - ratePrev) / ratePrev) * 100).toFixed(1)}%` : null;

  let breakdown = null, sensitivity_line = null;
  if (rep?.basis.usd) {
    // 전월 USD 단가: 직전 캐시(ctx.prev)에서 동일 기준 추출(월 단위 갱신이라 근사)
    const prevPrice = rep.label.startsWith('중국') ? prevRec?.china_price : prevRec?.russia_price;
    const prevBasis = pickUsdBasis(prevPrice, rep.label.startsWith('중국') ? 'fob_qinhuangdao' : 'fob_murmansk');
    breakdown = computeFxCostBreakdown({
      cifUsdNow: rep.basis.usd, cifUsdPrev: prevBasis.usd,
      rateNow, ratePrev, basis: `${rep.label} ${rep.basis.basis}`,
    });
    sensitivity_line = `환율 1원↑ = ${rep.label} 원가 +${rep.basis.usd.toLocaleString('ko-KR')}원/MT`;
  } else if (rep?.basis.range) {
    const [lo, hi] = rep.basis.range;
    sensitivity_line = `환율 1원↑ = ${rep.label} 원가 +${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}원/MT`;
  }

  parsed.fx = {
    rate_now: rateNow,
    date_now: ctx.usdKrw?.date ?? null,
    source: ctx.usdKrw?.source ?? null,
    rate_prev: ratePrev,
    date_prev: ctx.usdKrwPrev?.date ?? null,
    delta,
    delta_pct: deltaPct,
    breakdown,
    sensitivity_line,
    note: '환율 기여=전월 30일 전 실거래 환율 기준. 시세 기여=직전 시세 대비(월 단위 갱신)라 근사.',
  };
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
