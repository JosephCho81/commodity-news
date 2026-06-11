// 앱 셸 공용 컴포넌트 — 로고·섹션 카드·텍스트·로딩/에러·신선도 배지
// 데이터 표시 요소(칩·필·스파크라인 등)는 data-viz.tsx 참조.
import { useState, Component } from 'react';
import type { ReactNode } from 'react';
import type { ApiMeta } from '../types';

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

// V2: 영문 액센트 칩은 장식 노이즈라 렌더링하지 않음 (accent prop은 호출부 호환용으로 수용만)
export function SectionCard({ title, children }: {
  title: string; accent?: string; children: React.ReactNode;
}) {
  return (
    <div className="section-card">
      <div className="section-header">
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

export function LoadingState() {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="시장 데이터 수집 중">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card tall" />
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
