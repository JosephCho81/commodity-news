// 합금철 탭 공용 상수·헬퍼 (TopCard·PriceHeader·Sections에서 공유)
import type { FerroItem, SteelSignal, Direction } from '../../types';
import { isOlderThanDays } from '../../utils/format';

export const FERRO_FALLBACK_RANGE: Record<string, string> = {
  FeSi: 'CNY 5,500~7,000',
  FeMn: 'CNY 6,500~8,500',
  SiMn: 'CNY 4,800~6,500',
};

// 품목 ↔ 시계열 필드 매핑 (서버 price_history_ferroalloy 스키마)
export const HISTORY_KEY: Record<string, string> = { FeSi: 'sf', SiMn: 'sm', FeMn: 'femn' };

// 이월 가격이 7일 넘게 오래되면 숫자 대신 통상 범위 표시로 강등
export function isStalePrice(item: FerroItem): boolean {
  return item.carried_over === true && isOlderThanDays(item.price_as_of, 7);
}

export function dirArrow(dir: Direction) {
  if (dir === 'UP')   return <span className="ferro-dir up">▲</span>;
  if (dir === 'DOWN') return <span className="ferro-dir down">▼</span>;
  return <span className="ferro-dir neutral">—</span>;
}

export function SteelSignalBadge({ signal }: { signal: SteelSignal }) {
  const map: Record<SteelSignal, { label: string; cls: string }> = {
    DEMAND_STRONG: { label: '수요 강함',  cls: 'signal-demand-strong' },
    DEMAND_WEAK:   { label: '수요 약함',  cls: 'signal-demand-weak'   },
    SUPPLY_SHOCK:  { label: '공급 영향',  cls: 'signal-supply-shock'  },
    MIXED:         { label: '혼재',       cls: 'signal-mixed'         },
  };
  const { label, cls } = map[signal] ?? map.MIXED;
  return <span className={`steel-signal-badge ${cls}`}>{label}</span>;
}
