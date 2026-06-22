import type { RecarburizerData, RecarburizerForm } from '../types';
import { hasText } from '../utils/format';
import { SectionCard, TextBlock } from '../components/ui';
import { PriceMeta, FuturesStrip, DeltaPill } from '../components/data-viz';
import { KeyIssuesSection } from '../components/KeyIssues';

// 방향 → 톤(색): 상방=상승빨강, 하방=하락파랑, 보합=중립 (CI 규칙)
function directionTone(dir?: string | null): 'up' | 'down' | 'flat' {
  const d = String(dir ?? '');
  if (d.includes('상')) return 'up';
  if (d.includes('하')) return 'down';
  return 'flat';
}

// 형태별 시황 카드 — 방향 배지 + 다각도 3~5문장. commentary 없으면 렌더 안 함(NULL 원칙).
function FormCard({ form }: { form?: RecarburizerForm }) {
  if (!form || !hasText(form.commentary)) return null;
  const tone = directionTone(form.direction);
  return (
    <div className="recab-form-card">
      <div className="recab-form-head">
        <span className="recab-form-label">{form.label}</span>
        {hasText(form.spec) && <span className="recab-form-spec">{form.spec}</span>}
        {hasText(form.direction) && (
          <span className={`recab-form-dir recab-form-dir--${tone}`}>{form.direction}</span>
        )}
      </div>
      <p className="recab-form-commentary">{form.commentary}</p>
    </div>
  );
}

function FormsSection({ forms }: { forms?: RecarburizerData['forms'] }) {
  if (!forms) return null;
  const hasAny = hasText(forms.lump?.commentary) || hasText(forms.fines?.commentary);
  if (!hasAny) return null;
  return (
    <SectionCard title="형태별 시황 — 소괴탄 · 분탄" accent="FORM">
      <div className="recab-form-grid">
        <FormCard form={forms.lump} />
        <FormCard form={forms.fines} />
      </div>
      {hasText(forms.decouple_note) && (
        <div className="recab-form-decouple">⇄ {forms.decouple_note}</div>
      )}
    </SectionCard>
  );
}

