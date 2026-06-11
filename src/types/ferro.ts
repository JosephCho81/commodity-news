// src/types/ferro.ts — 타입 분할 파일 (index.ts 배럴로 재수출)
import type { Direction, SteelSignal, ApiMeta, KeyIssue, FuturesQuote, BidBaseline } from './common';

// ─── 합금철 (FeSi + FeMn + SiMn) ───────────────────────────────────────────

export interface FerroProducer {
  country: string;
  company: string;
  issue: string;
  cause: string;
  outlook: string;
}

export interface FerroItem {
  price_cny: string | number | null;
  price_usd: string | null;        // 서버에서 환율 적용 후 계산
  price_as_of?: string | null;     // 가격 발표 기준일 (YYYY-MM-DD)
  price_source?: string | null;    // 가격 출처명 (SMM, HBIS 공시 등)
  carried_over?: boolean;          // 검증 실패/미확인으로 전일값 이월 여부
  futures?: FuturesQuote | null;     // 거래소 정산가 — 주 가격 (FeSi=SF, SiMn=SM)
  futures_ref?: FuturesQuote | null; // FeMn 전용: SiMn 선물 연동 참고
  bid_baseline?: BidBaseline | null; // 지난 입찰 시점 대비 변동
  cif_est_usd?: number | null;       // FOB + 운임 가정
  krw_per_kg?: number | null;        // 원/kg 환산 (CIF × USD/KRW ÷ 1000)
  freight_assumption_usd?: number | null;
  reference: string;               // "HBIS Group 2026년 3월 입찰가"
  direction: Direction;
  change_cny: string | null;       // "+190" or "-80" or null
  supply_cause: string;
  demand_cause: string;
  steel_signal: SteelSignal;
  steel_signal_reason: string;
  context: string;
  non_china_producers?: FerroProducer[];
  // FeSi 전용
  hbis_bid_price?: number | null;
  hbis_bid_month?: string | null;
  hbis_bid_change?: string | null;
  ningxia_spot?: number | null;
  china_production_status?: string | null;
  // FeMn 전용
  mn_ore_cif_korea?: number | null;
  ore_to_femn_spread?: string | null;
  korea_supply?: string | null;    // 국내 생산사(동부메탈 등) 가동·수급 동향
  // SiMn 전용
  china_overcapacity_note?: string | null;
  dual_input_cost?: string | null;
  // 수출 관세 + FOB 추정 (공통)
  china_export_tariff_pct?: number | null;
  china_export_misc_usd?: number | null;
  china_export_tariff_ref?: string | null;
  fob_est_usd?: number | null;
}

export interface FerroMarketSummary {
  fesi?: string;
  femn?: string;
  simn?: string;
  intl_context?: string;
  non_china_summary?: string;
  outlook?: string;
}

export interface FerroalloyData extends ApiMeta {
  exchange_rate_cny_usd?: number;  // 1 CNY = X USD (서버에서 주입)
  exchange_rate_usd_krw?: number | null; // 1 USD = X KRW (서버에서 주입)
  exchange_rate_date?: string;     // 환율 고시 날짜 (서버에서 주입)
  fesi: FerroItem;
  femn: FerroItem;
  simn: FerroItem;
  market_summary: FerroMarketSummary | string;
  key_issues?: KeyIssue[];
}
