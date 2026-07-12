import { SectionCard } from './ui';

// 라벨 배지 + 본문 한 줄 — 핵심이슈·비중국 생산국·리스크 등 공용 (text 없으면 미렌더)
export function IssueRow({ label, cls, text }: { label: string; cls: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div className="key-issue-row">
      <span className={`key-issue-label ${cls}`}>{label}</span>
      <span className="key-issue-text">{text}</span>
    </div>
  );
}

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
      <IssueRow label="무슨 일" cls="ki-what"    text={issue.what} />
      <IssueRow label="원인"   cls="ki-why"     text={issue.why} />
      <IssueRow label="영향"   cls="ki-impact"  text={issue.impact} />
      <IssueRow label="전망"   cls="ki-outlook" text={issue.outlook} />
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

export function KeyIssuesSection({ issues, className }: { issues: any[]; className?: string }) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const valid = issues.filter(i => i && i.title &&
    !String(i.title).includes('10자 이내') &&
    !String(i.title).includes('예:'));
  if (valid.length === 0) return null;
  return (
    <SectionCard title="오늘의 핵심 이슈" accent="KEY"
      className={'key-issues-card' + (className ? ' ' + className : '')}>
      <div className="key-issues-list">
        {valid.map((issue, idx) => (
          <KeyIssueCard key={idx} issue={issue} />
        ))}
      </div>
    </SectionCard>
  );
}
