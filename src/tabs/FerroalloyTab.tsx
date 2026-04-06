import type { FerroalloyData, FerroItem, FerroProducer, SteelSignal, Direction } from '../types';
import { SectionCard, TextBlock } from '../components/ui';
import { KeyIssuesSection } from '../components/KeyIssues';

// ─── 합금철 시장 종합 ─────────────────────────────────────────────────────────

type MarketSummaryData = {
  fesi?: string;
  femn?: string;
  simn?: string;
  intl_context?: string;
  non_china_summary?: string;
  outlook?: string;
} | string | null | undefined;

const SUMMARY_ROWS: Array<{ key: string; label: string; labelCls: string }> = [
  { key: 'intl_context',      label: '국제 정세',        labelCls: 'ki-outlook'},
  { key: 'non_china_summary', label: '비중국 생산',      labelCls: 'ki-what'   },
  { key: 'outlook',           label: '단기 전망',        labelCls: 'ki-outlook'},
];

function MarketSummary({ summary }: { summary: MarketSummaryData }) {
  if (!summary) return null;

  // 구형 캐시: 문자열로 왔을 때
  if (typeof summary === 'string') {
    return <TextBlock text={summary} />;
  }

  const obj = summary as Record<string, string>;
  return (
    <div className="market-summary-list">
      {SUMMARY_ROWS.map(({ key, label, labelCls }) =>
        obj[key] ? (
          <div key={key} className="maker-info-row">
            <span className={`maker-info-label ${labelCls} summary-label-fixed`}>{label}</span>
            <span className="maker-info-text">{obj[key]}</span>
          </div>
        ) : null
      )}
    </div>
  );
}

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

const FERRO_FALLBACK_RANGE: Record<string, string> = {
  FeSi: 'CNY 5,500~7,000',
  FeMn: 'CNY 6,500~8,500',
  SiMn: 'CNY 4,800~6,500',
};

