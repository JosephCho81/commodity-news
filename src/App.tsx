// src/App.tsx — 비철금속 원자재 인텔리전스 앱 전면 재설계
import { useState, useEffect, useCallback } from 'react';
import type {
  TabId, AluminumData, FerrosiliconData, RecarburizerData, SummaryData
} from './types';
import { TABS } from './types';

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const API_BASE = '/api/get-news';

function formatNum(val: string | null | undefined) {
  if (!val) return null;
  // 숫자면 콤마 포맷, 문자열이면 그대로
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(n)) return String(val);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAge(min: number) {
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

function directionColor(d: string | null | undefined) {
  if (d === 'UP') return 'var(--up)';
  if (d === 'DOWN') return 'var(--down)';
  return 'var(--neutral)';
}

function urgencyBadge(u: string | null | undefined) {
  if (!u) return '참고';
  u = u.toUpperCase();
  const map: Record<string, string> = { HIGH: '고위험', MEDIUM: '주의', LOW: '참고' };
  return map[u] ?? u;

}

// ─── 서브 컴포넌트들 ──────────────────────────────────────────────────────────

function PriceTag({ value, label }: { value: string | null; label: string }) {
  if (!value) return null;
  return (
    <div className="price-tag">
      <span className="price-label">{label}</span>
      <span className="price-value">{value}</span>
    </div>
  );
}

function SectionCard({ title, accent, children }: {
  title: string; accent?: string; children: React.ReactNode;
}) {
  return (
    <div className="section-card">
      <div className="section-header">
        {accent && <span className="section-accent">{accent}</span>}
        <span className="section-title">{title}</span>
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return <p className="text-block">{text}</p>;
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <p>시장 데이터 수집 중…</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="error-state">
      <p>데이터를 불러오지 못했습니다.</p>
      <button onClick={onRetry} className="retry-btn">다시 시도</button>
    </div>
  );
}

// ─── 탭 콘텐츠: 알루미늄 ──────────────────────────────────────────────────────
function AluminumTab({ data }: { data: AluminumData }) {
  const { lme, scrap } = data;
  const isUp = lme.change != null && !String(lme.change).startsWith('-');
  return (
    <div className="tab-content">
      {/* LME 가격 헤더 */}
      <div className="price-hero">
        <div className="price-hero-main">
          <span className="price-hero-label">LME 알루미늄 공식가</span>
          {lme.price
            ? <span className="price-hero-value">{formatNum(lme.price)} <small>USD/톤</small></span>
            : <span className="price-hero-na">가격 확인 중</span>
          }
          {lme.change && (
            <span className="price-hero-change" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
              전일 대비 {isUp ? '+' : ''}{formatNum(lme.change)} USD/톤 ({lme.change_pct})
            </span>
          )}
        </div>
        {lme.date && <span className="price-hero-date">기준: {lme.date}</span>}
      </div>

      <SectionCard title="가격 변동 이유" accent="WHY">
        <TextBlock text={lme.move_reason} />
      </SectionCard>

      <SectionCard title="시장 현황" accent="NOW">
        <TextBlock text={lme.market_status} />
      </SectionCard>

      <SectionCard title="단기 전망" accent="NEXT">
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
              <div className="region-item-header">
                <span className="region-name">{r.region}</span>
                {r.price_range && <span className="region-price">{r.price_range}</span>}
              </div>
              <div className="region-grades-line">{r.key_grades}</div>
              <p className="region-driver">{r.price_driver}</p>
              <p className="region-flow-text">{r.flow}</p>
            </div>
          ))}
        </div>
      </SectionCard>


    </div>
  );
}

