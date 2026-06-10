import { SectionCard } from './ui';

function KeyIssueCard({ issue }: { issue: any }) {
  if (!issue || !issue.title) return null;
  const hasMeta = issue.published_date || issue.source_name;
  return (
    <div className="key-issue-item">
      <div className="key-issue-title">
        {issue.url
          ? <a href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a>
          : issue.title}
      </div>
      {issue.what && (
        <div className="key-issue-row">
          <span className="key-issue-label ki-what">무슨 일</span>
          <span className="key-issue-text">{issue.what}</span>
        </div>
      )}
      {issue.why && (
        <div className="key-issue-row">
          <span className="key-issue-label ki-why">원인</span>
          <span className="key-issue-text">{issue.why}</span>
        </div>
      )}
      {issue.impact && (
        <div className="key-issue-row">
          <span className="key-issue-label ki-impact">영향</span>
          <span className="key-issue-text">{issue.impact}</span>
        </div>
      )}
      {issue.outlook && (
        <div className="key-issue-row">
          <span className="key-issue-label ki-outlook">전망</span>
          <span className="key-issue-text">{issue.outlook}</span>
        </div>
      )}
      {hasMeta && (
        <div className="key-issue-source">
          {issue.published_date && <span>{issue.published_date} 보도</span>}
          {issue.published_date && issue.source_name && ' · '}
          {issue.source_name && <span>{issue.source_name}</span>}
        </div>
      )}
    </div>
  );
}

export function KeyIssuesSection({ issues }: { issues: any[] }) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const valid = issues.filter(i => i && i.title &&
    !String(i.title).includes('10자 이내') &&
    !String(i.title).includes('예:'));
  if (valid.length === 0) return null;
  return (
    <SectionCard title="오늘의 핵심 이슈" accent="KEY">
      <div className="key-issues-list">
        {valid.map((issue, idx) => (
          <KeyIssueCard key={idx} issue={issue} />
        ))}
      </div>
    </SectionCard>
  );
}
