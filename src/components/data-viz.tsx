// 데이터 표시 공용 요소 — 출처 칩·변동 필·스파크라인·선물 스트립·국내 헤드라인·가격 메타
import type { FuturesQuote, KrNewsItem, PriceHistoryEntry } from '../types';
import { SectionCard } from './ui';

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

// 출처 칩 — 모든 핵심 숫자 옆에 "이 숫자 어디서 왔나" 응답
export function SourceChip({ label, tone = 'brand' }: { label: string; tone?: 'brand' | 'muted' }) {
  return <span className={`source-chip source-chip--${tone}`}>{label}</span>;
}

// 변동 필 — 상승 빨강 / 하락 파랑 (한국 금융 관행)
export function DeltaPill({ change, changePct, suffix }: {
  change?: number | string | null; changePct?: string | null; suffix?: string;
}) {
  if (change === null || change === undefined || change === '') return null;
  const n = typeof change === 'number' ? change : parseFloat(String(change).replace(/,/g, ''));
  if (isNaN(n)) return null;
  const dir = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '—';
  return (
    <span className={`delta-pill delta-${dir}`}>
      {arrow} {n > 0 ? '+' : ''}{n.toLocaleString('en-US')}{suffix ?? ''}
      {changePct ? ` (${changePct})` : ''}
    </span>
  );
}

// 4주 추세 스파크라인 — 의존성 없는 inline SVG
export function Sparkline({ history, valueKey, width = 72, height = 22 }: {
  history?: PriceHistoryEntry[] | null; valueKey: string; width?: number; height?: number;
}) {
  if (!Array.isArray(history)) return null;
  const pts = history
    .filter(h => typeof h?.[valueKey] === 'number')
    .slice(-28)
    .map(h => h[valueKey] as number);
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const coords = pts.map((v, i) =>
    `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`
  );
  const lastUp = pts[pts.length - 1] >= pts[0];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={lastUp ? 'var(--up)' : 'var(--down)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}

// 중국 선물 스트립 — 철강 체인 정산가 한 줄 카드
export function FuturesStrip({ futures, title }: { futures?: FuturesQuote[] | null; title?: string }) {
  if (!Array.isArray(futures) || futures.length === 0) return null;
  return (
    <div className="futures-strip">
      {title && <div className="futures-strip-title">{title}</div>}
      <div className="futures-strip-row">
        {futures.map((f, i) => (
          <div key={i} className="futures-cell">
            <span className="futures-cell-name">{f.label ?? f.product}</span>
            <span className="futures-cell-price">{f.settle.toLocaleString('en-US')}</span>
            <DeltaPill change={f.change} changePct={f.change_pct} />
          </div>
        ))}
      </div>
      <div className="futures-strip-meta">
        CNY/MT · {futures[0]?.date ?? ''} 정산 <SourceChip label="거래소 공식" tone="muted" />
      </div>
    </div>
  );
}

// 국내 전문지 헤드라인 — 제목·날짜·URL은 RSS 원본 그대로 (LLM 미경유)
export function KrNewsList({ items, title = '국내 동향 (전문지 1차 보도)' }: {
  items?: KrNewsItem[] | null; title?: string;
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <SectionCard title={title}>
      <ul className="kr-news-list">
        {items.map((n, i) => (
          <li key={i} className="kr-news-item">
            <a href={n.url} target="_blank" rel="noreferrer" className="kr-news-title">{n.title}</a>
            <span className="kr-news-meta">{n.date} · {n.source}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
