import type { SteelmakerData, DomesticMaker, OverseasMaker, IndustryStatus, Direction } from '../types';
import { SectionCard, TextBlock } from '../components/ui';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function DirArrow({ dir }: { dir: Direction }) {
  if (dir === 'UP')   return <span style={{ color: 'var(--up)',      fontWeight: 700 }}>▲</span>;
  if (dir === 'DOWN') return <span style={{ color: 'var(--down)',    fontWeight: 700 }}>▼</span>;
  return                      <span style={{ color: 'var(--neutral)' }}>—</span>;
}

function DirBadge({ dir }: { dir: Direction }) {
  const map = {
    UP:      { label: '상승', cls: 'dir-up'      },
    DOWN:    { label: '하락', cls: 'dir-down'    },
    NEUTRAL: { label: '보합', cls: 'dir-neutral' },
  };
  const { label, cls } = map[dir] ?? map.NEUTRAL;
  return <span className={`dir-badge ${cls}`}>{label}</span>;
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

/** 뉴스 없으면 렌더 안 함 */
function RecentIssues({ text }: { text?: string }) {
  if (!text || text.includes('최근 3일 내 주요 발표 없음') || text.includes('주요 발표 없음')) return null;
  return (
    <div className="maker-recent-issues has-news">
      <span className="maker-recent-label">최근 이슈</span>
      <span className="maker-recent-text">{text}</span>
    </div>
  );
}

// ─── 국내 제강사 행 ───────────────────────────────────────────────────────────

function DomesticMakerRow({ maker }: { maker: DomesticMaker }) {
  const m = maker as any;
  return (
    <div className="maker-row">
      <div className="maker-header">
        <span className="maker-name">{maker.name}</span>
      </div>

      <RecentIssues text={maker.recent_issues} />

      <div className="maker-detail-block">
        <InfoRow label="생산 동향" text={maker.production_trend ?? m.current_status ?? ''} labelCls="ki-what"   />
        <InfoRow label="원가 요인" text={maker.cost_factors     ?? m.reason          ?? ''} labelCls="ki-why"    />
        <InfoRow label="수요·판매" text={maker.demand_sales      ?? m.impact           ?? ''} labelCls="ki-impact" />
      </div>

      {(maker.raw_material_impact || m.outlook) && (
        <div className="maker-impact-box">
          <span className="maker-impact-label">부원료 수요</span>
          <span className="maker-impact-text">{maker.raw_material_impact ?? m.outlook}</span>
        </div>
      )}
    </div>
  );
}

// ─── 해외 제강사 행 ───────────────────────────────────────────────────────────

function OverseasMakerRow({ maker }: { maker: OverseasMaker }) {
  const m = maker as any;
  return (
    <div className="country-row">
      <div className="country-header">
        <span className="country-name">{maker.country}</span>
        <span className="country-producer">{maker.makers}</span>
      </div>

      <RecentIssues text={maker.recent_issues} />

      <div className="maker-detail-block">
        <InfoRow label="생산 동향" text={maker.production_trend ?? m.current_status ?? m.status ?? ''} labelCls="ki-what"   />
        <InfoRow label="원가 요인" text={maker.cost_factors     ?? m.reason                        ?? ''} labelCls="ki-why"    />
        <InfoRow label="수요·판매" text={maker.demand_sales      ?? m.impact                        ?? ''} labelCls="ki-impact" />
      </div>

      {(maker.raw_material_impact || m.outlook) && (
        <div className="maker-impact-box" style={{ marginTop: 4 }}>
          <span className="maker-impact-label">부원료 영향</span>
          <span className="maker-impact-text">{maker.raw_material_impact ?? m.outlook}</span>
        </div>
      )}
    </div>
  );
}

// ─── 수요 산업 리포트 ─────────────────────────────────────────────────────────

function DemandReport({ label, industry }: { label: string; industry: IndustryStatus }) {
  return (
    <div className="demand-report-item">
      <div className="demand-report-header">
        <span className="demand-report-title">{label}</span>
        <DirBadge dir={industry.direction} />
      </div>
      <div className="demand-report-body">
        <div className="demand-report-row">
          <span className="demand-report-label">현황</span>
          <span className="demand-report-text">{industry.status}</span>
        </div>
        {industry.basis && (
          <div className="demand-report-row">
            <span className="demand-report-label">근거</span>
            <span className="demand-report-text">{industry.basis}</span>
          </div>
        )}
        {industry.reason && (
          <div className="demand-report-row">
            <span className="demand-report-label">원인</span>
            <span className="demand-report-text">{industry.reason}</span>
          </div>
        )}
        {industry.outlook && (
          <div className="demand-report-row">
            <span className="demand-report-label">전망</span>
            <span className="demand-report-text">{industry.outlook}</span>
          </div>
        )}
      </div>
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

  // 데이터 기준 날짜 (updated_at or today)
  const updatedAt = (data as any).updated_at;
  const dateBasis = updatedAt
    ? new Date(updatedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="tab-content">

      {dateBasis && (
        <p className="steelmaker-date-note">데이터 기준: {dateBasis} (2026년 1분기 ~ 4월)</p>
      )}

      {/* 국내 제강사 */}
      <SectionCard title="국내 제강사 동향" accent="KR">
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

      {/* 수요 산업 — 리포트 형식 */}
      {demand_industries && (
        <SectionCard title="수요 산업 현황" accent="DEM">
          <div className="demand-report-list">
            <DemandReport label="건설 (한국)" industry={demand_industries.construction_korea} />
            <DemandReport label="건설 (중국)" industry={demand_industries.construction_china} />
            <DemandReport label="자동차"      industry={demand_industries.auto} />
            <DemandReport label="조선"        industry={demand_industries.shipbuilding} />
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
