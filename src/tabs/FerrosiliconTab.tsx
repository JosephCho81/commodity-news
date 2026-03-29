import type { FerrosiliconData } from '../types';
import { SectionCard, TextBlock } from '../components/ui';
import { KeyIssuesSection } from '../components/KeyIssues';

export function FerrosiliconTab({ data }: { data: FerrosiliconData }) {
  const { china_price, china_production, non_china, market_summary, non_china_context, korea_import } = data as any;

  const hbisBidRaw = china_price.hbis_bid_price ?? null;
  const hbisBid = hbisBidRaw && !String(hbisBidRaw).includes('미확인') ? hbisBidRaw : null;
  const hbisMonth = china_price.hbis_bid_month ?? null;
  const hbisChange = china_price.hbis_bid_change ?? null;
  const hbisChangeDown = hbisChange && String(hbisChange).startsWith('-');

  const m = china_price.fob_tianjin_monthly as any;
  const isValid = (v: any) => v && !String(v).includes('미확인') && !String(v).includes('검색');
  const validEntries = Object.entries(m || {}).filter(([, v]) => isValid(v)).sort(([a], [b]) => b.localeCompare(a));
  const fobLatestVal = validEntries[0]?.[1] as string ?? null;
  const numMatch = fobLatestVal ? fobLatestVal.match(/([\d,]+~[\d,]+)/) : null;
  const fobRange = numMatch ? numMatch[1] : null;

  const ctxFobMatch = china_price.china_context
    ? String(china_price.china_context).match(/USD\s*([\d,]+[~\-][\d,]+)/)
    : null;
  const ctxFobRange = ctxFobMatch ? ctxFobMatch[1] : null;

  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="price-hero-main">
          {hbisBid ? (
            <>
              <span className="price-hero-label">HBIS GROUP 페로실리콘 입찰가</span>
              {(() => {
                const raw = String(hbisBid);
                const usdMatch = raw.match(/USD\s*[약]?\s*([\d,]+)/i);
                const cnyMatch = raw.match(/(?:CNY|Yuan)\s*([\d,]+)/i);
                const usd = usdMatch ? Number(usdMatch[1].replace(/,/g, '')).toLocaleString() : null;
                const cny = cnyMatch ? Number(cnyMatch[1].replace(/,/g, '')).toLocaleString() : null;
                if (usd || cny) {
                  return (
                    <span className="price-hero-value" style={{ fontSize: 20 }}>
                      {usd && `USD ${usd}/MT`}
                      {usd && cny && <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400 }}> (CNY {cny}/MT · 중국 내수가)</span>}
                      {!usd && cny && `CNY ${cny}/MT`}
                    </span>
                  );
                }
                return <span className="price-hero-value" style={{ fontSize: 16 }}>{raw}</span>;
              })()}
              {hbisChange && (
                <span className="price-hero-change" style={{ color: hbisChangeDown ? 'var(--down)' : 'var(--up)' }}>
                  {String(hbisChange).replace(/Yuan/g, 'CNY').replace(/\/톤/g, '/MT')}
                </span>
              )}
              <span className="fsi-hbis-note">※ HBIS Group(중국 2위 철강사) 월별 공식 입찰가 기준</span>
            </>
          ) : fobRange ? (
            <>
              <span className="price-hero-label">페로실리콘 75 FOB 천진항</span>
              <span className="price-hero-value">{fobRange} <small>USD/MT</small></span>
            </>
          ) : ctxFobRange ? (
            <>
              <span className="price-hero-label">페로실리콘 75 FOB 천진항</span>
              <span className="price-hero-value">{ctxFobRange} <small>USD/MT</small></span>
            </>
          ) : (
            <>
              <span className="price-hero-label">페로실리콘 75</span>
              <span className="price-hero-na">가격 확인 중</span>
            </>
          )}
        </div>
        {hbisMonth && (() => {
          const parts = String(hbisMonth).split('-');
          const yr = parts[0] ? parts[0].slice(2) + '년' : '';
          const mo = parts[1] ? parseInt(parts[1]) + '월' : '';
          return <span className="price-hero-date">기준: {yr} {mo}</span>;
        })()}
      </div>

      <KeyIssuesSection issues={(data as any).key_issues ?? []} />

      <SectionCard title="중국 시장 현황 및 전망" accent="CTX">
        {china_price.china_context && <TextBlock text={china_price.china_context} />}
        {china_price.china_outlook && (
          <div className="outlook-box">
            <span className="outlook-label">단기 전망</span>
            <p className="outlook-text">{china_price.china_outlook}</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="중국 생산 현황" accent="PROD">
        <TextBlock text={china_production.overall} />
      </SectionCard>

      <SectionCard title="비중국 생산국 동향" accent="INTL">
        {non_china_context && <div className="non-china-summary"><TextBlock text={non_china_context} /></div>}
        {non_china.map((c: any) => (
          <div key={c.country} className="country-row">
            <span className="country-name">{c.country}</span>
            {c.producer && <span className="country-producer">{c.producer}</span>}
            <p className="country-status">{c.status}</p>
            {c.price_context && (
              <div className="country-price-tag">💲 {c.price_context}</div>
            )}
            <div className="country-flow-tag">→ {c.export_direction}</div>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="시장 종합 및 전망" accent="SUM">
        <TextBlock text={market_summary} />
      </SectionCard>
    </div>
  );
}
