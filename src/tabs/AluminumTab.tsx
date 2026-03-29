import type { AluminumData } from '../types';
import { formatNum, isValidLmePrice } from '../utils/format';
import { SectionCard, TextBlock } from '../components/ui';
import { KeyIssuesSection } from '../components/KeyIssues';

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
            : <span className="price-hero-na">가격 확인 중</span>
          }
          {lme.change && priceValid && (
            <span className="price-hero-change" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
              전일 대비 {isUp ? '+' : ''}{formatNum(lme.change)} USD/MT
              {lme.change_pct ? ` (${lme.change_pct})` : ''}
            </span>
          )}
        </div>
        {lme.date && (
          <span className="price-hero-date">
            기준: {lme.date}
            {(lme as any).holiday_note && (
              <span className="price-hero-holiday">
                {' · '}{(lme as any).holiday_note}
              </span>
            )}
          </span>
        )}
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
        <div className="region-list">
          {scrap.regions.map((r) => (
            <div key={r.region} className="region-item">
              <div className="region-title-row">
                <span className="region-name">{r.region}</span>
              </div>
              {r.price_range && r.price_range !== 'null' && (
                <div className="region-price-row">{r.price_range}</div>
              )}
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
