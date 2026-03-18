// src/types.ts — 비철금속 원자재 인텔리전스 타입 정의

export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
export type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';
export type Probability = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ApiMeta {
  _cached?: boolean;
  _fallback?: boolean;
  _age_min?: number;
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

export interface FerrosiliconData extends ApiMeta {
  china_price: {
    hbis_bid_price?: string | null;
    hbis_bid_month?: string | null;
    hbis_bid_change?: string | null;
    fob_tianjin_monthly?: Record<string, string | null>;
    fesi75_ningxia?: string | null;
    date?: string | null;
    change?: string | null;
    china_context?: string;
    china_outlook?: string;
  };
  china_production: { overall: string; };
  non_china: Array<{
    country: string;
    producer: string;
    status: string;
    price_context?: string;
    export_direction: string;
  }>;
  non_china_context?: string;
  korea_import?: string;
  market_summary: string;
}

export interface RecarburizerData extends ApiMeta {
  china_price: {
    fob_qinhuangdao?: number | string | null;
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
}

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
  week_ahead: string;
}

export type TabId = 'aluminum' | 'ferrosilicon' | 'recarburizer' | 'summary';

export interface TabConfig {
  id: TabId;
  label: string;
  labelEn: string;
  icon: string;
}

export const TABS: TabConfig[] = [
  { id: 'aluminum',     label: '알루미늄',   labelEn: 'Aluminum',     icon: '◈' },
  { id: 'ferrosilicon', label: '페로실리콘', labelEn: 'FerroSilicon', icon: '◉' },
  { id: 'recarburizer', label: '가탄제',     labelEn: 'Recarburizer', icon: '◍' },
  { id: 'summary',      label: '시황 종합',  labelEn: 'Summary',      icon: '▦' },
];
