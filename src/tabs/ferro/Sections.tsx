// 합금철 품목별 섹션 — 제품 고유 정보·비중국 생산국·시장 종합
import type { FerroItem, FerroProducer } from '../../types';
import { TextBlock } from '../../components/ui';
import { IssueRow } from '../../components/KeyIssues';
import { formatInt } from '../../utils/format';

// ─── FeSi 전용 — HBIS 입찰가 + 중국 생산 동향 ───────────────────────────────

export function FesiExtra({ item }: { item: FerroItem }) {
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
                  CNY {formatInt(item.hbis_bid_price)}/MT
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
                <span className="key-issue-text">CNY {formatInt(item.ningxia_spot)}/MT</span>
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

// ─── FeMn 전용 — 망간광석 원가 + 국내 공급 ──────────────────────────────────

export function FemnExtra({ item }: { item: FerroItem }) {
  const hasOre    = item.mn_ore_cif_korea != null;
  const hasSpread = !!item.ore_to_femn_spread;
  const hasKorea  = !!item.korea_supply;

  if (!hasOre && !hasSpread && !hasKorea) return null;
  return (
    <>
      {(hasOre || hasSpread) && (
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
      )}
      {hasKorea && (
        <div className="ferro-section-block">
          <div className="outlook-box">
            <span className="outlook-label">국내 공급 동향</span>
            <p className="key-issue-text">{item.korea_supply}</p>
          </div>
        </div>
      )}
    </>
  );
}

// ─── SiMn 전용 — 과잉공급 + 원가 구조 ───────────────────────────────────────

export function SimnExtra({ item }: { item: FerroItem }) {
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

// ─── 비중국 생산국 (뉴스/이슈 중심) ──────────────────────────────────────────

export function NonChinaProducers({ producers }: { producers: FerroProducer[] }) {
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
              <IssueRow label="이슈" cls="ki-what"    text={p.issue} />
              <IssueRow label="원인" cls="ki-why"     text={p.cause} />
              <IssueRow label="전망" cls="ki-outlook" text={p.outlook} />
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
  { key: 'intl_context',      label: '국제 정세',   labelCls: 'ki-outlook'},
  { key: 'non_china_summary', label: '비중국 생산', labelCls: 'ki-what'   },
  { key: 'outlook',           label: '단기 전망',   labelCls: 'ki-outlook'},
];

export function MarketSummary({ summary }: { summary: MarketSummaryData }) {
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