function TopCard({ abbr, name, item }: { abbr: string; name: string; item: FerroItem }) {
  const changeColor = item.change_cny
    ? (String(item.change_cny).startsWith('-') ? 'var(--down)' : 'var(--up)')
    : 'var(--text3)';

  return (
    <div className="ferro-top-card">
      <div className="ferro-top-name">{name} ({abbr})</div>
      <div className="ferro-top-price-row">
        {item.price_usd ? (
          <span className="ferro-top-usd">USD {item.price_usd}</span>
        ) : item.price_cny ? (
          <span className="ferro-top-usd">CNY {fmtCny(item.price_cny)}</span>
        ) : (
          <span className="ferro-top-usd">{FERRO_FALLBACK_RANGE[abbr] ?? '—'}</span>
        )}
        {dirArrow(item.direction)}
      </div>
      {item.price_cny && item.price_usd && (
        <div className="ferro-top-cny">
          CNY {fmtCny(item.price_cny)}/MT <span className="ferro-top-domestic">중국 내수가</span>
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

function FerroPrice({ item, abbr }: { item: FerroItem; abbr: string }) {
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
              (CNY {fmtCny(item.price_cny)}/MT, 중국 내수가)
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
          <span className="ferro-price-main ferro-price-cny-only">
            {FERRO_FALLBACK_RANGE[abbr] ?? '—'}<small>/MT</small>
          </span>
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

// ─── FeSi 전용 — HBIS 입찰가 + 중국 생산 동향 ───────────────────────────────

function FesiExtra({ item }: { item: FerroItem }) {
  const hasBid  = item.hbis_bid_price != null;
  const hasNingxia = item.ningxia_spot != null;
  const hasProd = !!item.china_production_status;

  if (!hasBid && !hasNingxia && !hasProd) return null;
  return (
    <>
      {(hasBid || hasNingxia) && (
        <div className="ferro-section-block">
          <div className="cause-block">
            {hasBid && (
              <div className="cause-row">
                <span className="cause-label cause-supply">HBIS 입찰</span>
                <span className="key-issue-text">
                  CNY {fmtCny(item.hbis_bid_price)}/MT
                  {item.hbis_bid_month && <span className="ferro-cny-ref"> ({item.hbis_bid_month})</span>}
                  {item.hbis_bid_change && (
                    <span style={{ marginLeft: 6, color: String(item.hbis_bid_change).startsWith('-') ? 'var(--down)' : 'var(--up)', fontFamily: 'var(--mono)', fontSize: 10 }}>
                      전월比 {item.hbis_bid_change} CNY
                    </span>
                  )}
                </span>
              </div>
            )}
            {hasNingxia && (
              <div className="cause-row">
                <span className="cause-label cause-demand">닝샤 현물</span>
                <span className="key-issue-text">CNY {fmtCny(item.ningxia_spot)}/MT</span>
              </div>
            )}
          </div>
        </div>
      )}
      {hasProd && (
        <div className="ferro-section-block">
          <div className="outlook-box">
            <span className="outlook-label">중국 생산 동향</span>
            <p className="key-issue-text">{item.china_production_status}</p>
          </div>
        </div>
      )}
    </>
  );
}

// ─── FeMn 전용 — 망간광석 원가 ───────────────────────────────────────────────

function FemnExtra({ item }: { item: FerroItem }) {
  const hasOre    = item.mn_ore_cif_korea != null;
  const hasSpread = !!item.ore_to_femn_spread;

  if (!hasOre && !hasSpread) return null;
  return (
    <div className="ferro-section-block">
      <div className="cause-block">
        {hasOre && (
          <div className="cause-row">
            <span className="cause-label cause-supply">망간광석</span>
            <span className="key-issue-text">CIF 한국 USD {item.mn_ore_cif_korea}/MT</span>
          </div>
        )}
        {hasSpread && (
          <div className="cause-row">
            <span className="cause-label cause-demand">마진</span>
            <span className="key-issue-text">{item.ore_to_femn_spread}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SiMn 전용 — 과잉공급 + 원가 구조 ───────────────────────────────────────

function SimnExtra({ item }: { item: FerroItem }) {
  const hasOvc  = !!item.china_overcapacity_note;
  const hasCost = !!item.dual_input_cost;

  if (!hasOvc && !hasCost) return null;
  return (
    <div className="ferro-section-block">
      <div className="cause-block">
        {hasOvc && (
          <div className="cause-row">
            <span className="cause-label cause-supply">공급구조</span>
            <span className="key-issue-text">{item.china_overcapacity_note}</span>
          </div>
        )}
        {hasCost && (
          <div className="cause-row">
            <span className="cause-label cause-demand">원가</span>
            <span className="key-issue-text">{item.dual_input_cost}</span>
          </div>
        )}
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
      <FerroPrice item={item} abbr={abbr} />

      {/* 제품별 고유 정보 */}
      {abbr === 'FeSi' && <FesiExtra item={item} />}
      {abbr === 'FeMn' && <FemnExtra item={item} />}
      {abbr === 'SiMn' && <SimnExtra item={item} />}

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
  const { fesi, femn, simn, market_summary, exchange_rate_cny_usd, exchange_rate_date } = data;

  const rateLabel = exchange_rate_cny_usd
    ? `${exchange_rate_date ? exchange_rate_date + ' ' : ''}매매기준율: 1 CNY = ${exchange_rate_cny_usd.toFixed(4)} USD`
    : null;

  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="ferro-top-grid">
          <TopCard abbr="FeSi" name="페로실리콘" item={fesi} />
          <TopCard abbr="FeMn" name="페로망간"   item={femn} />
          <TopCard abbr="SiMn" name="실리망간" item={simn} />
        </div>
        {rateLabel && <div className="ferro-exrate-note">{rateLabel}</div>}
      </div>

      <KeyIssuesSection issues={(data as any).key_issues ?? []} />

      <FerroItemCard name="페로실리콘" abbr="FeSi" item={fesi} accent="FeSi" />
      <FerroItemCard name="페로망간"   abbr="FeMn" item={femn} accent="FeMn" />
      <FerroItemCard name="실리망간"   abbr="SiMn" item={simn} accent="SiMn" />

      <SectionCard title="합금철 시장 종합" accent="SUM">
        <MarketSummary summary={market_summary} />
      </SectionCard>
    </div>
  );
}
