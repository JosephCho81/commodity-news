import type { SummaryData } from '../types';
import { directionColor, urgencyBadge } from '../utils/format';
import { SectionCard } from '../components/ui';

export function SummaryTab({ data }: { data: SummaryData }) {
  const { one_liner, key_signals, risk_signals, week_ahead } = data;
  const cleanOneLiner = (one_liner ?? '').replace(/^["'"']+|["'"']+$/g, '').trim();
  const weekAheadList: any[] = Array.isArray(week_ahead) ? week_ahead : [];

  return (
    <div className="tab-content">
      <div className="today-card">
        <div className="today-header">
          <span className="today-label">TODAY</span>
          <span className="today-date">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
        </div>
        {cleanOneLiner ? (
          <div className="today-summary">{cleanOneLiner}</div>
        ) : (
          <div className="today-summary">시장 데이터 수집 중</div>
        )}
        {(key_signals ?? []).length > 0 && (
          <div className="today-signals">
            {(key_signals ?? []).map((s, i) => (
              <div key={i} className="today-signal-item">
                <div className="today-signal-top">
                  <span className="today-signal-name">{s.commodity}</span>
                  <span className="today-signal-arrow" style={{ color: directionColor(s.direction) }}>
                    {s.direction === 'UP' ? '▲' : s.direction === 'DOWN' ? '▼' : '—'}
                  </span>
                  <span className={`signal-urgency urgency-${(s.urgency ?? 'low').toLowerCase()}`}>
                    {urgencyBadge(s.urgency)}
                  </span>
                </div>
                {s.signal && <p className="today-signal-text">{s.signal}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <SectionCard title="주요 리스크 신호" accent="RISK">
        {(risk_signals ?? []).map((r, i) => (
          <div key={i} className="risk-row">
            <div className="risk-header">
              <span className="risk-name">{r.risk}</span>
              <span className={`risk-prob prob-${(r.probability ?? 'low').toLowerCase()}`}>
                {r.probability === 'HIGH' ? '고' : r.probability === 'MEDIUM' ? '중' : '저'}위험
              </span>
            </div>
            {r.affected && <p className="risk-affected">영향: {r.affected}</p>}
            {(r as any).why && (
              <div className="key-issue-row" style={{ marginTop: 6 }}>
                <span className="key-issue-label ki-why">원인</span>
                <span className="key-issue-text">{(r as any).why}</span>
              </div>
            )}
            {r.impact && (
              <div className="key-issue-row">
                <span className="key-issue-label ki-impact">영향</span>
                <span className="key-issue-text">{r.impact}</span>
              </div>
            )}
            {(r as any).outlook && (
              <div className="key-issue-row">
                <span className="key-issue-label ki-outlook">전망</span>
                <span className="key-issue-text">{(r as any).outlook}</span>
              </div>
            )}
          </div>
        ))}
      </SectionCard>

      {weekAheadList.length > 0 && (
        <SectionCard title="이번 주 주목 변수" accent="WATCH">
          <div className="key-issues-list">
            {weekAheadList.map((w, i) => (
              <div key={i} className="key-issue-item">
                <div className="key-issue-title">{w.variable}</div>
                {w.why && (
                  <div className="key-issue-row">
                    <span className="key-issue-label ki-why">주목 이유</span>
                    <span className="key-issue-text">{w.why}</span>
                  </div>
                )}
                {w.expected && (
                  <div className="key-issue-row">
                    <span className="key-issue-label ki-outlook">예상</span>
                    <span className="key-issue-text">{w.expected}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
