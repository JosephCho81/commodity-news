import type { FerroalloyData, FerroItem, SteelSignal, Direction } from '../types';
import { SectionCard, TextBlock } from '../components/ui';
import { KeyIssuesSection } from '../components/KeyIssues';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function dirArrow(dir: Direction) {
  if (dir === 'UP')   return <span className="ferro-dir up">▲</span>;
  if (dir === 'DOWN') return <span className="ferro-dir down">▼</span>;
  return <span className="ferro-dir neutral">—</span>;
}

function SteelSignalBadge({ signal }: { signal: SteelSignal }) {
  const map: Record<SteelSignal, { label: string; cls: string }> = {
    DEMAND_STRONG: { label: '수요 강함',  cls: 'signal-demand-strong' },
    DEMAND_WEAK:   { label: '수요 약함',  cls: 'signal-demand-weak'   },
    SUPPLY_SHOCK:  { label: '공급 영향',  cls: 'signal-supply-shock'  },
    MIXED:         { label: '혼재',       cls: 'signal-mixed'         },
  };
  const { label, cls } = map[signal] ?? map.MIXED;
  return <span className={`steel-signal-badge ${cls}`}>{label}</span>;
}

// ─── 품목 카드 ────────────────────────────────────────────────────────────────

function FerroItemCard({
  name, abbr, item, accent,
}: {
  name: string; abbr: string; item: FerroItem; accent: string;
}) {
  const changeCny = item.change_cny;
  const changeColor = changeCny
    ? (String(changeCny).startsWith('-') ? 'var(--down)' : 'var(--up)')
    : 'var(--text3)';

  return (
    <SectionCard title={`${name} (${abbr})`} accent={accent}>
      {/* 가격 헤더 */}
      <div className="ferro-item-header">
        <div className="ferro-price-row">
          {item.price_usd ? (
            <span className="ferro-price-main">
              USD {item.price_usd}<small>/MT</small>
            </span>
          ) : item.price_cny ? (
            <span className="ferro-price-main">
              CNY {Number(String(item.price_cny).replace(/,/g, '')).toLocaleString('en-US')}<small>/MT</small>
            </span>
          ) : (
            <span className="ferro-price-na">가격 확인 중</span>
          )}
          {dirArrow(item.direction)}
        </div>

        <div className="ferro-meta-row">
          {item.price_cny && item.price_usd && (
            <span className="ferro-cny-ref">
              CNY {Number(String(item.price_cny).replace(/,/g, '')).toLocaleString('en-US')}/MT
            </span>
          )}
          {changeCny && (
            <span className="ferro-change" style={{ color: changeColor }}>
              전월比 {changeCny} CNY
            </span>
          )}
        </div>

        <div className="ferro-ref-note">{item.reference}</div>
      </div>

      {/* 원인 분석 */}
      <div className="cause-block">
        <div className="cause-row">
          <span className="cause-label cause-supply">공급</span>
          <span className="cause-text">{item.supply_cause}</span>
        </div>
        <div className="cause-row">
          <span className="cause-label cause-demand">수요</span>
          <span className="cause-text">{item.demand_cause}</span>
        </div>
      </div>

      {/* 철강 업황 시그널 */}
      <div className="ferro-signal-block">
        <div className="ferro-signal-header">
          <span className="ferro-signal-title">철강 업황 시그널</span>
          <SteelSignalBadge signal={item.steel_signal} />
        </div>
        <p className="ferro-signal-reason">{item.steel_signal_reason}</p>
      </div>

      {/* 시장 종합 */}
      {item.context && (
        <div className="outlook-box">
          <span className="outlook-label">시장 현황</span>
          <p className="outlook-text">{item.context}</p>
        </div>
      )}
    </SectionCard>
  );
}

// ─── 메인 탭 ────────────────────────────────────────────────────────────────

export function FerroalloyTab({ data }: { data: FerroalloyData }) {
  const { fesi, femn, simn, market_summary, exchange_rate_cny_usd } = data;

  const rateLabel = exchange_rate_cny_usd
    ? `환율: 1 CNY = ${exchange_rate_cny_usd.toFixed(4)} USD`
    : null;

  return (
    <div className="tab-content">
      {/* 상단 3개 품목 가격 요약 */}
      <div className="price-hero">
        <div className="ferro-top-grid">
          {[
            { abbr: 'FeSi', name: '페로실리콘', item: fesi },
            { abbr: 'FeMn', name: '페로망간',   item: femn },
            { abbr: 'SiMn', name: '실리콘망간', item: simn },
          ].map(({ abbr, name, item }) => (
            <div key={abbr} className="ferro-top-card">
              <div className="ferro-top-abbr">{abbr}</div>
              <div className="ferro-top-name">{name}</div>
              <div className="ferro-top-price-row">
                {item?.price_usd ? (
                  <span className="ferro-top-usd">
                    {item.price_usd}<small> USD</small>
                  </span>
                ) : item?.price_cny ? (
                  <span className="ferro-top-usd">
                    CNY {Number(String(item.price_cny).replace(/,/g, '')).toLocaleString('en-US')}
                  </span>
                ) : (
                  <span className="ferro-top-na">—</span>
                )}
                {item && dirArrow(item.direction)}
              </div>
              {item?.change_cny && (
                <div
                  className="ferro-top-change"
                  style={{
                    color: String(item.change_cny).startsWith('-') ? 'var(--down)' : 'var(--up)',
                  }}
                >
                  전월比 {item.change_cny} CNY
                </div>
              )}
            </div>
          ))}
        </div>
        {rateLabel && <div className="ferro-exrate-note">{rateLabel}</div>}
      </div>

      <KeyIssuesSection issues={(data as any).key_issues ?? []} />

      <FerroItemCard name="페로실리콘" abbr="FeSi 75"  item={fesi} accent="FeSi" />
      <FerroItemCard name="페로망간"   abbr="FeMn HC78" item={femn} accent="FeMn" />
      <FerroItemCard name="실리콘망간" abbr="SiMn 6517" item={simn} accent="SiMn" />

      <SectionCard title="합금철 시장 종합" accent="SUM">
        <TextBlock text={market_summary} />
      </SectionCard>
    </div>
  );
}
