import { useState } from 'react';

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
