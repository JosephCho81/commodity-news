import type { SteelmakerData, DomesticMaker, OverseasMaker, IndustryStatus, ShippingRoute, Direction, OperatingRate } from '../types';
import { SectionCard, TextBlock } from '../components/ui';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function RateBadge({ rate }: { rate: OperatingRate }) {
  const map: Record<OperatingRate, { label: string; cls: string }> = {
    HIGH: { label: '가동 상', cls: 'rate-high' },
    MID:  { label: '가동 중', cls: 'rate-mid'  },
    LOW:  { label: '가동 하', cls: 'rate-low'  },
  };
  const { label, cls } = map[rate] ?? map.MID;
  return <span className={`maker-rate-badge ${cls}`}>{label}</span>;
}

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
        <RateBadge rate={maker.operating_rate} />
        {maker.production_cut && <span className="maker-cut-badge">감산</span>}
        {maker.eaf_status && <span className="maker-eaf">{maker.eaf_status}</span>}
      </div>

      <div className="maker-detail-block">
        <InfoRow label="현황" text={maker.current_status ?? (maker as any).note} labelCls="ki-what" />
        <InfoRow label="원인" text={maker.reason} labelCls="ki-why" />
        <InfoRow label="영향" text={maker.impact} labelCls="ki-impact" />
        <InfoRow label="전망" text={maker.outlook} labelCls="ki-outlook" />
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
        <InfoRow label="현황" text={maker.current_status ?? (maker as any).status} labelCls="ki-what" />
        <InfoRow label="원인" text={maker.reason} labelCls="ki-why" />
        <InfoRow label="영향" text={maker.impact} labelCls="ki-impact" />
        <InfoRow label="전망" text={maker.outlook} labelCls="ki-outlook" />
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

// ─── 운임 행 ─────────────────────────────────────────────────────────────────

function ShippingRow({ route }: { route: ShippingRoute }) {
  return (
    <div className="shipping-route-row">
      <span className="shipping-route-name">{route.route}</span>
      <span className="shipping-price-val">{route.price_feu ?? '—'}</span>
      <DirArrow dir={route.direction} />
      {route.note && <span className="shipping-note">{route.note}</span>}
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
    shipping,
  } = data;

  return (
    <div className="tab-content">

      {/* 국내 제강사 — 순서 고정: 동국제강, 포스코, 현대제철 */}
      <SectionCard title="국내 제강사 운영 현황" accent="KR">
        {['동국제강', '포스코', '현대제철'].map((name) => {
          const maker = domestic_makers.find((m) => m.name === name);
          return maker ? <DomesticMakerRow key={name} maker={maker} /> : null;
        })}
        {/* 혹시 이름이 다르게 온 경우 나머지 표시 */}
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

      {/* 해상 운임 */}
      {shipping && (
        <SectionCard title="해상 운임" accent="SEA">
          <TextBlock text={shipping.current_issues} />
          <div className="shipping-routes">
            <div className="shipping-routes-header">
              <span>항로 (부산 기준, 40ft FEU)</span>
              <span>운임</span>
            </div>
            {(shipping.routes ?? []).map((r) => (
              <ShippingRow key={r.route} route={r} />
            ))}
          </div>
          {shipping.outlook && (
            <p className="shipping-outlook">{shipping.outlook}</p>
          )}
        </SectionCard>
      )}

    </div>
  );
}
