import type { RecarburizerData } from '../types';
import { hasText } from '../utils/format';
import { SectionCard, TextBlock } from '../components/ui';
import { KeyIssuesSection } from '../components/KeyIssues';

export function RecarburizerTab({ data }: { data: RecarburizerData }) {
  const d = data as any;
  const cp    = d.china_price      ?? {};
  const rp    = d.russia_price     ?? {};
  const gm    = d.global_market    ?? {};
  const cprod = d.china_production ?? {};
  const rprod = d.russia_production ?? {};
  const af    = d.asia_flows;
  const market_summary: string = d.market_summary ?? '';

  const flowAvailable: boolean = Array.isArray(af) ? af.length > 0 : (af?.available ?? false);
  const flowList: any[] = Array.isArray(af) ? af : (af?.flows ?? []);

  const chinaDown  = cp.change && String(cp.change).startsWith('-');
  const russiaDown = rp.change && String(rp.change).startsWith('-');
  const russiaHint = hasText(rp.vs_china) ? rp.vs_china : null;

  const hasChinaProd = hasText(cprod.production_status) || hasText(cprod.cbam_carbon)
    || hasText(cprod.policy) || hasText(cprod.outlook)
    || cprod.annual_output || cprod.annual_consumption || cprod.export_volume;
  const hasRussiaProd = hasText(rprod.production_status) || hasText(rprod.sanctions_impact)
    || hasText(rprod.war_impact) || hasText(rprod.outlook)
    || rprod.annual_output || rprod.export_volume || hasText(rprod.main_importers);

  return (
    <div className="tab-content">
      <div className="recab-price-grid">
        <div className="recab-price-box">
          <div className="recab-price-box-country">🇨🇳 중국 무연탄</div>
          <div className="recab-price-box-main">
            {cp.fob_qinhuangdao
              ? <><span className="recab-price-val">USD {cp.fob_qinhuangdao}/MT</span></>
              : cp.domestic_shanxi
                ? <><span className="recab-price-val">{cp.domestic_shanxi}</span><span className="recab-price-unit"> CNY/MT</span></>
                : hasText(cp.price_range_text)
                  ? <span className="recab-price-val">{cp.price_range_text}</span>
                  : <span className="recab-price-na">—</span>
            }
          </div>
          {!cp.fob_qinhuangdao && !cp.domestic_shanxi && hasText(cp.price_range_source) && (
            <div className="recab-price-ref">({cp.price_range_source})</div>
          )}
          {!cp.fob_qinhuangdao && !cp.domestic_shanxi && hasText(cp.price_range_note) && (
            <div className="recab-price-note">※ {cp.price_range_note}</div>
          )}
          {cp.change && (
            <div className="recab-price-change" style={{ color: chinaDown ? 'var(--down)' : 'var(--up)' }}>
              {cp.change}
            </div>
          )}
          <div className="recab-price-tags">
            {cp.fob_qinhuangdao && <span className="recab-tag">FOB 친황다오</span>}
            {cp.cif_korea && <span className="recab-tag">CIF 한국 {cp.cif_korea}</span>}
            {cp.date && <span className="recab-tag-date">{cp.date}</span>}
          </div>
        </div>

        <div className="recab-price-box recab-price-box--russia">
          <div className="recab-price-box-country">🇷🇺 러시아 안트라사이트</div>
          <div className="recab-price-box-main">
            {rp.fob_murmansk
              ? <><span className="recab-price-val">USD {rp.fob_murmansk}/MT</span></>
              : hasText(rp.price_range_text)
                ? <span className="recab-price-val">{rp.price_range_text}</span>
                : <span className="recab-price-na">—</span>
            }
          </div>
          {!rp.fob_murmansk && hasText(rp.price_range_source) && (
            <div className="recab-price-ref recab-price-ref--russia">({rp.price_range_source})</div>
          )}
          {!rp.fob_murmansk && hasText(rp.price_range_note) && (
            <div className="recab-price-note recab-price-note--russia">※ {rp.price_range_note}</div>
          )}
          {!rp.fob_murmansk && !hasText(rp.price_range_text) && russiaHint && (
            <div className="recab-price-ref recab-price-ref--russia">{russiaHint}</div>
          )}
          {rp.change && (
            <div className="recab-price-change" style={{ color: russiaDown ? 'var(--down)' : 'var(--up)' }}>
              {rp.change}
            </div>
          )}
          <div className="recab-price-tags">
            {rp.fob_murmansk && <span className="recab-tag">FOB 무르만스크</span>}
            {rp.cif_korea && <span className="recab-tag">CIF 한국 {rp.cif_korea}</span>}
            {rp.date && <span className="recab-tag-date">{rp.date}</span>}
          </div>
        </div>
      </div>

      <KeyIssuesSection issues={d.key_issues ?? []} />

      {(hasText(gm.headline) || hasText(gm.current_level) || hasText(gm.key_drivers)) && (
        <SectionCard title="전세계 시장 상황" accent="MKT">
          {hasText(gm.headline) && <div className="recab-headline-box"><span className="recab-headline-text">{gm.headline}</span></div>}
          {hasText(gm.current_level) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">현재 가격 수준</span><TextBlock text={gm.current_level} /></div>}
          {hasText(gm.key_drivers) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">주요 가격 동인</span><TextBlock text={gm.key_drivers} /></div>}
          {hasText(gm.outlook) && <div className="outlook-box"><span className="outlook-label">단기 전망</span><p className="outlook-text">{gm.outlook}</p></div>}
        </SectionCard>
      )}

      {hasChinaProd && (
        <SectionCard title="중국 생산 현황" accent="CHN">
          {hasText(cprod.production_status) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">생산·채굴 현황</span><TextBlock text={cprod.production_status} /></div>}
          {hasText(cprod.cbam_carbon) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">CBAM · 탄소배출권</span><TextBlock text={cprod.cbam_carbon} /></div>}
          {hasText(cprod.policy) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">주요 정책</span><TextBlock text={cprod.policy} /></div>}
          {hasText(cprod.outlook) && <div className="outlook-box"><span className="outlook-label">생산·수출 전망</span><p className="outlook-text">{cprod.outlook}</p></div>}
        </SectionCard>
      )}

      {hasRussiaProd && (
        <SectionCard title="러시아 생산 현황" accent="RUS">
          {hasText(rprod.main_importers) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">주요 수입국</span><div className="country-price-tag">{rprod.main_importers}</div></div>}
          {hasText(rprod.production_status) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">생산·채굴 현황</span><TextBlock text={rprod.production_status} /></div>}
          {hasText(rprod.war_impact) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">전쟁 영향</span><TextBlock text={rprod.war_impact} /></div>}
          {hasText(rprod.sanctions_impact) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">제재 및 수출 루트</span><TextBlock text={rprod.sanctions_impact} /></div>}
          {hasText(rprod.outlook) && <div className="outlook-box"><span className="outlook-label">생산·수출 전망</span><p className="outlook-text">{rprod.outlook}</p></div>}
        </SectionCard>
      )}

      {flowAvailable && flowList.length > 0 && (
        <SectionCard title="아시아 물동량 흐름" accent="FLOW">
          <div className="flow-table">
            <div className="flow-table-header">
              <span>수입국</span><span>주요 공급국</span><span>물량 추이</span><span>단가 동향</span>
            </div>
            {flowList.map((f: any) => (
              <div key={f.importer} className="flow-table-row">
                <span className="flow-importer">{f.importer}</span>
                <span>{f.main_sources}</span>
                <span>{f.volume_trend}</span>
                <span>{f.price_trend}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {hasText(market_summary) && (
        <SectionCard title="시장 종합 의견" accent="SUM">
          <TextBlock text={market_summary} />
        </SectionCard>
      )}
    </div>
  );
}
