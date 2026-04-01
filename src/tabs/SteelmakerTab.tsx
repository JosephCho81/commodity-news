import type { SteelmakerData, DomesticMaker, OverseasMaker, IndustryStatus, Direction } from '../types';
import { SectionCard, TextBlock } from '../components/ui';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function DirArrow({ dir }: { dir: Direction }) {
  if (dir === 'UP')   return <span style={{ color: 'var(--up)',      fontWeight: 700 }}>▲</span>;
  if (dir === 'DOWN') return <span style={{ color: 'var(--down)',    fontWeight: 700 }}>▼</span>;
  return                      <span style={{ color: 'var(--neutral)' }}>—</span>;
}

function InfoRow({ label, text, labelCls }: { label: string; text: string; labelCls?: string }) {
  if (!text) return null;
  return (
    <div className="maker-info-row">
      <span className={`maker-info-label ${labelCls ?? ''}`}>{label}</span>
      <span className="maker-info-text">{text}</span>
    </div>
  );
}

// ─── 국내 제강사 행 ───────────────────────────────────────────────────────────

function DomesticMakerRow({ maker }: { maker: DomesticMaker }) {
  return (
    <div className="maker-row">
      <div className="maker-header">
        <span className="maker-name">{maker.name}</span>
      </div>

      <div className="maker-detail-block">
        <InfoRow label="최근 이슈" text={maker.recent_issues}    labelCls="ki-what"   />
        <InfoRow label="생산 동향" text={maker.production_trend} labelCls="ki-why"    />
        <InfoRow label="원가 요인" text={maker.cost_factors}     labelCls="ki-impact" />
        <InfoRow label="수요·판매" text={maker.demand_sales}     labelCls="ki-outlook"/>
      </div>

      {maker.raw_material_impact && (
        <div className="maker-impact-box">
          <span className="maker-impact-label">부원료 수요</span>
          <span className="maker-impact-text">{maker.raw_material_impact}</span>
        </div>
      )}
    </div>
  );
}

// ─── 해외 제강사 행 ───────────────────────────────────────────────────────────

function OverseasMakerRow({ maker }: { maker: OverseasMaker }) {
  return (
    <div className="country-row">
      <div className="country-header">
        <span className="country-name">{maker.country}</span>
        <span className="country-producer">{maker.makers}</span>
      </div>

      <div className="maker-detail-block">
        <InfoRow label="최근 이슈" text={maker.recent_issues}    labelCls="ki-what"   />
        <InfoRow label="생산 동향" text={maker.production_trend} labelCls="ki-why"    />
        <InfoRow label="원가 요인" text={maker.cost_factors}     labelCls="ki-impact" />
        <InfoRow label="수요·판매" text={maker.demand_sales}     labelCls="ki-outlook"/>
      </div>

      {maker.raw_material_impact && (
        <div className="maker-impact-box" style={{ marginTop: 4 }}>
          <span className="maker-impact-label">부원료 영향</span>
          <span className="maker-impact-text">{maker.raw_material_impact}</span>
        </div>
      )}
    </div>
  );
}

// ─── 수요 산업 셀 ─────────────────────────────────────────────────────────────

function DemandCell({ label, industry }: { label: string; industry: IndustryStatus }) {
  return (
    <div className="demand-cell">
      <div className="demand-label-row">
        <span className="demand-label">{label}</span>
        <DirArrow dir={industry.direction} />
      </div>
      <p className="demand-status">{industry.status}</p>
      <p className="demand-basis">{industry.basis}</p>
    </div>
  );
}

// ─── 메인 탭 ────────────────────────────────────────────────────────────────

export function SteelmakerTab({ data }: { data: SteelmakerData }) {
  const {
    domestic_makers = [],
    overseas_makers = [],
    demand_industries,
    raw_material_forecast,
  } = data;

  return (
    <div className="tab-content">

      {/* 국내 제강사 — 순서 고정: 동국제강, 포스코, 현대제철 */}
      <SectionCard title="국내 제강사 운영 현황" accent="KR">
        {['동국제강', '포스코', '현대제철'].map((name) => {
          const maker = domestic_makers.find((m) => m.name === name);
          return maker ? <DomesticMakerRow key={name} maker={maker} /> : null;
        })}
        {domestic_makers
          .filter((m) => !['동국제강', '포스코', '현대제철'].includes(m.name))
          .map((maker) => <DomesticMakerRow key={maker.name} maker={maker} />)}
      </SectionCard>

      {/* 해외 제강사 */}
      <SectionCard title="해외 제강사 동향" accent="INTL">
        {overseas_makers.map((m) => (
          <OverseasMakerRow key={m.country} maker={m} />
        ))}
      </SectionCard>

      {/* 수요 산업 */}
      {demand_industries && (
        <SectionCard title="수요 산업 현황" accent="DEM">
          <div className="demand-grid">
            <DemandCell label="건설 (한국)" industry={demand_industries.construction_korea} />
            <DemandCell label="건설 (중국)" industry={demand_industries.construction_china} />
            <DemandCell label="자동차"      industry={demand_industries.auto} />
            <DemandCell label="조선"        industry={demand_industries.shipbuilding} />
          </div>
        </SectionCard>
      )}

      {/* 부원료 수요 전망 */}
      {raw_material_forecast && (
        <SectionCard title="부원료 수요 전망" accent="FORE">
          <TextBlock text={raw_material_forecast.summary} />
          <div className="forecast-box">
            {raw_material_forecast.deoxidizer && (
              <div className="forecast-item">
                <span className="forecast-label">탈산제</span>
                <span className="forecast-text">{raw_material_forecast.deoxidizer}</span>
              </div>
            )}
            {raw_material_forecast.ferroalloy && (
              <div className="forecast-item">
                <span className="forecast-label">합금철</span>
                <span className="forecast-text">{raw_material_forecast.ferroalloy}</span>
              </div>
            )}
            {raw_material_forecast.recarburizer && (
              <div className="forecast-item">
                <span className="forecast-label">가탄제</span>
                <span className="forecast-text">{raw_material_forecast.recarburizer}</span>
              </div>
            )}
          </div>
        </SectionCard>
      )}

    </div>
  );
}
