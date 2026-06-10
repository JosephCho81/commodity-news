import { useState, Component } from 'react';
import type { ReactNode } from 'react';
import type { ApiMeta, SourceInfo } from '../types';

export function Logo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="brand-logo-fallback"><span>A1</span></div>;
  }
  return (
    <img
      src="/logo.png"
      alt="한국에이원"
      className="brand-logo"
      onError={() => setFailed(true)}
    />
  );
}

export function SectionCard({ title, accent, children }: {
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

export function TextBlock({ text }: { text: string | null | undefined }) {
  if (!text || String(text).trim().length === 0) return null;
  const cleaned = String(text)
    .replace(/Yuan/g, 'CNY')
    .replace(/\/톤/g, '/MT');
  return <p className="text-block">{cleaned}</p>;
}

// ─── 신뢰성 표기 ─────────────────────────────────────────────────────────────

// 가격 카드용 출처·기준일·이월 배지. 표시할 정보가 없으면 아무것도 그리지 않음.
export function PriceMeta({ source, asOf, carriedOver }: {
  source?: string | null; asOf?: string | null; carriedOver?: boolean;
}) {
  if (!source && !asOf && !carriedOver) return null;
  return (
    <span className="price-meta">
      {carriedOver && <span className="price-meta-carried">전일 데이터</span>}
      {asOf && <span className="price-meta-asof">{asOf} 기준</span>}
      {source && <span className="price-meta-source">{source}</span>}
    </span>
  );
}

// 헤더용 데이터 신선도 배지. _fallback이면 경고 톤으로 이전 데이터임을 명시.
export function FreshnessBadge({ meta }: { meta: ApiMeta | null | undefined }) {
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!meta) return <span className="cache-badge">{todayKST}</span>;

  const dataDate = meta._data_date ?? todayKST;
  if (meta._fallback) {
    return <span className="cache-badge cache-badge--stale">⚠ {dataDate} 데이터 표시 중</span>;
  }
  const timeLabel = meta._cached_at
    ? new Date(meta._cached_at + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
    : null;
  return (
    <span className="cache-badge">
      {dataDate}{timeLabel ? ` ${timeLabel}` : ''} 기준
    </span>
  );
}

// 탭 하단 참고 출처 접이식 목록 (Perplexity search_results 기반)
export function SourcesList({ sources }: { sources?: SourceInfo[] | null }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const valid = sources.filter(s => s?.url);
  if (valid.length === 0) return null;
  return (
    <div className="sources-list">
      <button className="sources-toggle" onClick={() => setOpen(o => !o)}>
        참고 출처 {valid.length}건 {open ? '▲' : '▼'}
      </button>
      {open && (
        <ul className="sources-items">
          {valid.map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title || s.url.replace(/^https?:\/\//, '').slice(0, 60)}
              </a>
              {s.date && <span className="sources-date"> ({s.date})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <p>시장 데이터 수집 중…</p>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="error-state">
      <p>데이터를 불러오지 못했습니다.</p>
      <button onClick={onRetry} className="retry-btn">다시 시도</button>
    </div>
  );
}

// 렌더 단계 예외가 전체 화면을 백지로 만드는 것을 탭 단위로 격리.
// key prop으로 탭 전환 시 boundary가 리셋되어 재시도 가능.
interface TabErrorBoundaryProps { onReset: () => void; children: ReactNode }
interface TabErrorBoundaryState { hasError: boolean }

export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): TabErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[TabErrorBoundary] 렌더 예외:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-state">
          <p>이 항목을 표시하는 중 문제가 발생했습니다.</p>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }}
            className="retry-btn"
          >
            다시 불러오기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
