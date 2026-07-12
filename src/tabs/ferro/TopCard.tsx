// 합금철 상단 요약 카드 — 거래소 정산가 우선, 선물 미상장(FeMn)은 내수 현물
import type { FerroItem, PriceHistoryEntry } from '../../types';
import { formatInt } from '../../utils/format';
import { PriceMeta, SourceChip, DeltaPill, Sparkline } from '../../components/data-viz';
import { FERRO_FALLBACK_RANGE, HISTORY_KEY, isStalePrice, dirArrow } from './shared';

export function TopCard({ abbr, name, item, history }: {
  abbr: string; name: string; item: FerroItem | null; history?: PriceHistoryEntry[] | null;
}) {
  if (!item) {
    return (
      <div className="ferro-top-card">
        <div className="ferro-top-name">{name} ({abbr})</div>
        <div className="ferro-top-price-row">
          <span className="ferro-top-usd">{FERRO_FALLBACK_RANGE[abbr] ?? '—'}</span>
          <span className="ferro-dir neutral">—</span>
        </div>
      </div>
    );
  }

  const fut = item.futures ?? null;

  // ① 거래소 정산가가 있으면 그것이 주 가격 (hallucination 불가능한 숫자)
  // 표시는 USD 우선 — 서버 환산값(settle_usd) 사용, 없을 때만 CNY 폴백
  if (fut) {
    return (
      <div className="ferro-top-card">
        <div className="ferro-top-name">{name} ({abbr})</div>
        <div className="ferro-top-price-row">
          <span className="ferro-top-usd">
            {fut.settle_usd ? `USD ${fut.settle_usd}` : `CNY ${fut.settle.toLocaleString('en-US')}`}
          </span>
        </div>
        <DeltaPill change={fut.change} changePct={fut.change_pct} />
        <div className="ferro-top-spark-row">
          <Sparkline history={history} valueKey={HISTORY_KEY[abbr] ?? ''} width={64} height={18} />
          <SourceChip label={`${fut.exchange ?? 'ZCE'} 정산`} />
        </div>
        {fut.settle_usd && (
          <div className="ferro-top-cny">CNY {fut.settle.toLocaleString('en-US')}/MT</div>
        )}
        {item.krw_per_kg != null && (
          <div className="ferro-top-cny">≈ {item.krw_per_kg.toLocaleString('en-US')}원/kg 한국 착</div>
        )}
        {item.bid_baseline && (
          <div className="ferro-top-cny ferro-top-bid">지난 입찰({item.bid_baseline.date.slice(0, 7)}) 대비 {item.bid_baseline.change_pct}</div>
        )}
      </div>
    );
  }

  // ② 선물 미상장(FeMn) — 기존 내수 현물 표시 유지
  const changeColor = item.change_cny
    ? (String(item.change_cny).startsWith('-') ? 'var(--down)' : 'var(--up)')
    : 'var(--text3)';
  const stale = isStalePrice(item);

  return (
    <div className="ferro-top-card">
      <div className="ferro-top-name">{name} ({abbr})</div>
      <div className="ferro-top-price-row">
        {stale ? (
          <span className="ferro-top-usd">{FERRO_FALLBACK_RANGE[abbr] ?? '—'}</span>
        ) : item.price_usd ? (
          <span className="ferro-top-usd">USD {item.price_usd}</span>
        ) : item.price_cny ? (
          <span className="ferro-top-usd">CNY {formatInt(item.price_cny)}</span>
        ) : (
          <span className="ferro-top-usd">{FERRO_FALLBACK_RANGE[abbr] ?? '—'}</span>
        )}
        {dirArrow(item.direction)}
      </div>
      {stale ? (
        <div className="ferro-top-cny">시장 통상 범위 (실시간 아님)</div>
      ) : (
        <>
          {item.price_cny && item.price_usd && (
            <div className="ferro-top-cny">
              CNY {formatInt(item.price_cny)}/MT <span className="ferro-top-domestic">중국 내수가</span>
            </div>
          )}
          {item.change_cny && (
            <div className="ferro-top-change" style={{ color: changeColor }}>
              전월比 {item.change_cny} CNY
            </div>
          )}
          {item.futures_ref && (
            <div className="ferro-top-cny">
              SiMn 선물 연동 {item.futures_ref.change_pct ?? ''} <SourceChip label="참고" tone="muted" />
            </div>
          )}
          {item.krw_per_kg != null && (
            <div className="ferro-top-cny">≈ {item.krw_per_kg.toLocaleString('en-US')}원/kg 한국 착</div>
          )}
          {(item.carried_over || item.price_as_of) && (
            <div className="ferro-top-cny">
              <PriceMeta asOf={item.price_as_of} carriedOver={item.carried_over} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
