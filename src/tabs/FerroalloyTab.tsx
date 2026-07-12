// 합금철 탭 메인 — 제품별 서브탭(FeSi·FeMn·SiMn)으로 분리. 부품은 ferro/ 폴더.
// 국내 RSS 동향·거시 종합은 제품 귀속이 불가(데이터에 제품 태그 없음)해 표시 제외 — 각 제품 화면만.
import { useState } from 'react';
import type { FerroalloyData, FerroItem } from '../types';
import { SectionCard } from '../components/ui';
import { KeyIssuesSection } from '../components/KeyIssues';
import { SteelSignalBadge } from './ferro/shared';
import { TopCard } from './ferro/TopCard';
import { FerroPrice, FobNote } from './ferro/PriceHeader';
import { FesiExtra, FemnExtra, SimnExtra, NonChinaProducers } from './ferro/Sections';

type Sub = 'fesi' | 'femn' | 'simn';
const PRODUCTS: { id: Sub; name: string; abbr: string }[] = [
  { id: 'fesi', name: '페로실리콘', abbr: 'FeSi' },
  { id: 'femn', name: '페로망간',   abbr: 'FeMn' },
  { id: 'simn', name: '실리망간',   abbr: 'SiMn' },
];

function FerroItemCard({
  name, abbr, item, rate,
}: {
  name: string; abbr: string; item: FerroItem | null; rate?: number | null;
}) {
  if (!item) return null;
  return (
    <SectionCard title={`${name} (${abbr})`}>
      <FerroPrice item={item} abbr={abbr} />
      <FobNote item={item} />

      {/* 제품별 고유 정보 */}
      {abbr === 'FeSi' && <FesiExtra item={item} rate={rate} />}
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
  const [sub, setSub] = useState<Sub>('fesi');
  const { exchange_rate_cny_usd, exchange_rate_date } = data;

  const rateLabel = exchange_rate_cny_usd
    ? `${exchange_rate_date ? exchange_rate_date + ' ' : ''}매매기준율: 1 CNY = ${exchange_rate_cny_usd.toFixed(4)} USD`
    : null;

  return (
    <div className="ferro-root tab-layout">
      <div className="tab-main">
        <div className="subtab-bar" role="tablist">
          {PRODUCTS.map(p => (
            <button
              key={p.id}
              role="tab"
              className={`subtab ${sub === p.id ? 'active' : ''}`}
              onClick={() => setSub(p.id)}
            >
              {p.name}
              <span className="subtab-sub">{p.abbr}</span>
            </button>
          ))}
        </div>

        {/* 3품목 상시 렌더 — CSS로 활성 1품목만 노출. 히어로는 레일과 이중 렌더(rail-dup) */}
        <div className="ferro-compare">
          {PRODUCTS.map(p => {
            const item = data[p.id] as FerroItem | null;
            return (
              <section key={p.id} className={`ferro-product ${sub === p.id ? 'is-active' : ''}`}>
                <div className="price-hero rail-dup">
                  <TopCard abbr={p.abbr} name={p.name} item={item} history={data._price_history} />
                  {rateLabel && <div className="ferro-exrate-note">{rateLabel}</div>}
                </div>
                <div className="ferro-ki">
                  <KeyIssuesSection issues={(item as any)?.key_issues ?? []} />
                </div>
                <FerroItemCard name={p.name} abbr={p.abbr} item={item} rate={exchange_rate_cny_usd} />
              </section>
            );
          })}
        </div>
      </div>

      <aside className="tab-rail">
        {PRODUCTS.map(p => (
          <TopCard key={p.id} abbr={p.abbr} name={p.name}
            item={data[p.id] as FerroItem | null} history={data._price_history} />
        ))}
        {rateLabel && <div className="ferro-exrate-note">{rateLabel}</div>}
      </aside>
    </div>
  );
}
