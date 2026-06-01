import { useState, Component } from 'react';
import type { ReactNode } from 'react';

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
