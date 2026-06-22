// 합금철 품목 카드 가격 헤더 + FOB·원/kg 환산 footnote
import type { FerroItem } from '../../types';
import { formatInt } from '../../utils/format';
import { PriceMeta, SourceChip, DeltaPill } from '../../components/data-viz';
import { FERRO_FALLBACK_RANGE, isStalePrice, dirArrow } from './shared';

export function FerroPrice({ item, abbr }: { item: FerroItem; abbr: string }) {
  const changeColor = item.change_cny
    ? (String(item.change_cny).startsWith('-') ? 'var(--down)' : 'var(--up)')
    : 'var(--text3)';
  const stale = isStalePrice(item);
  const fut = item.futures ?? null;

  // 거래소 정산가 우선 — 표시는 USD 우선(서버 환산 settle_usd), CNY는 참고 줄로 강등
  if (fut) {
    return (
      <div className="ferro-item-header">
        <div className="ferro-price-row">
          <span className="ferro-price-main">
            {fut.settle_usd
              ? <>USD {fut.settle_usd}<small>/MT</small></>
              : <>CNY {fut.settle.toLocaleString('en-US')}<small>/MT</small></>}
          </span>
          <DeltaPill change={fut.change} changePct={fut.change_pct} />
        </div>
        <div className="ferro-meta-row">
          <SourceChip label={`${fut.exchange ?? 'ZCE'} ${fut.contract ?? '주력'} 정산`} />
          {fut.date && <span className="ferro-cny-ref">{fut.date} 기준</span>}
          {fut.settle_usd && <span className="ferro-cny-ref">CNY {fut.settle.toLocaleString('en-US')}/MT</span>}
        </div>
        {!stale && item.price_cny && (
          <div className="ferro-meta-row">
            <span className="ferro-cny-ref">
              내수 현물 CNY {formatInt(item.price_cny)}/MT
            </span>
            <PriceMeta source={item.price_source} asOf={item.price_as_of} carriedOver={item.carried_over} />
          </div>
        )}
        {item.bid_baseline && (
          <div className="ferro-meta-row">
            <span className="bid-baseline-chip">지난 입찰({item.bid_baseline.date.slice(0, 7)}) 대비 {item.bid_baseline.change_pct}</span>
          </div>
        )}
      </div>
    );
  }

  if (stale) {
    return (
      <div className="ferro-item-header">
        <div className="ferro-price-row">
          <span className="ferro-price-main ferro-price-cny-only">
            {FERRO_FALLBACK_RANGE[abbr] ?? '—'}<small>/MT</small>
          </span>
          {dirArrow(item.direction)}
        </div>
        <div className="ferro-meta-row">
          <span className="ferro-cny-ref">시장 통상 범위 (실시간 아님 — 최근 확인가 {item.price_as_of} 기준)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ferro-item-header">
      <div className="ferro-price-row">
        {item.price_usd ? (
          <>
            <span className="ferro-price-main">
              USD {item.price_usd}<small>/MT</small>
            </span>
            <span className="ferro-price-cny-inline">
              (CNY {formatInt(item.price_cny)}/MT, 중국 내수가)
            </span>
          </>
        ) : item.price_cny ? (
          <>
            <span className="ferro-price-main ferro-price-cny-only">
              CNY {formatInt(item.price_cny)}<small>/MT</small>
            </span>
            <span className="ferro-price-cny-inline">(내수가)</span>
          </>
        ) : (
          <span className="ferro-price-main ferro-price-cny-only">
            {FERRO_FALLBACK_RANGE[abbr] ?? '—'}<small>/MT</small>
          </span>
        )}
        {dirArrow(item.direction)}
      </div>
      {(item.change_cny || item.price_source || item.price_as_of || item.carried_over) && (
        <div className="ferro-meta-row">
          {item.change_cny && (
            <span className="ferro-change" style={{ color: changeColor }}>
              전월比 {item.change_cny} CNY{' '}
            </span>
          )}
          <PriceMeta source={item.price_source} asOf={item.price_as_of} carriedOver={item.carried_over} />
        </div>
      )}
    </div>
  );
}

export function FobNote({ item }: { item: FerroItem }) {
  if (item.fob_est_usd == null || item.china_export_tariff_pct == null) return null;
  return (
    <div className="ferro-fob-note">
      <div>
        * 한국 수입 시, 중국 수출 관세 {item.china_export_tariff_pct}%
        {item.china_export_misc_usd != null && ` + 수출 부대비용 약 $${item.china_export_misc_usd}/톤`}
        {' → '}FOB 추정 USD {item.fob_est_usd.toLocaleString('en-US')}/톤
        {item.cif_est_usd != null && item.freight_assumption_usd != null && (
          <> · 운임 ${item.freight_assumption_usd} 가정 시 CIF USD {item.cif_est_usd.toLocaleString('en-US')}/톤</>
        )}
        {item.krw_per_kg != null && <> ≈ <b>{item.krw_per_kg.toLocaleString('en-US')}원/kg</b></>}
      </div>
      {item.china_export_tariff_ref && (
        <div className="ferro-cny-ref">{item.china_export_tariff_ref}</div>
      )}
    </div>
  );
}