export function RecarburizerTab({ data }: { data: RecarburizerData }) {
  const d = data as any;
  const cp    = d.china_price      ?? {};
  const rp    = d.russia_price     ?? {};
  const gm    = d.global_market    ?? {};
  const cprod = d.china_production ?? {};
  const rprod = d.russia_production ?? {};
  const af    = d.asia_flows;
  const fx    = d.fx ?? null;
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
      <FormsSection forms={d.forms} />

      <div className="recab-ref-head">해외 무연탄 시세 <span>참고 · USD</span></div>
      <div className="recab-price-grid recab-price-grid--ref">
        <div className="recab-price-box">
          <div className="recab-price-box-country">🇨🇳 중국 무연탄</div>
          <div className="recab-price-box-main">
            {cp.fob_qinhuangdao
              ? <><span className="recab-price-val">USD {cp.fob_qinhuangdao}/MT</span></>
              : cp.domestic_shanxi
                ? <><span className="recab-price-val">{cp.domestic_shanxi}</span><span className="recab-price-unit"> CNY/MT</span></>
                : hasText(cp.price_range_text)
                  ? <span className="recab-price-val">{cp.price_range_text}</span>
                  : <span className="recab-price-val">100~180 USD/MT</span>
            }
          </div>
          {!cp.fob_qinhuangdao && !cp.domestic_shanxi && hasText(cp.price_range_source) && (
            <div className="recab-price-ref">({cp.price_range_source})</div>
          )}
          {!cp.fob_qinhuangdao && !cp.domestic_shanxi && hasText(cp.price_range_note) && (
            <div className="recab-price-note">※ {cp.price_range_note}</div>
          )}
          {(cp.krw_per_mt || hasText(cp.krw_range)) && (
            <div className="recab-price-krw">
              ≈ {cp.krw_per_mt ? `${cp.krw_per_mt.toLocaleString('ko-KR')}원/MT` : cp.krw_range}
              {hasText(cp.krw_basis) && <span className="recab-price-krw-basis"> ({cp.krw_basis})</span>}
            </div>
          )}
          {cp.change && (
            <div className="recab-price-change" style={{ color: chinaDown ? 'var(--down)' : 'var(--up)' }}>
              {cp.change}
            </div>
          )}
          <div className="recab-price-tags">
            {cp.fob_qinhuangdao && <span className="recab-tag">FOB 친황다오</span>}
            {cp.cif_korea && <span className="recab-tag">CIF 한국 {cp.cif_korea}</span>}
            {(cp.as_of || cp.date) && <span className="recab-tag-date">{cp.as_of ?? cp.date} 기준</span>}
            <PriceMeta source={cp.source} carriedOver={cp.carried_over} />
          </div>
        </div>

        <div className="recab-price-box recab-price-box--russia">
          <div className="recab-price-box-country">🇷🇺 러시아 안트라사이트</div>
          <div className="recab-price-box-main">
            {rp.fob_murmansk
              ? <><span className="recab-price-val">USD {rp.fob_murmansk}/MT</span></>
              : hasText(rp.price_range_text)
                ? <span className="recab-price-val">{rp.price_range_text}</span>
                : <span className="recab-price-val">80~150 USD/MT</span>
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
          {(rp.krw_per_mt || hasText(rp.krw_range)) && (
            <div className="recab-price-krw">
              ≈ {rp.krw_per_mt ? `${rp.krw_per_mt.toLocaleString('ko-KR')}원/MT` : rp.krw_range}
              {hasText(rp.krw_basis) && <span className="recab-price-krw-basis"> ({rp.krw_basis})</span>}
            </div>
          )}
          {rp.change && (
            <div className="recab-price-change" style={{ color: russiaDown ? 'var(--down)' : 'var(--up)' }}>
              {rp.change}
            </div>
          )}
          <div className="recab-price-tags">
            {rp.fob_murmansk && <span className="recab-tag">FOB 무르만스크</span>}
            {rp.cif_korea && <span className="recab-tag">CIF 한국 {rp.cif_korea}</span>}
            {(rp.as_of || rp.date) && <span className="recab-tag-date">{rp.as_of ?? rp.date} 기준</span>}
            <PriceMeta source={rp.source} carriedOver={rp.carried_over} />
          </div>
        </div>
      </div>

      {fx && (
        <SectionCard title="환율 · 원화 원가 영향" accent="FX">
          <div className="recab-fx-head">
            <div className="recab-fx-rate">
              <span className="recab-fx-rate-label">USD/KRW</span>
              <span className="recab-fx-rate-val">{fx.rate_now.toLocaleString('ko-KR')}원</span>
              {fx.delta != null && <DeltaPill change={fx.delta} suffix="원" />}
            </div>
            {fx.delta != null && (
              <span className="recab-fx-rate-sub">
                전월 대비 {fx.delta >= 0 ? '+' : ''}{fx.delta.toLocaleString('ko-KR')}원
                {fx.delta_pct ? ` (${fx.delta_pct})` : ''} · 30일 전 {fx.rate_prev?.toLocaleString('ko-KR')}원
              </span>
            )}
          </div>
          {fx.breakdown?.line && (
            <div className="recab-fx-breakdown">
              <span className="recab-sub-label">원가 변동 요인분해{fx.breakdown.basis ? ` (${fx.breakdown.basis})` : ''}</span>
              <p className="recab-fx-breakdown-line">{fx.breakdown.line}</p>
            </div>
          )}
          {hasText(fx.sensitivity_line) && (
            <div className="recab-fx-sensitivity">📊 {fx.sensitivity_line}</div>
          )}
          {hasText(fx.note) && <div className="recab-fx-note">※ {fx.note}</div>}
        </SectionCard>
      )}

      <FuturesStrip futures={d._china_futures} title="원가 신호 — 중국 원료탄·코크스 선물" />

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
