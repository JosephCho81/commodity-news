// src/types/market.ts — 타입 분할 파일 (index.ts 배럴로 재수출)
import type { Direction, ApiMeta, KeyIssue, FuturesQuote } from './common';

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
}

export interface ScrapLiveItem {
  label: string;
  usd: number;                   // USD/MT (표시 기준)
  cny?: number;                  // 원통화 보조표시 (중국)
  jpy?: number;                  // 원통화 보조표시 (일본)
}
export interface ScrapLiveRegion {
  region: string;                // 미국 · 중국 · 일본
  source: string;                // recycleinme · SHFE · dokindokin
  date?: string | null;
  note?: string;
  items: ScrapLiveItem[];
}
export interface ScrapLiveData {
  regions: ScrapLiveRegion[];    // 라이브 무료 소스만 (유럽 제외)
}

export interface AluminumScrap {
  weekly_summary: string;
  live?: ScrapLiveData | null;   // 지역별 라이브 시세 (미국·중국·일본, 전부 USD)
}

// ─── 2차 알루미늄 (스크랩·드로스·탈산제) ────────────────────────────────────

export interface DrossNewsItem {
  title: string;
  url: string;
  date?: string | null;
  source?: string | null;
  category?: string;            // 규제 | 공급 | 수요 | 가격 | 기타
  scope?: string;               // KR | GLOBAL | CN | JP
}

export interface DrossData extends ApiMeta {
  headline_judgment?: {
    feedstock?: string | null;  // 빠듯 | 보통 | 여유
    demand?: string | null;     // 강 | 중 | 약
    spread?: string | null;     // 확대 | 축소 | 보합
    summary?: string;
  };
  spread?: {
    lme_usd: number | null;            // LME 전해 신지금 (USD/MT)
    primary_shfe: number | null;       // SHFE 전해(1차) 정산 (CNY/MT, 원값)
    primary_usd?: number | null;       // 환산 (USD/MT)
    secondary_shfe: number | null;     // SHFE 주조(2차) 정산 (CNY/MT, 원값)
    secondary_usd?: number | null;     // 환산 (USD/MT)
    prim_sec_spread: number | null;    // 전해-주조 (CNY/MT, 원값)
    prim_sec_spread_usd?: number | null; // 환산 (USD/MT)
    prim_sec_spread_pct: string | null;
    note?: string;
  };
  futures?: FuturesQuote[];
  scrap?: AluminumScrap;
  supply?: { signal?: string; drivers?: string; outlook?: string };
  demand?: { signal?: string; drivers?: string; outlook?: string };
  regulation_watch?: Array<{
    title: string; what?: string; impact?: string; region?: string;
    published_date?: string | null; source_name?: string | null; url?: string | null;
  }>;
  market_summary?: string;
  key_issues?: KeyIssue[];
  _dross_news_kr?: DrossNewsItem[];
  _dross_news_global?: DrossNewsItem[];
  _dross_regulation?: DrossNewsItem[];
}

// ─── 가탄제 ─────────────────────────────────────────────────────────────────

export interface RecarburizerForm {
  label?: string;
  spec?: string;
  direction?: string | null;   // 상방 | 보합 | 하방
  commentary?: string | null;  // 다각도 3~5문장 시황 (RSS 근거)
}
export interface RecarburizerData extends ApiMeta {
  forms?: {
    lump?: RecarburizerForm;   // 소괴탄 (괴, F.C.80)
    fines?: RecarburizerForm;  // 분탄/코크스분탄 (분, F.C.82)
    decouple_note?: string | null;
  };
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
    krw_per_mt?: number | null;   // USD 단가 × 현재 환율 (서버 결정적 환산)
    krw_range?: string | null;    // 범위만 확인될 때 KRW 범위 (예: "148,000~266,400원/MT")
    krw_basis?: string | null;    // 환산 기준 ("CIF 한국" | "FOB" | "FOB 범위")
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
    krw_per_mt?: number | null;
    krw_range?: string | null;
    krw_basis?: string | null;
  };
  fx?: {
    rate_now: number;
    date_now?: string | null;
    source?: string | null;
    rate_prev?: number | null;
    date_prev?: string | null;
    delta?: number | null;       // 전월 대비 원/USD
    delta_pct?: string | null;
    breakdown?: {
      basis: string | null;
      fx_contrib: number | null; // 환율 기여 원/MT
      px_contrib: number | null; // 시세 기여 원/MT
      total: number | null;
      line: string | null;
    } | null;
    sensitivity_line?: string | null;
    note?: string;
  } | null;
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
