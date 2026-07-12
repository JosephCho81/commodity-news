// 데스크탑 홈 우측 레일 시세 보드 — collectPrices 결과를 세로 행으로 렌더.
// rows 전량 렌더(필터 금지). 프리페치 실패 시 안내줄/안내문/스켈레톤으로 분기.
import type { FerroalloyData, AluminumData, RecarburizerData, ApiMeta } from '../types';
import { collectPrices } from './BriefingWidgets';
import { freshnessLabel } from './ui';
import { SourceChip, DeltaPill, Sparkline } from './data-viz';

const PRICE_TABS = ['ferroalloy', 'aluminum', 'recarburizer'] as const;
const TAB_KO: Record<string, string> = { ferroalloy: '합금철', aluminum: '알루미늄', recarburizer: '가탄제' };

export function PriceBoard({ fa, al, rec, errors }: {
  fa?: FerroalloyData; al?: AluminumData; rec?: RecarburizerData;
  errors?: Record<string, boolean>;
}) {
  const { rows, fxLine } = collectPrices(fa, al, rec);
  const failed = PRICE_TABS.filter(t => errors?.[t]);

  if (rows.length === 0) {
    // 3탭 전부 실패면 안내문, 아니면(아직 수집 중) 스켈레톤
    return (
      <div className="price-board">
        <div className="price-board-head"><span className="price-board-title">주요 시세</span></div>
        {failed.length === PRICE_TABS.length
          ? <div className="price-board-empty">시세를 불러오지 못했습니다. 각 품목 탭에서 다시 시도하세요.</div>
          : <div className="skeleton skeleton-card" />}
      </div>
    );
  }

  const meta = (fa ?? al ?? rec) as ApiMeta | undefined;
  return (
    <div className="price-board">
      <div className="price-board-head">
        <span className="price-board-title">주요 시세</span>
        <span className="price-board-date">{freshnessLabel(meta)}</span>
      </div>
      <div className="price-board-rows">
        {rows.map(r => (
          <div key={r.key} className="price-board-row">
            <div className="price-board-row-top">
              <span className="price-board-name">{r.name}</span>
              {r.chip && <SourceChip label={r.chip} tone="muted" />}
            </div>
            <div className="price-board-row-mid">
              <span className="price-board-value">{r.value}<small> {r.unit}</small></span>
              {r.sparkKey && <Sparkline history={r.history} valueKey={r.sparkKey} width={72} height={18} />}
            </div>
            <DeltaPill change={r.change} changePct={r.changePct} />
          </div>
        ))}
      </div>
      {failed.length > 0 && (
        <div className="price-board-note">일부 시세 미수집 ({failed.map(t => TAB_KO[t]).join(' · ')})</div>
      )}
      {fxLine && <div className="price-board-foot">{fxLine}</div>}
    </div>
  );
}
