// 합금철 탭 메인 — 부품은 ferro/ 폴더 (shared·TopCard·PriceHeader·Sections)
import type { FerroalloyData, FerroItem } from '../types';
import { SectionCard } from '../components/ui';
import { KrNewsList } from '../components/data-viz';
import { KeyIssuesSection } from '../components/KeyIssues';
import { SteelSignalBadge } from './ferro/shared';
import { TopCard } from './ferro/TopCard';
import { FerroPrice, FobNote } from './ferro/PriceHeader';
import { FesiExtra, FemnExtra, SimnExtra, NonChinaProducers, MarketSummary } from './ferro/Sections';

function FerroItemCard({
  name, abbr, item,
}: {
  name: string; abbr: string; item: FerroItem | null;
}) {
  if (!item) return null;
  return (
    <SectionCard title={`${name} (${abbr})`}>
      <FerroPrice item={item} abbr={abbr} />
      <FobNote item={item} />

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

export function FerroalloyTab({ data }: { data: FerroalloyData }) {
  const { fesi, femn, simn, market_summary, exchange_rate_cny_usd, exchange_rate_date } = data;

  const rateLabel = exchange_rate_cny_usd
    ? `${exchange_rate_date ? exchange_rate_date + ' ' : ''}매매기준율: 1 CNY = ${exchange_rate_cny_usd.toFixed(4)} USD`
    : null;

  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="ferro-top-grid">
          <TopCard abbr="FeSi" name="페로실리콘" item={fesi} history={data._price_history} />
          <TopCard abbr="FeMn" name="페로망간"   item={femn} history={data._price_history} />
          <TopCard abbr="SiMn" name="실리망간" item={simn} history={data._price_history} />
        </div>
        {rateLabel && <div className="ferro-exrate-note">{rateLabel}</div>}
      </div>

      <KrNewsList items={data._kr_news} title="국내 합금철 동향 (전문지 1차 보도)" />

      <KeyIssuesSection issues={(data as any).key_issues ?? []} />

      <FerroItemCard name="페로실리콘" abbr="FeSi" item={fesi} />
      <FerroItemCard name="페로망간"   abbr="FeMn" item={femn} />
      <FerroItemCard name="실리망간"   abbr="SiMn" item={simn} />

      <SectionCard title="합금철 시장 종합">
        <MarketSummary summary={market_summary} />
      </SectionCard>
    </div>
  );
}
