// 2차 알루미늄(스크랩·드로스·탈산제) 서브탭 — /api/get-news?tab=dross 를 독립 fetch.
import { useState, useEffect, useCallback } from 'react';
import type { DrossData, DrossNewsItem } from '../types';
import { formatInt } from '../utils/format';
import { SectionCard, TextBlock, LoadingState, ErrorState } from '../components/ui';
import { FuturesStrip, SourceChip, Sparkline } from '../components/data-viz';
import { KeyIssuesSection } from '../components/KeyIssues';

// 한 줄 판단 배지 — 값 없으면 렌더 안 함 (NULL 원칙)
function JudgmentBadge({ label, value, tone }: { label: string; value?: string | null; tone: string }) {
  if (!value) return null;
  return (
    <span className={`dross-judge dross-judge--${tone}`}>
      <em>{label}</em> {value}
    </span>
  );
}

function ScrapLines({ items }: { items?: Array<{ grade: string; price: string }> | null }) {
  const rows = (items ?? []).filter(it => it?.grade && it?.price);
  if (rows.length === 0) return null;
  return (
    <div className="region-price-table">
      {rows.map((r, i) => (
        <div key={i} className="region-price-line">
          <span className="region-price-grade">{r.grade}</span>
          <span className="region-price-value">{r.price}</span>
        </div>
      ))}
    </div>
  );
}

