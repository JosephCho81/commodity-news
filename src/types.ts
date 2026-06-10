// src/types.ts — 비철금속 원자재 인텔리전스 타입 정의

export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
export type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';
export type Probability = 'HIGH' | 'MEDIUM' | 'LOW';
export type OperatingRate = 'HIGH' | 'MID' | 'LOW';
export type SteelSignal = 'DEMAND_STRONG' | 'DEMAND_WEAK' | 'SUPPLY_SHOCK' | 'MIXED';


export interface SourceInfo {
  title?: string | null;
  url: string;
  date?: string | null;
}

export interface KeyIssue {
  title: string;
  what?: string;
  why?: string;
  impact?: string;
  outlook?: string;
  published_date?: string | null;
  source_name?: string | null;
  url?: string | null;
}

export interface ApiMeta {
  _cached?: boolean;
  _fallback?: boolean;
  _age_min?: number;
  _data_date?: string | null;   // 이 데이터가 생성된 KST 날짜
  _cached_at?: number | null;   // 캐시 저장 시각 (ms)
  _sources?: SourceInfo[];      // Perplexity search_results 기반 참고 출처
  updated_at?: string;
}

export interface AluminumData extends ApiMeta {
  lme: {
    price: string | null;
    change: string | null;
    change_pct: string | null;
    date: string | null;
    move_reason: string;
    market_status: string;
    outlook: string;
    lme_verified?: boolean | string;
    lme_verify_source?: string;
    source?: string | null;        // 'westmetall' | 'perplexity' | 'carried' 등
    carried_over?: boolean;        // 전일값 이월 여부
    holiday_note?: string | null;
    key_issues?: KeyIssue[];
  };
  scrap: {
    weekly_summary: string;
    us_premium: string | null;
    eu_premium: string | null;
    japan_premium: string | null;
    regions: Array<{
      region: string;
      key_grades: string;
      price_range: string | null;
      price_driver: string;
      flow: string;
      outlook?: string | null;
    }>;
  };
}

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
  exchange_rate_date?: string;     // 환율 고시 날짜 (서버에서 주입)
  fesi: FerroItem;
  femn: FerroItem;
  simn: FerroItem;
  market_summary: FerroMarketSummary | string;
  key_issues?: KeyIssue[];
}

// ─── 가탄제 ─────────────────────────────────────────────────────────────────

export interface RecarburizerData extends ApiMeta {
  china_price: {
    fob_qinhuangdao?: number | string | null;
    as_of?: string | null;
    source?: string | null;
    carried_over?: boolean;
    cif_korea?: number | string | null;
    domestic_shanxi?: number | string | null;
    calcined_cac_fob?: number | string | null;
    price_range_text?: string | null;
    price_range_source?: string | null;
    price_range_note?: string | null;
    date?: string | null;
    change?: string | null;
  };
  russia_price: {
    fob_murmansk?: number | string | null;
    as_of?: string | null;
    source?: string | null;
    carried_over?: boolean;
    cif_korea?: number | string | null;
    price_range_text?: string | null;
    price_range_source?: string | null;
    price_range_note?: string | null;
    date?: string | null;
    change?: string | null;
    vs_china?: string | null;
  };
  global_market?: {
    headline?: string;
    current_level?: string;
    key_drivers?: string;
    outlook?: string;
  };
  china_production?: {
    annual_output?: string | null;
    annual_consumption?: string | null;
    export_volume?: string | null;
    production_status?: string;
    cbam_carbon?: string;
    policy?: string;
    outlook?: string;
  };
  russia_production?: {
    annual_output?: string | null;
    export_volume?: string | null;
    main_importers?: string;
    production_status?: string;
    war_impact?: string;
    sanctions_impact?: string;
    outlook?: string;
  };
  asia_flows?: any;
  market_summary: string;
  key_issues?: KeyIssue[];
}

// ─── 제강사 ─────────────────────────────────────────────────────────────────

export interface IndustryStatus {
  direction: Direction;
  status: string;
  reason: string;
  outlook: string;
}

export interface DomesticMaker {
  name: string;
  recent_issues: string;
  direction: Direction;
  status: string;
  reason: string;
  outlook: string;
}

export interface OverseasMaker {
  country: string;
  makers: string;
  recent_issues: string;
  direction: Direction;
  status: string;
  reason: string;
  outlook: string;
}

export interface SteelmakerData extends ApiMeta {
  domestic_makers: DomesticMaker[];
  overseas_makers: OverseasMaker[];
  demand_industries: {
    construction_korea: IndustryStatus;
    construction_china: IndustryStatus;
    auto: IndustryStatus;
    shipbuilding: IndustryStatus;
  };
}

// ─── 시황 종합 ───────────────────────────────────────────────────────────────

export interface SummaryData extends ApiMeta {
  date?: string | null;
  one_liner: string;
  key_signals: Array<{
    commodity: string;
    signal: string;
    direction: Direction;
    urgency: Urgency;
  }>;
  risk_signals: Array<{
    risk: string;
    affected: string;
    probability: Probability;
    impact: string;
  }>;
  week_ahead: Array<{ variable: string; why: string; expected: string }>;
}

// ─── 탭 설정 ─────────────────────────────────────────────────────────────────

export type TabId = 'steelmaker' | 'aluminum' | 'ferroalloy' | 'recarburizer' | 'summary';

export interface TabConfig {
  id: TabId;
  label: string;
  labelEn: string;
}

export const TABS: TabConfig[] = [
  { id: 'steelmaker',  label: '제강사',    labelEn: 'Steel Maker'  },
  { id: 'aluminum',    label: '알루미늄',  labelEn: 'Aluminum'     },
  { id: 'ferroalloy',  label: '합금철',    labelEn: 'Ferro Alloy'  },
  { id: 'recarburizer',label: '가탄제',    labelEn: 'Recarburizer' },
  { id: 'summary',     label: '시황 종합', labelEn: 'Summary'      },
];
