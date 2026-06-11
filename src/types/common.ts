// src/types/common.ts — 타입 분할 파일 (index.ts 배럴로 재수출)
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

// 중국 상품선물 정산가 (ZCE/SHFE/DCE — 거래소 공식, 서버 zce-futures.js 수집)
export interface FuturesQuote {
  product?: string;
  label?: string;            // '페로실리콘' 등 표시명
  exchange?: string;         // 'ZCE' | 'SHFE' | 'DCE'
  contract?: string;         // 'SF609' | '주력'
  settle: number;            // 정산가 (CNY/MT)
  prev_settle?: number | null;
  change?: number | null;
  change_pct?: string | null;
  settle_usd?: string | null;
  volume?: number | null;
  open_interest?: number | null;
  date?: string | null;
  source?: string;           // 'sina' | 'czce'
}

// 국내 철강 전문지 RSS 헤드라인 (1차 보도 — 제목·URL·날짜 원본)
export interface KrNewsItem {
  title: string;
  url: string;
  date?: string | null;
  source?: string | null;
}

// 가격 시계열 한 점 (탭별 수치 필드 상이 — sf/sm/femn/lme)
export interface PriceHistoryEntry {
  d: string;
  [key: string]: string | number | null;
}

// 입찰 기준점 (BID_MONTHS 설정 시에만 서버가 계산)
export interface BidBaseline {
  date: string;
  baseline_cny: number;
  change_pct: string;
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
  _kr_news?: KrNewsItem[];      // 국내 전문지 헤드라인
  _china_futures?: FuturesQuote[]; // 중국 철강 체인 선물
  _price_history?: PriceHistoryEntry[]; // 가격 시계열 (스파크라인)
  updated_at?: string;
}