// ─── 탭 콘텐츠: 페로실리콘 ────────────────────────────────────────────────────
function FerrosiliconTab({ data }: { data: FerrosiliconData }) {
  const { china_price, china_production, non_china, export_flows, market_summary } = data;
  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="price-hero-main">
          <span className="price-hero-label">FeSi75 닝샤 현물가</span>
          {china_price.fesi75_ningxia
            ? <span className="price-hero-value">{china_price.fesi75_ningxia} <small>CNY/톤</small></span>
            : <span className="price-hero-na">가격 확인 중</span>
          }
          {china_price.change && (
            <span className="price-hero-change"
              style={{ color: china_price.change != null && String(china_price.change).startsWith('-') ? 'var(--down)' : 'var(--up)' }}>
              {china_price.change}
            </span>
          )}
        </div>
        <div className="price-hero-sub">
          {china_price.fesi75_neimenggu &&
            <span>내몽골: {china_price.fesi75_neimenggu} CNY/톤</span>}
          {china_price.date && <span>기준: {china_price.date}</span>}
        </div>
      </div>

      <SectionCard title="가격 맥락" accent="CTX">
        <TextBlock text={china_price.price_context} />
      </SectionCard>

      <SectionCard title="중국 생산 현황" accent="PROD">
        <div className="production-grid">
          <div className="prod-region">
            <div className="prod-region-name">닝샤 寧夏</div>
            <InfoRow label="전력" value={china_production.ningxia.power_situation} />
            {china_production.ningxia.utilization_rate &&
              <InfoRow label="가동률" value={china_production.ningxia.utilization_rate} />}
            <InfoRow label="날씨" value={china_production.ningxia.weather_impact} />
          </div>
          <div className="prod-region">
            <div className="prod-region-name">윈난 雲南</div>
            <InfoRow label="전력" value={china_production.yunnan.power_situation} />
            {china_production.yunnan.utilization_rate &&
              <InfoRow label="가동률" value={china_production.yunnan.utilization_rate} />}
            <InfoRow label="날씨" value={china_production.yunnan.weather_impact} />
          </div>
        </div>
        <TextBlock text={china_production.overall} />
      </SectionCard>

      <SectionCard title="비중국 생산국 동향" accent="INTL">
        {non_china.map((c) => (
          <div key={c.country} className="country-row">
            <div className="country-header">
              <span className="country-name">{c.country}</span>
              <span className="country-producer">{c.producer}</span>
            </div>
            <p className="country-status">{c.status}</p>
            <div className="country-flow-tag">→ {c.export_direction}</div>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="수출 방향 (한국·일본·EU·인도)" accent="FLOW">
        <InfoRow label="한국" value={export_flows.korea} />
        <InfoRow label="일본" value={export_flows.japan} />
        <InfoRow label="EU" value={export_flows.eu} />
        <InfoRow label="인도" value={export_flows.india} />
      </SectionCard>

      <SectionCard title="시장 종합 및 전망" accent="SUM">
        <TextBlock text={market_summary} />
      </SectionCard>
    </div>
  );
}

// ─── 탭 콘텐츠: 가탄제 ────────────────────────────────────────────────────────
function RecarburizerTab({ data }: { data: RecarburizerData }) {
  const { china_price, china_production, russia, asia_flows, market_summary } = data;
  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="price-hero-main">
          <span className="price-hero-label">중국 무연탄 현물가</span>
          {china_price.anthracite_shanxi
            ? <span className="price-hero-value">{china_price.anthracite_shanxi} <small>CNY/톤</small></span>
            : <span className="price-hero-na">가격 확인 중</span>
          }
          {china_price.change && (
            <span className="price-hero-change"
              style={{ color: china_price.change != null && String(china_price.change).startsWith('-') ? 'var(--down)' : 'var(--up)' }}>
              {china_price.change}
            </span>
          )}
        </div>
        <div className="price-hero-sub">
          {china_price.anthracite_guizhou &&
            <span>귀저우: {china_price.anthracite_guizhou} CNY/톤</span>}
          {china_price.calcined_anthracite &&
            <span>하소 안트라사이트: {china_price.calcined_anthracite} CNY/톤</span>}
          {china_price.date && <span>기준: {china_price.date}</span>}
        </div>
      </div>

      <SectionCard title="가격 맥락" accent="CTX">
        <TextBlock text={china_price.price_context} />
      </SectionCard>

      <SectionCard title="중국 생산 현황" accent="PROD">
        <InfoRow label="채굴 현황" value={china_production.mining_status} />
        <InfoRow label="가공 현황" value={china_production.processing_status} />
        <InfoRow label="정책 영향" value={china_production.policy_impact} />
      </SectionCard>

      <SectionCard title="러시아 안트라사이트" accent="RUS">
        <InfoRow label="수출 현황" value={russia.export_volume} />
        <InfoRow label="제재 영향" value={russia.sanctions_impact} />
        <InfoRow label="가격 경쟁력" value={russia.price_competitiveness} />
      </SectionCard>

      <SectionCard title="아시아 물동량 흐름" accent="FLOW">
        <div className="flow-table">
          <div className="flow-table-header">
            <span>수입국</span>
            <span>주요 공급국</span>
            <span>물량 추이</span>
            <span>단가 동향</span>
          </div>
          {asia_flows.map((f) => (
            <div key={f.importer} className="flow-table-row">
              <span className="flow-importer">{f.importer}</span>
              <span>{f.main_sources}</span>
              <span>{f.volume_trend}</span>
              <span>{f.price_trend}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="시장 종합 및 전망" accent="SUM">
        <TextBlock text={market_summary} />
      </SectionCard>
    </div>
  );
}

// ─── 탭 콘텐츠: 시황 종합 ─────────────────────────────────────────────────────
function SummaryTab({ data }: { data: SummaryData }) {
  const { one_liner, key_signals, risk_signals, week_ahead } = data;
  return (
    <div className="tab-content">
      <div className="one-liner-card">
        <div className="one-liner-label">TODAY</div>
        <div className="one-liner-text">"{one_liner}"</div>
      </div>

      <SectionCard title="품목별 핵심 시그널" accent="SIGNAL">
        {key_signals.map((s) => (
          <div key={s.commodity} className="signal-row">
            <div className="signal-meta">
              <span className="signal-commodity">{s.commodity}</span>
              <span className="signal-dir" style={{ color: directionColor(s.direction) }}>
                {s.direction === 'UP' ? '▲' : s.direction === 'DOWN' ? '▼' : '—'}
              </span>
              <span className={`signal-urgency urgency-${(s.urgency ?? "low").toLowerCase()}`}>
                {urgencyBadge(s.urgency)}
              </span>
            </div>
            <p className="signal-text">{s.signal}</p>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="주요 리스크 신호" accent="RISK">
        {risk_signals.map((r, i) => (
          <div key={i} className="risk-row">
            <div className="risk-header">
              <span className="risk-name">{r.risk}</span>
              <span className={`risk-prob prob-${(r.probability ?? "low").toLowerCase()}`}>
                {r.probability === 'HIGH' ? '고' : r.probability === 'MEDIUM' ? '중' : '저'}위험
              </span>
            </div>
            <p className="risk-affected">영향: {r.affected}</p>
            <p className="risk-impact">{r.impact}</p>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="이번 주 주목 변수" accent="WATCH">
        <div className="watch-text">{week_ahead}</div>
      </SectionCard>
    </div>
  );
}

// ─── 메인 앱 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState<Record<TabId, boolean>>({
    aluminum: false, ferrosilicon: false, recarburizer: false, summary: false,
  });
  const [error, setError] = useState<Record<TabId, boolean>>({
    aluminum: false, ferrosilicon: false, recarburizer: false, summary: false,
  });

  const fetchTab = useCallback(async (tab: TabId) => {
    setLoading(p => ({ ...p, [tab]: true }));
    setError(p => ({ ...p, [tab]: false }));
    try {
      const res = await fetch(`${API_BASE}?tab=${tab}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(p => ({ ...p, [tab]: json }));
    } catch {
      setError(p => ({ ...p, [tab]: true }));
    } finally {
      setLoading(p => ({ ...p, [tab]: false }));
    }
  }, []);

  // 탭 변경 시 데이터 없으면 fetch
  useEffect(() => {
    if (!data[activeTab] && !loading[activeTab]) {
      fetchTab(activeTab);
    }
  }, [activeTab]);

  const tabData = data[activeTab] as never;
  const isLoading = loading[activeTab];
  const isError = error[activeTab];

  function renderContent() {
    if (isLoading) return <LoadingState />;
    if (isError) return <ErrorState onRetry={() => fetchTab(activeTab)} />;
    if (!tabData) return null;
    switch (activeTab) {
      case 'aluminum':     return <AluminumTab data={tabData as AluminumData} />;
      case 'ferrosilicon': return <FerrosiliconTab data={tabData as FerrosiliconData} />;
      case 'recarburizer': return <RecarburizerTab data={tabData as RecarburizerData} />;
      case 'summary':      return <SummaryTab data={tabData as SummaryData} />;
    }
  }

  const meta = tabData as (AluminumData | null);
  const ageMin = meta?._age_min ?? null;

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* 헤더 */}
        <header className="app-header">
          <div className="header-brand">
            <img src="/logo.png" alt="한국에이원" className="brand-logo" />
            <div className="brand-text">
              <div className="brand-name">오늘의 원자재 뉴스</div>
              <div className="brand-sub">비철금속 원자재 인텔리전스</div>
            </div>
          </div>
          <div className="header-actions">
            {ageMin !== null && (
              <span className="cache-badge">
                {meta?._cached ? `${formatAge(ageMin)} 업데이트` : '오늘 데이터'}
              </span>
            )}
          </div>
        </header>

        {/* 바텀탭 */}
        <nav className="bottom-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon">{tab.icon}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* 콘텐츠 영역 */}
        <main className="app-main">
          {renderContent()}
        </main>
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

  :root {
    --bg:       #0d0f13;
    --surface:  #141720;
    --surface2: #1a1e28;
    --border:   #262c3a;
    --accent:   #e8b84b;
    --accent2:  #c98f2a;
    --text:     #d4dae8;
    --text2:    #8492a6;
    --text3:    #4f5a6e;
    --up:       #4ade80;
    --down:     #f87171;
    --neutral:  #94a3b8;
    --high:     #ef4444;
    --medium:   #f59e0b;
    --low:      #6b7280;
    --mono:     'IBM Plex Mono', monospace;
    --sans:     'IBM Plex Sans KR', sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  /* ── 앱 레이아웃 ── */
  .app {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* ── 헤더 ── */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-brand { display: flex; align-items: center; gap: 10px; }

  .brand-logo {
    height: 36px;
    width: auto;
    object-fit: contain;
  }

  .brand-name {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: #fff;
  }

  .brand-sub {
    font-size: 10px;
    color: var(--text3);
    font-family: var(--mono);
    letter-spacing: 0.5px;
  }

  .header-actions { display: flex; align-items: center; gap: 8px; }

  .cache-badge {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    padding: 2px 6px;
    border: 1px solid var(--border);
  }

  .refresh-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text2);
    font-family: var(--mono);
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .refresh-btn:hover { border-color: var(--accent); color: var(--accent); }
  .refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── 바텀 네비 ── */
  .bottom-nav {
    display: flex;
    border-top: 1px solid var(--border);
    background: var(--surface);
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    z-index: 10;
  }

  .nav-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 4px 12px;
    background: none;
    border: none;
    color: var(--text3);
    cursor: pointer;
    transition: color 0.15s;
    gap: 3px;
    position: relative;
  }

  .nav-tab::before {
    content: '';
    position: absolute;
    top: 0; left: 20%; right: 20%; height: 2px;
    background: var(--accent);
    transform: scaleX(0);
    transition: transform 0.2s;
  }

  .nav-tab.active { color: var(--accent); }
  .nav-tab.active::before { transform: scaleX(1); }

  .nav-icon { font-size: 16px; line-height: 1; }
  .nav-label { font-size: 10px; font-family: var(--mono); }

  /* ── 메인 콘텐츠 ── */
  .app-main {
    flex: 1;
    overflow-y: auto;
    padding: 16px 16px 90px;
  }

  .tab-content { display: flex; flex-direction: column; gap: 12px; }

  /* ── 가격 히어로 ── */
  .price-hero {
    background: linear-gradient(135deg, var(--surface2) 0%, #1f2535 100%);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .price-hero-main { display: flex; flex-direction: column; gap: 4px; }

  .price-hero-label {
    font-size: 10px;
    font-family: var(--mono);
    color: var(--text3);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .price-hero-value {
    font-size: 28px;
    font-family: var(--mono);
    font-weight: 500;
    color: var(--accent);
    letter-spacing: -1px;
  }

  .price-hero-value small {
    font-size: 13px;
    color: var(--text3);
    font-weight: 400;
  }

  .price-hero-na {
    font-size: 20px;
    font-family: var(--mono);
    color: var(--text3);
  }

  .price-hero-change {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
  }

  .price-hero-date {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
  }

  .price-hero-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
  }

  /* ── 섹션 카드 ── */
  .section-card {
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }

  .section-accent {
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 500;
    color: var(--accent2);
    letter-spacing: 1.5px;
    padding: 1px 5px;
    border: 1px solid var(--accent2);
  }

  .section-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
  }

  .section-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }

  /* ── 텍스트 블록 ── */
  .text-block {
    font-size: 13px;
    color: var(--text);
    line-height: 1.75;
  }

  /* ── 인포 로우 ── */
  .info-row {
    display: flex;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .info-row:last-child { border-bottom: none; }

  .info-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    min-width: 64px;
    padding-top: 2px;
    flex-shrink: 0;
  }

  .info-value {
    font-size: 12px;
    color: var(--text);
    line-height: 1.6;
  }

  /* ── 지역 그리드 (스크랩) ── */
  .region-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .region-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .region-name {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
  }

  .region-grades {
    font-size: 10px;
    color: var(--text3);
  }

  .region-price {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--up);
    font-weight: 500;
  }

  .region-flow {
    font-size: 11px;
    color: var(--text2);
    line-height: 1.5;
  }

  /* ── 생산 그리드 ── */
  .production-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  .prod-region {
    background: var(--surface2);
    border: 1px solid var(--border);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .prod-region-name {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    margin-bottom: 2px;
  }

  /* ── 국가 로우 ── */
  .country-row {
    border-bottom: 1px solid var(--border);
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .country-row:last-child { border-bottom: none; }

  .country-header { display: flex; align-items: baseline; gap: 8px; }

  .country-name {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
  }

  .country-producer {
    font-size: 10px;
    color: var(--text3);
  }

  .country-status {
    font-size: 12px;
    color: var(--text);
    line-height: 1.6;
  }

  .country-flow-tag {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text2);
    border: 1px solid var(--border);
    padding: 2px 6px;
    display: inline-block;
    margin-top: 2px;
  }

  /* ── 물동량 테이블 ── */
  .flow-table { display: flex; flex-direction: column; gap: 0; }

  .flow-table-header {
    display: grid;
    grid-template-columns: 80px 1fr 80px 80px;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 9px;
    color: var(--text3);
    letter-spacing: 0.5px;
  }

  .flow-table-row {
    display: grid;
    grid-template-columns: 80px 1fr 80px 80px;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--text);
    align-items: start;
  }
  .flow-table-row:last-child { border-bottom: none; }

  .flow-importer {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    font-weight: 500;
  }

  /* ── ONE-LINER 카드 ── */
  .one-liner-card {
    background: linear-gradient(135deg, #1a1f2e 0%, #0f1420 100%);
    border: 1px solid var(--accent2);
    padding: 20px 18px;
  }

  .one-liner-label {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--accent2);
    letter-spacing: 3px;
    margin-bottom: 8px;
  }

  .one-liner-text {
    font-size: 15px;
    font-weight: 500;
    color: #fff;
    line-height: 1.7;
    font-style: italic;
  }

  /* ── 시그널 로우 ── */
  .signal-row {
    border-bottom: 1px solid var(--border);
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .signal-row:last-child { border-bottom: none; }

  .signal-meta { display: flex; align-items: center; gap: 8px; }

  .signal-commodity {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
  }

  .signal-dir {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
  }

  .signal-urgency {
    font-family: var(--mono);
    font-size: 9px;
    padding: 1px 5px;
    margin-left: auto;
  }
  .urgency-high { color: var(--high); border: 1px solid var(--high); }
  .urgency-medium { color: var(--medium); border: 1px solid var(--medium); }
  .urgency-low { color: var(--low); border: 1px solid var(--low); }

  .signal-text { font-size: 12px; color: var(--text); line-height: 1.6; }

  /* ── 리스크 로우 ── */
  .risk-row {
    border-bottom: 1px solid var(--border);
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .risk-row:last-child { border-bottom: none; }

  .risk-header { display: flex; align-items: center; justify-content: space-between; }

  .risk-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
  }

  .risk-prob {
    font-family: var(--mono);
    font-size: 9px;
    padding: 1px 6px;
  }
  .prob-high { color: var(--high); border: 1px solid var(--high); }
  .prob-medium { color: var(--medium); border: 1px solid var(--medium); }
  .prob-low { color: var(--low); border: 1px solid var(--low); }

  .risk-affected {
    font-size: 10px;
    color: var(--text3);
    font-family: var(--mono);
  }

  .risk-impact { font-size: 12px; color: var(--text2); line-height: 1.6; }

  /* ── 주목 변수 ── */
  .watch-text {
    font-size: 13px;
    color: var(--text);
    line-height: 1.8;
    white-space: pre-line;
  }

  /* ── 로딩 / 에러 ── */
  .loading-state, .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 60px 20px;
    color: var(--text3);
    font-family: var(--mono);
    font-size: 12px;
  }

  .loading-spinner {
    width: 24px; height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .retry-btn {
    background: none;
    border: 1px solid var(--accent);
    color: var(--accent);
    font-family: var(--mono);
    font-size: 11px;
    padding: 6px 16px;
    cursor: pointer;
  }

  /* ── P1020A 프리미엄 행 ── */
  .premium-row {
    background: var(--surface2);
    border: 1px solid var(--border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .premium-label {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--text3);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .premium-values {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }

  .premium-values span {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent);
  }

  .premium-values em {
    font-style: normal;
    color: var(--text3);
    font-size: 10px;
    margin-right: 4px;
  }

  /* ── 스크랩 지역 리스트 ── */
  .region-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .region-item {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .region-item:last-child { border-bottom: none; }

  .region-item-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .region-grades-line {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
  }

  .region-driver {
    font-size: 12px;
    color: var(--text);
    line-height: 1.65;
  }

  .region-flow-text {
    font-size: 11px;
    color: var(--text2);
    line-height: 1.6;
  }

  /* ── 스크롤바 ── */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); }

  /* ── 반응형 ── */
  @media (max-width: 360px) {
    .region-grid { grid-template-columns: 1fr; }
    .production-grid { grid-template-columns: 1fr; }
    .flow-table-header,
    .flow-table-row { grid-template-columns: 60px 1fr 60px 60px; }
  }
`;

