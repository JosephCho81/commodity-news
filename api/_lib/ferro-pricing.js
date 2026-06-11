// api/_lib/ferro-pricing.js — 합금철 가격 결정 계층 (전부 결정적)
// ① 내수 현물 검증·carry-forward ② 거래소 선물 부착·입찰 기준점 ③ USD/KRW·FOB·CIF·원/kg 환산

import { toNumber, validatePrice, carryForward } from './validate.js';
import { cnyToUsd } from './exchange-rate.js';
import { FERRO_EXPORT_TARIFFS, FREIGHT_CN_KR_USD_PER_MT, BID_MONTHS, findBidBaseline } from './market-config.js';

// LLM 출력 가격은 검증 없이 통과 금지 — bound·전일 대비 변동률 위반 또는 null이면
// 전일값 이월(carried_over) + 원래 기준일 유지. products = { fesi, femn, simn } (in-place).
export function validateSpotPrices(products, { prevData, latestData, prevDate }) {
  for (const [key, product] of Object.entries(products)) {
    if (!product) continue;
    if (product.carried_over === true) continue; // 전일 캐시 fallback — 재검증 불필요

    const prev = prevData?.[key] ?? latestData?.[key] ?? null;
    const v = validatePrice(product.price_cny, `${key}_cny`, prev?.price_cny);
    if (v.reason) console.warn(`[Validate] ${key}: ${v.reason}`);

    if (v.value !== null) {
      product.price_cny = v.value;
      product.carried_over = false;
      if (product.price_as_of === undefined) product.price_as_of = null;
    } else {
      const carried = carryForward(prev, prevDate ?? null);
      if (carried) {
        product.price_cny    = carried.value;
        product.price_as_of  = carried.as_of;
        product.price_source = carried.source;
        product.carried_over = true;
        console.warn(`[Validate] ${key}: 전일값 이월 (${carried.value} CNY, 기준 ${carried.as_of ?? '미상'})`);
      } else {
        product.price_cny = null; // 콜드스타트 — UI가 범위 표시로 degrade
        product.carried_over = false;
      }
    }
    // 부가 수치 결정적 정규화 (문자열 → 숫자, 비정상 → null)
    if ('hbis_bid_price' in product)   product.hbis_bid_price   = toNumber(product.hbis_bid_price);
    if ('ningxia_spot' in product)     product.ningxia_spot     = toNumber(product.ningxia_spot);
    if ('mn_ore_cif_korea' in product) product.mn_ore_cif_korea = toNumber(product.mn_ore_cif_korea);
  }
}

// ZCE 선물 부착(FeSi=SF, SiMn=SM, FeMn은 SM 연동 참고) + 입찰 기준점
// (BID_MONTHS 설정 시에만 — 미설정이면 배지 숨김)
export function attachFuturesAndBaseline(products, zce, priceHistory) {
  const { fesi, femn, simn } = products;
  if (fesi && zce?.sf) fesi.futures = zce.sf;
  if (simn && zce?.sm) simn.futures = zce.sm;
  if (femn && zce?.sm) femn.futures_ref = zce.sm;

  const histKey = { fesi: 'sf', simn: 'sm', femn: 'femn' };
  for (const [key, product] of Object.entries(products)) {
    if (!product) continue;
    const base = findBidBaseline(priceHistory, BID_MONTHS[key], histKey[key]);
    const current = product.futures?.settle ?? toNumber(product.price_cny);
    if (base && current) {
      const pct = ((current - base.baseline) / base.baseline) * 100;
      product.bid_baseline = {
        date: base.date,
        baseline_cny: base.baseline,
        change_pct: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      };
    }
  }
}

// CNY → USD/KRW 환산 + FOB·CIF·원/kg 추정 (전부 결정적 산술 — 가정은 명시)
export function applyConversions(products, exchangeRate, krwRate) {
  if (!exchangeRate) return;
  for (const [key, product] of Object.entries(products)) {
    if (!product) continue;
    if (product.price_cny) {
      product.price_usd = cnyToUsd(product.price_cny, exchangeRate);
    }
    if (product.futures?.settle) {
      product.futures.settle_usd = cnyToUsd(product.futures.settle, exchangeRate);
    }
    const t = FERRO_EXPORT_TARIFFS[key];
    // 환산 기준: 거래소 정산가 우선, 없으면 내수 현물
    const basisCny = product.futures?.settle ?? toNumber(product.price_cny);
    if (basisCny && t) {
      product.china_export_tariff_pct = t.pct;
      product.china_export_misc_usd   = t.misc_usd;
      product.china_export_tariff_ref = t.hs;
      const fob = basisCny * exchangeRate * (1 + t.pct / 100) + t.misc_usd;
      product.fob_est_usd = Math.round(fob);
      const cif = fob + FREIGHT_CN_KR_USD_PER_MT;
      product.cif_est_usd = Math.round(cif);
      product.freight_assumption_usd = FREIGHT_CN_KR_USD_PER_MT;
      if (krwRate) {
        product.krw_per_kg = Math.round((cif * krwRate) / 1000);
      }
    }
  }
  console.log(`[ExRate] ferroalloy 변환: 1 CNY = ${exchangeRate} USD, 1 USD = ${krwRate ?? 'N/A'} KRW`);
}
