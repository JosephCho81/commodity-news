// src/types/steel.ts — 타입 분할 파일 (index.ts 배럴로 재수출)
import type { Direction, Urgency, Probability, ApiMeta } from './common';

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

// 브리핑(구 시황종합)이 기본 탭 — "출근 10분 전 체크" 동선.
// id는 API 호환을 위해 유지하고 라벨·순서만 재편.
export const TABS: TabConfig[] = [
  { id: 'summary',     label: '브리핑',    labelEn: 'Briefing'     },
  { id: 'ferroalloy',  label: '합금철',    labelEn: 'Ferro Alloy'  },
  { id: 'aluminum',    label: '알루미늄',  labelEn: 'Aluminum'     },
  { id: 'recarburizer',label: '가탄제',    labelEn: 'Recarburizer' },
  { id: 'steelmaker',  label: '철강 업황', labelEn: 'Steel Market' },
];
