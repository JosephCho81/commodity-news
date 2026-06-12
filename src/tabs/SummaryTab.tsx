// 브리핑 탭 — 가격 스트립·신규 이슈는 components/BriefingWidgets 참조
import type { SummaryData, FerroalloyData, AluminumData, RecarburizerData } from '../types';
import { directionColor, urgencyBadge } from '../utils/format';
import { SectionCard } from '../components/ui';
import { IssueRow } from '../components/KeyIssues';
import { PriceStrip, NewIssues } from '../components/BriefingWidgets';

export function SummaryTab({ data, allData }: {
  data: SummaryData;
  allData?: Record<string, unknown>;
}) {
  const { one_liner, key_signals, risk_signals, week_ahead, macro_event, _macro_headlines } = data;
  const cleanOneLiner = (one_liner ?? '').replace(/^["'"']+|["'"']+$/g, '').trim();
  const weekAheadList: any[] = Array.isArray(week_ahead) ? week_ahead : [];

  const fa = allData?.ferroalloy as FerroalloyData | undefined;
  const al = allData?.aluminum as AluminumData | undefined;
  const rec = allData?.recarburizer as RecarburizerData | undefined;

  return (
    <div className="tab-content">
      <div className="today-card">
        <div className="today-header">
          <span className="today-label">오늘 브리핑</span>
          <span className="today-date">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
        </div>
        {cleanOneLiner ? (
          <div className="today-summary">{cleanOneLiner}</div>
        ) : (
          <div className="today-summary">시장 데이터 수집 중</div>
        )}
        <PriceStrip fa={fa} al={al} rec={rec} />
      </div>

      {macro_event?.headline && (
        <div className="macro-card">
          <div className="macro-card-badge">긴급 시황</div>
          <div className="macro-card-headline">{macro_event.headline}</div>
          {macro_event.what && <p className="macro-card-what">{macro_event.what}</p>}
          {(macro_event.impacts ?? []).length > 0 && (
            <div className="macro-impacts">
              {(macro_event.impacts ?? []).map((im, i) => (
                <div key={i} className="macro-impact-row">
                  <span className="macro-impact-name">{im.commodity}</span>
                  <span className="macro-impact-arrow" style={{ color: directionColor(im.direction) }}>
                    {im.direction === 'UP' ? '▲' : im.direction === 'DOWN' ? '▼' : '—'}
                  </span>
                  {im.mechanism && <span className="macro-impact-mech">{im.mechanism}</span>}
                </div>
              ))}
            </div>
          )}
          {macro_event.watch && <p className="macro-card-watch">주시: {macro_event.watch}</p>}
          {(_macro_headlines ?? []).length > 0 && (
            <div className="macro-card-sources">
              {(_macro_headlines ?? []).slice(0, 3).map((h, i) => (
                <a key={i} href={h.url} target="_blank" rel="noreferrer" title={h.title}>
                  {h.source ?? '출처'}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <NewIssues fa={fa} al={al} rec={rec} />

      {(key_signals ?? []).length > 0 && (
        <SectionCard title="어제와 달라진 것">
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
        </SectionCard>
      )}

      <SectionCard title="주요 리스크 신호">
        {(risk_signals ?? []).map((r, i) => (
          <div key={i} className="risk-row">
            <div className="risk-header">
              <span className="risk-name">{r.risk}</span>
              <span className={`risk-prob prob-${(r.probability ?? 'low').toLowerCase()}`}>
                {r.probability === 'HIGH' ? '고' : r.probability === 'MEDIUM' ? '중' : '저'}위험
              </span>
            </div>
            {r.affected && <p className="risk-affected">영향: {r.affected}</p>}
            <IssueRow label="원인" cls="ki-why"     text={(r as any).why} />
            <IssueRow label="영향" cls="ki-impact"  text={r.impact} />
            <IssueRow label="전망" cls="ki-outlook" text={(r as any).outlook} />
          </div>
        ))}
      </SectionCard>

      {weekAheadList.length > 0 && (
        <SectionCard title="이번 주 주목 변수">
          <div className="key-issues-list">
            {weekAheadList.map((w, i) => (
              <div key={i} className="key-issue-item">
                <div className="key-issue-title">{w.variable}</div>
                <IssueRow label="주목 이유" cls="ki-why"     text={w.why} />
                <IssueRow label="예상"      cls="ki-outlook" text={w.expected} />
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
