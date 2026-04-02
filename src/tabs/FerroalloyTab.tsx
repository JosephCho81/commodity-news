import type { FerroalloyData, FerroItem, FerroProducer, SteelSignal, Direction } from '../types';
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

function fmtCny(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const n = Number(String(val).replace(/,/g, ''));
  if (isNaN(n)) return String(val);
  return n.toLocaleString('en-US');
}

// ─── 상단 요약 카드 ────────────────────────────────────────────────────────────

function TopCard({ abbr, name, item }: { abbr: string; name: string; item: FerroItem }) {
  const changeColor = item.change_cny
    ? (String(item.change_cny).startsWith('-') ? 'var(--down)' : 'var(--up)')
    : 'var(--text3)';

  return (
    <div className="ferro-top-card">
      <div className="ferro-top-abbr">{abbr}</div>
      <div className="ferro-top-name">{name}</div>
      <div className="ferro-top-price-row">
        {item.price_usd ? (
          <span className="ferro-top-usd">USD {item.price_usd}</span>
        ) : item.price_cny ? (
          <span className="ferro-top-usd">CNY {fmtCny(item.price_cny)}</span>
        ) : (
          <span className="ferro-top-na">—</span>
        )}
        {dirArrow(item.direction)}
      </div>
      {item.price_cny && item.price_usd && (
        <div className="ferro-top-cny">
          CNY {fmtCny(item.price_cny)}/MT <span className="ferro-top-domestic">내수가</span>
        </div>
      )}
      {item.change_cny && (
        <div className="ferro-top-change" style={{ color: changeColor }}>
          전월比 {item.change_cny} CNY
        </div>
      )}
    </div>
  );
}

// ─── 가격 헤더 ────────────────────────────────────────────────────────────────

function FerroPrice({ item }: { item: FerroItem }) {
  const changeColor = item.change_cny
    ? (String(item.change_cny).startsWith('-') ? 'var(--down)' : 'var(--up)')
    : 'var(--text3)';

  return (
    <div className="ferro-item-header">
      <div className="ferro-price-row">
        {item.price_usd ? (
          <>
            <span className="ferro-price-main">
              USD {item.price_usd}<small>/MT</small>
            </span>
            <span className="ferro-price-cny-inline">
              (CNY {fmtCny(item.price_cny)}/MT, 내수가)
            </span>
          </>
        ) : item.price_cny ? (
          <>
            <span className="ferro-price-main ferro-price-cny-only">
              CNY {fmtCny(item.price_cny)}<small>/MT</small>
            </span>
            <span className="ferro-price-cny-inline">(내수가)</span>
          </>
        ) : (
          <span className="ferro-price-na">가격 확인 중</span>
        )}
        {dirArrow(item.direction)}
      </div>
      {item.change_cny && (
        <div className="ferro-meta-row">
          <span className="ferro-change" style={{ color: changeColor }}>
            전월比 {item.change_cny} CNY
          </span>
        </div>
      )}
    </div>
  );
}

// ─── 비중국 생산국 (뉴스/이슈 중심) ──────────────────────────────────────────

function NonChinaProducers({ producers }: { producers: FerroProducer[] }) {
  if (!producers || producers.length === 0) return null;
  return (
    <div className="non-china-block">
      <div className="non-china-title">비중국 주요 생산지 동향</div>
      <div className="non-china-list">
        {producers.map((p, i) => (
          <div key={i} className="non-china-row">
            <div className="non-china-header">
              <span className="non-china-country">{p.country}</span>
              <span className="non-china-company">{p.company}</span>
            </div>
            <div className="non-china-detail">
              {p.issue && (
                <div className="key-issue-row">
                  <span className="key-issue-label ki-what">이슈</span>
                  <span className="key-issue-text">{p.issue}</span>
                </div>
              )}
              {p.cause && (
                <div className="key-issue-row">
                  <span className="key-issue-label ki-why">원인</span>
                  <span className="key-issue-text">{p.cause}</span>
                </div>
              )}
              {p.outlook && (
                <div className="key-issue-row">
                  <span className="key-issue-label ki-outlook">전망</span>
                  <span className="key-issue-text">{p.outlook}</span>
                </div>
              )}
              {/* backward compat: old status field */}
              {!(p.issue || p.cause || p.outlook) && (p as any).status && (
                <p className="non-china-status">{(p as any).status}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 품목 카드 ────────────────────────────────────────────────────────────────

function FerroItemCard({
  name, abbr, item, accent,
}: {
  name: string; abbr: string; item: FerroItem; accent: string;
}) {
  return (
    <SectionCard title={`${name} (${abbr})`} accent={accent}>
      <FerroPrice item={item} />

      {/* 공급 / 수요 원인 */}
      <div className="ferro-section-block">
        <div className="cause-block">
          <div className="cause-row">
            <span className="cause-label cause-supply">공급</span>
            <span className="key-issue-text">{item.supply_cause}</span>
          </div>
          <div className="cause-row">
            <span className="cause-label cause-demand">수요</span>
            <span className="key-issue-text">{item.demand_cause}</span>
          </div>
        </div>
      </div>

      {/* 철강 업황 시그널 */}
      <div className="ferro-section-block ferro-signal-block">
        <div className="ferro-signal-header">
          <span className="ferro-signal-title">철강 업황 시그널</span>
          <SteelSignalBadge signal={item.steel_signal} />
        </div>
        <p className="key-issue-text">{item.steel_signal_reason}</p>
      </div>

      {/* 비중국 주요 생산지 동향 */}
      {item.non_china_producers && item.non_china_producers.length > 0 && (
        <div className="ferro-section-block">
          <NonChinaProducers producers={item.non_china_producers} />
        </div>
      )}

      {/* 시장 현황 종합 */}
      {item.context && (
        <div className="ferro-section-block">
          <div className="outlook-box">
            <span className="outlook-label">시장 현황</span>
            <p className="key-issue-text">{item.context}</p>
          </div>
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
      <div className="price-hero">
        <div className="ferro-top-grid">
          <TopCard abbr="FeSi" name="페로실리콘" item={fesi} />
          <TopCard abbr="FeMn" name="페로망간"   item={femn} />
          <TopCard abbr="SiMn" name="실리콘망간" item={simn} />
        </div>
        {rateLabel && <div className="ferro-exrate-note">{rateLabel}</div>}
      </div>

      <KeyIssuesSection issues={(data as any).key_issues ?? []} />

      <FerroItemCard name="페로실리콘" abbr="FeSi" item={fesi} accent="FeSi" />
      <FerroItemCard name="페로망간"   abbr="FeMn" item={femn} accent="FeMn" />
      <FerroItemCard name="실리망간"   abbr="SiMn" item={simn} accent="SiMn" />

      <SectionCard title="합금철 시장 종합" accent="SUM">
        <TextBlock text={market_summary} />
      </SectionCard>
    </div>
  );
}
