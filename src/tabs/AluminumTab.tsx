import type { AluminumData } from '../types';
import { formatNum, isValidLmePrice } from '../utils/format';
import { SectionCard, TextBlock } from '../components/ui';
import { PriceMeta, SourceChip, Sparkline } from '../components/data-viz';
import { KeyIssuesSection } from '../components/KeyIssues';

// 스크랩 가격 — 한 줄에 한 품목, 품목명/단가 컬럼 정렬.
// price_items(서버 직접 수집값)가 우선, 없으면 구형 price_range 문자열을 분해해 표시.
function ScrapPriceLines({ items, fallback }: {
  items?: Array<{ grade: string; price: string }> | null;
  fallback?: string | null;
}) {
  let rows: Array<{ grade: string; price: string }> = [];
  if (Array.isArray(items) && items.length > 0) {
    rows = items.filter(it => it?.grade && it?.price);
  } else if (fallback && fallback !== 'null') {
    rows = String(fallback)
      .split(/,\s+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(seg => {
        const m = seg.match(/^(.+?)\s+((?:US)?\$|CNY|JPY|¥|약\s|[\d,]+)(.*)$/);
        return m
          ? { grade: m[1], price: `${m[2]}${m[3]}` }
          : { grade: seg, price: '' };
      });
  }
  if (rows.length === 0) return null;
  return (
    <div className="region-price-table">
      {rows.map((r, i) => (
        <div key={i} className="region-price-line">
          <span className="region-price-grade">{r.grade}</span>
          <span className="region-price-value">{r.price}</span>
        </div>
      ))}
    </div>
  );
}

export function AluminumTab({ data }: { data: AluminumData }) {
  const { lme, scrap } = data;
  const isUp = lme.change != null && !String(lme.change).startsWith('-');
  const priceValid = isValidLmePrice(lme.price);

  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="price-hero-main">
          <span className="price-hero-label">LME 알루미늄 공식가</span>
          {priceValid
            ? <span className="price-hero-value">{formatNum(lme.price)} <small>USD/MT</small></span>
            : <span className="price-hero-value">2,000~2,800 <small>USD/MT</small></span>
          }
          {lme.change && priceValid && (
            <span className="price-hero-change" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
              전일 대비 {isUp ? '+' : ''}{formatNum(lme.change)} USD/MT
              {lme.change_pct ? ` (${lme.change_pct})` : ''}
            </span>
          )}
        </div>
        {(lme.date || lme.carried_over) && (
          <span className="price-hero-date">
            {lme.date && <>기준: {lme.date}</>}
            {(lme as any).holiday_note && (
              <span className="price-hero-holiday">
                {' · '}{(lme as any).holiday_note}
              </span>
            )}
            {' '}
            {priceValid && lme.source === 'westmetall' && <SourceChip label="LME 공식" />}
            <PriceMeta carriedOver={lme.carried_over} />
          </span>
        )}
        <Sparkline history={data._price_history} valueKey="lme" width={120} height={26} />
      </div>

      <KeyIssuesSection issues={(lme as any).key_issues ?? []} />

      <SectionCard title="가격 변동 이유" accent="WHY">
        <TextBlock text={lme.move_reason} />
      </SectionCard>
      <SectionCard title="시장 현황" accent="NOW">
        <TextBlock text={lme.market_status} />
      </SectionCard>
      <SectionCard title="가격 전망" accent="NEXT">
        <TextBlock text={lme.outlook} />
      </SectionCard>

      <SectionCard title="알루미늄 스크랩 주간 시황" accent="SCRAP">
        <TextBlock text={scrap.weekly_summary} />
        {(scrap.us_premium || scrap.eu_premium || scrap.japan_premium) && (
          <div className="premium-row">
            <span className="premium-label">P1020A 프리미엄</span>
            <div className="premium-values">
              {scrap.us_premium && <span><em>미국</em> {scrap.us_premium}</span>}
              {scrap.eu_premium && <span><em>유럽</em> {scrap.eu_premium}</span>}
              {scrap.japan_premium && <span><em>일본</em> {scrap.japan_premium}</span>}
            </div>
          </div>
        )}
        <div className="region-basis-note">※ 아래 가격은 각 대륙별 내수 거래가 기준 — 한국 수입 단가 아님</div>
        <div className="region-list">
          {scrap.regions.map((r) => (
            <div key={r.region} className="region-item">
              <div className="region-title-row">
                <span className="region-name">{r.region} 내수가</span>
              </div>
              <ScrapPriceLines items={r.price_items} fallback={r.price_range} />
              {r.key_grades && <div className="region-grades-line">{r.key_grades}</div>}
              {r.price_driver && <p className="region-driver">{r.price_driver}</p>}
              {r.flow && <p className="region-flow-text">📦 {r.flow}</p>}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
