// src/types/market.ts — 타입 분할 파일 (index.ts 배럴로 재수출)
import type { Direction, ApiMeta, KeyIssue } from './common';

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
      price_items?: Array<{ grade: string; price: string }> | null; // 서버 직접 수집값 — 한 줄에 한 품목
      price_driver: string;
      flow: string;
      outlook?: string | null;
    }>;
  };
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