function NewsList({ title, items }: { title: string; items?: DrossNewsItem[] | null }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <SectionCard title={title}>
      <ul className="kr-news-list">
        {items.map((n, i) => (
          <li key={i} className="kr-news-item">
            <a href={n.url} target="_blank" rel="noreferrer" className="kr-news-title">
              {n.category && <span className={`dross-news-tag tag-${n.category}`}>{n.category}</span>}
              {n.title}
            </a>
            <span className="kr-news-meta">{n.date} · {n.source}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function SecondaryAluminumView({ data }: { data: DrossData }) {
  const hj = data.headline_judgment;
  const sp = data.spread;
  const hasJudge = hj && (hj.feedstock || hj.demand || hj.spread);

  return (
    <div className="tab-content">
      {hasJudge && (
        <div className="dross-judge-card">
          <div className="dross-judge-row">
            <JudgmentBadge label="원료확보" value={hj?.feedstock} tone="feed" />
            <JudgmentBadge label="탈산제수요" value={hj?.demand} tone="demand" />
            <JudgmentBadge label="순알 대비" value={hj?.spread} tone="spread" />
          </div>
          {hj?.summary && <p className="dross-judge-summary">{hj.summary}</p>}
        </div>
      )}

      {sp && (sp.lme_usd || sp.primary_shfe || sp.recovery_values?.length > 0) && (
        <SectionCard title="원가·스프레드" accent="SPREAD">
          <div className="dross-spread-grid">
            {sp.lme_usd != null && (
              <div className="dross-spread-cell">
                <span className="dross-spread-k">LME 전해(USD)</span>
                <span className="dross-spread-v">{formatInt(sp.lme_usd)}<small>/MT</small></span>
              </div>
            )}
            {sp.primary_shfe != null && (
              <div className="dross-spread-cell">
                <span className="dross-spread-k">SHFE 전해 1차(CNY)</span>
                <span className="dross-spread-v">{formatInt(sp.primary_shfe)}<small>/MT</small></span>
              </div>
            )}
            {sp.secondary_shfe != null && (
              <div className="dross-spread-cell">
                <span className="dross-spread-k">SHFE 주조 2차(CNY)</span>
                <span className="dross-spread-v">{formatInt(sp.secondary_shfe)}<small>/MT</small></span>
              </div>
            )}
            {sp.prim_sec_spread != null && (
              <div className="dross-spread-cell dross-spread-cell--hl">
                <span className="dross-spread-k">전해-주조 격차</span>
                <span className="dross-spread-v">{formatInt(sp.prim_sec_spread)}<small>CNY/MT {sp.prim_sec_spread_pct ? `(${sp.prim_sec_spread_pct})` : ''}</small></span>
              </div>
            )}
          </div>

          {sp.recovery_values?.length > 0 && (
            <div className="dross-recovery">
              <div className="dross-recovery-head">
                함량별 내재 금속가치 <SourceChip label="가정 (LME×함량%)" tone="muted" />
              </div>
              <div className="dross-recovery-grid">
                {sp.recovery_values.map((rv) => (
                  <div key={rv.grade} className="dross-recovery-cell">
                    <span className="dross-recovery-grade">Al {rv.grade}%</span>
                    <span className="dross-recovery-val">${formatInt(rv.value_usd)}<small>/MT</small></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sp.note && <div className="region-basis-note">※ {sp.note}</div>}
          <Sparkline history={data._price_history} valueKey="secondary" width={120} height={26} />
        </SectionCard>
      )}

      <FuturesStrip futures={data.futures} title="전해(1차) vs 주조(2차) 선물" />

      <KeyIssuesSection issues={data.key_issues ?? []} />

      {data.supply && (data.supply.signal || data.supply.drivers) && (
        <SectionCard title="원료(공급) — 드로스·스크랩 발생" accent="공급">
          {data.supply.signal && <p className="dross-signal">{data.supply.signal}</p>}
          <TextBlock text={data.supply.drivers} />
          {data.supply.outlook && <TextBlock text={data.supply.outlook} />}
        </SectionCard>
      )}

      {data.demand && (data.demand.signal || data.demand.drivers) && (
        <SectionCard title="제품(수요) — 제강사 탈산제" accent="수요">
          {data.demand.signal && <p className="dross-signal">{data.demand.signal}</p>}
          <TextBlock text={data.demand.drivers} />
          {data.demand.outlook && <TextBlock text={data.demand.outlook} />}
        </SectionCard>
      )}

      {data.scrap?.regions && data.scrap.regions.length > 0 && (
        <SectionCard title="알루미늄 스크랩 주간 시황" accent="SCRAP">
          <TextBlock text={data.scrap.weekly_summary} />
          <div className="region-basis-note">※ 각 대륙별 내수 거래가 기준 — 한국 수입 단가 아님</div>
          <div className="region-list">
            {data.scrap.regions.map((r) => (
              <div key={r.region} className="region-item">
                <div className="region-title-row"><span className="region-name">{r.region} 내수가</span></div>
                <ScrapLines items={r.price_items} />
                {r.key_grades && <div className="region-grades-line">{r.key_grades}</div>}
                {r.price_driver && <p className="region-driver">{r.price_driver}</p>}
                {r.flow && <p className="region-flow-text">📦 {r.flow}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {Array.isArray(data.regulation_watch) && data.regulation_watch.length > 0 && (
        <SectionCard title="규제·정책 워치" accent="규제">
          <div className="key-issues-list">
            {data.regulation_watch.map((w, i) => (
              <div key={i} className="key-issue-item">
                <div className="key-issue-title">
                  {w.region && <span className="dross-news-tag tag-규제">{w.region}</span>}
                  {w.url ? <a href={w.url} target="_blank" rel="noreferrer">{w.title}</a> : w.title}
                </div>
                {w.what && <p className="region-driver">{w.what}</p>}
                {w.impact && <p className="region-flow-text">→ {w.impact}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <NewsList title="국내 드로스·탈산제 뉴스" items={data._dross_news_kr} />
      <NewsList title="해외 (중·일·미EU) 뉴스" items={data._dross_news_global} />

      {data.market_summary && (
        <SectionCard title="오늘의 2차 알루미늄 판단" accent="NOW">
          <TextBlock text={data.market_summary} />
        </SectionCard>
      )}
    </div>
  );
}

export function SecondaryAluminumTab() {
  const [data, setData] = useState<DrossData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchDross = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/get-news?tab=dross');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!data && !loading) fetchDross(); }, [fetchDross]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={fetchDross} />;
  if (!data) return null;
  return <SecondaryAluminumView data={data} />;
}
