import type { SteelmakerData, DomesticMaker, OverseasMaker, IndustryStatus, Direction } from '../types';
import { SectionCard, SourcesList } from '../components/ui';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function DirBadge({ dir }: { dir: Direction }) {
  const map = {
    UP:      { label: '▲ 상승세', cls: 'dir-up'      },
    DOWN:    { label: '▼ 하락세', cls: 'dir-down'    },
    NEUTRAL: { label: '— 보합세', cls: 'dir-neutral' },
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
  return (
    <div className="maker-row">
      <div className="maker-header">
        <span className="maker-name">{maker.name}</span>
        <DirBadge dir={maker.direction} />
      </div>
      <RecentIssues text={maker.recent_issues} />
      <div className="maker-detail-block">
        <InfoRow label="현황" text={maker.status}  labelCls="ki-what"   />
        <InfoRow label="이유" text={maker.reason}  labelCls="ki-why"    />
        <InfoRow label="전망" text={maker.outlook} labelCls="ki-outlook" />
      </div>
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
        <DirBadge dir={maker.direction} />
      </div>
      <RecentIssues text={maker.recent_issues} />
      <div className="maker-detail-block">
        <InfoRow label="현황" text={maker.status}  labelCls="ki-what"   />
        <InfoRow label="이유" text={maker.reason}  labelCls="ki-why"    />
        <InfoRow label="전망" text={maker.outlook} labelCls="ki-outlook" />
      </div>
    </div>
  );
}

// ─── 수요 산업 ────────────────────────────────────────────────────────────────

function DemandReport({ label, industry }: { label: string; industry: IndustryStatus }) {
  return (
    <div className="country-row">
      <div className="country-header">
        <span className="country-name">{label}</span>
        <DirBadge dir={industry.direction} />
      </div>
      <div className="maker-detail-block">
        <InfoRow label="현황" text={industry.status}  labelCls="ki-what"   />
        <InfoRow label="이유" text={industry.reason}  labelCls="ki-why"    />
        <InfoRow label="전망" text={industry.outlook} labelCls="ki-outlook" />
      </div>
    </div>
  );
}

// ─── 메인 탭 ────────────────────────────────────────────────────────────────

export function SteelmakerTab({ data }: { data: SteelmakerData }) {
  const { domestic_makers = [], overseas_makers = [], demand_industries } = data;

  return (
    <div className="tab-content">

      <SectionCard title="국내 제강사 동향" accent="KR">
        {['동국제강', '포스코', '현대제철'].map((name) => {
          const maker = domestic_makers.find((m) => m.name === name);
          return maker ? <DomesticMakerRow key={name} maker={maker} /> : null;
        })}
        {domestic_makers
          .filter((m) => !['동국제강', '포스코', '현대제철'].includes(m.name))
          .map((maker) => <DomesticMakerRow key={maker.name} maker={maker} />)}
      </SectionCard>

      <SectionCard title="해외 제강사 동향" accent="INTL">
        {overseas_makers.map((m) => (
          <OverseasMakerRow key={m.country} maker={m} />
        ))}
      </SectionCard>

      {demand_industries && (
        <SectionCard title="수요 산업 현황" accent="DEM">
          <DemandReport label="건설 (한국)" industry={demand_industries.construction_korea} />
          <DemandReport label="건설 (중국)" industry={demand_industries.construction_china} />
          <DemandReport label="자동차"      industry={demand_industries.auto} />
          <DemandReport label="조선"        industry={demand_industries.shipbuilding} />
        </SectionCard>
      )}

      <SourcesList sources={data._sources} />
    </div>
  );
}
