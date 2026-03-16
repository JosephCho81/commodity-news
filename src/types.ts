// src/types.ts — 비철금속 원자재 인텔리전스 타입 정의

// ─── 공통 ─────────────────────────────────────────────────────────────────────
export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
export type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';
export type Probability = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ApiMeta {
  _cached?: boolean;
  _age_min?: number;
  updated_at?: string;
}

// ─── 알루미늄 탭 ──────────────────────────────────────────────────────────────
export interface AluminumData extends ApiMeta {
  lme: {
    price: string | null;
    change: string | null;
    change_pct: string | null;
    date: string | null;
    move_reason: string;
    market_status: string;
    outlook: string;
  };
  scrap: {
    weekly_summary: string;
    regions: Array<{
      region: string;
      grades: string;
      price_range: string | null;
      flow: string;
    }>;
  };

}

// ─── 페로실리콘 탭 ────────────────────────────────────────────────────────────
export interface FerrosiliconData extends ApiMeta {
  china_price: {
    fesi75_ningxia: string | null;
    fesi75_neimenggu: string | null;
    date: string | null;
    change: string | null;
    price_context: string;
  };
  china_production: {
    ningxia: {
      power_situation: string;
      utilization_rate: string | null;
      weather_impact: string;
    };
    yunnan: {
      power_situation: string;
      utilization_rate: string | null;
      weather_impact: string;
    };
    overall: string;
  };
  non_china: Array<{
    country: string;
    producer: string;
    status: string;
    export_direction: string;
  }>;
  export_flows: {
    korea: string;
    japan: string;
    eu: string;
    india: string;
  };
  market_summary: string;
}

// ─── 가탄제 탭 ────────────────────────────────────────────────────────────────
export interface RecarburizerData extends ApiMeta {
  china_price: {
    anthracite_shanxi: string | null;
    anthracite_guizhou: string | null;
    calcined_anthracite: string | null;
    date: string | null;
    change: string | null;
    price_context: string;
  };
  china_production: {
    mining_status: string;
    processing_status: string;
    policy_impact: string;
  };
  russia: {
    export_volume: string;
    sanctions_impact: string;
    price_competitiveness: string;
  };
  asia_flows: Array<{
    importer: string;
    main_sources: string;
    volume_trend: string;
    price_trend: string;
  }>;
  market_summary: string;
}

// ─── 시황 종합 탭 ─────────────────────────────────────────────────────────────
export interface SummaryData extends ApiMeta {
  date: string | null;
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

// ─── 탭 정의 ──────────────────────────────────────────────────────────────────
export type TabId = 'aluminum' | 'ferrosilicon' | 'recarburizer' | 'summary';

export interface TabConfig {
  id: TabId;
  label: string;
  labelEn: string;
  icon: string;
}

export const TABS: TabConfig[] = [
  { id: 'aluminum',     label: '알루미늄',   labelEn: 'Aluminum',     icon: '⬡' },
  { id: 'ferrosilicon', label: '페로실리콘', labelEn: 'FerroSilicon', icon: '⚡' },
  { id: 'recarburizer', label: '가탄제',     labelEn: 'Recarburizer', icon: '◆' },
  { id: 'summary',      label: '시황 종합',  labelEn: 'Summary',      icon: '◎' },
];
