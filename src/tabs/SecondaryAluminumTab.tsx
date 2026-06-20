// 2차 알루미늄(스크랩·드로스·탈산제) 서브탭 — /api/get-news?tab=dross 를 독립 fetch.
import { useState, useEffect, useCallback } from 'react';
import type { DrossData, ScrapLiveData } from '../types';
import { formatInt } from '../utils/format';
import { SectionCard, TextBlock, LoadingState, ErrorState } from '../components/ui';
import { Sparkline } from '../components/data-viz';
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

// 지역별 라이브 시세 — 미국·중국·일본, 전부 USD(원통화는 작게 병기). 라이브 소스만.
function ScrapLiveSnapshot({ live }: { live: ScrapLiveData }) {
  return (
    <div className="region-list">
      {live.regions.map((r) => (
        <div key={r.region} className="region-item">
          <div className="region-title-row">
            <span className="region-name">{r.region}</span>
            <span className="region-grades-line">{r.source}{r.date ? ` · ${r.date}` : ''}{r.note ? ` · ${r.note}` : ''}</span>
          </div>
          <div className="region-price-table">
            {r.items.map((it, i) => (
              <div key={i} className="region-price-line">
                <span className="region-price-grade">{it.label}</span>
                <span className="region-price-value">
                  ${formatInt(it.usd)}<small>/MT</small>
                  {it.cny != null && <em className="region-price-orig"> CNY {formatInt(it.cny)}</em>}
                  {it.jpy != null && <em className="region-price-orig"> JPY {formatInt(it.jpy)}</em>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
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
            <JudgmentBadge label="1차 대비 2차" value={hj?.spread} tone="spread" />
          </div>
          {hj?.summary && <p className="dross-judge-summary">{hj.summary}</p>}
        </div>
      )}

      {sp && (sp.lme_usd || sp.primary_shfe) && (
        <SectionCard title="1차·2차 알루미늄 가격" accent="가격">
          <div className="dross-spread-grid">
            {sp.lme_usd != null && (
              <div className="dross-spread-cell">
                <span className="dross-spread-k">LME 1차 알루미늄</span>
                <span className="dross-spread-v">${formatInt(sp.lme_usd)}<small>/MT</small></span>
              </div>
            )}
            {sp.primary_shfe != null && (
              <div className="dross-spread-cell">
                <span className="dross-spread-k">SHFE 1차 알루미늄</span>
                <span className="dross-spread-v">{sp.primary_usd != null ? `$${formatInt(sp.primary_usd)}` : `CNY ${formatInt(sp.primary_shfe)}`}<small>/MT</small></span>
                {sp.primary_usd != null && <span className="dross-spread-cny">CNY {formatInt(sp.primary_shfe)}</span>}
              </div>
            )}
            {sp.secondary_shfe != null && (
              <div className="dross-spread-cell">
                <span className="dross-spread-k">SHFE 2차 알루미늄</span>
                <span className="dross-spread-v">{sp.secondary_usd != null ? `$${formatInt(sp.secondary_usd)}` : `CNY ${formatInt(sp.secondary_shfe)}`}<small>/MT</small></span>
                {sp.secondary_usd != null && <span className="dross-spread-cny">CNY {formatInt(sp.secondary_shfe)}</span>}
              </div>
            )}
            {sp.prim_sec_spread != null && (
              <div className="dross-spread-cell dross-spread-cell--hl">
                <span className="dross-spread-k">1차-2차 가격차</span>
                <span className="dross-spread-v">{sp.prim_sec_spread_usd != null ? `$${formatInt(sp.prim_sec_spread_usd)}` : `CNY ${formatInt(sp.prim_sec_spread)}`}<small>/MT {sp.prim_sec_spread_pct ? `(${sp.prim_sec_spread_pct})` : ''}</small></span>
                <span className="dross-spread-cny">{sp.prim_sec_spread_usd != null ? `CNY ${formatInt(sp.prim_sec_spread)} · ` : ''}1차가 2차보다 비싼 폭 · 좁아질수록 2차 강세(원료비 ↑)</span>
              </div>
            )}
          </div>
          {sp.note && <div className="region-basis-note">※ {sp.note}</div>}
          <Sparkline history={data._price_history} valueKey="secondary" width={120} height={26} />
        </SectionCard>
      )}

      {sp && (sp.lme_usd || sp.primary_shfe || sp.prim_sec_spread != null) && (
        <SectionCard title="1차·2차 알루미늄이란?" accent="설명">
          <div className="spread-explain">
            <p><b>1차 알루미늄</b> = 전기분해로 만든 새 알루미늄(고급·비쌈). 탈산제로 쓰면 품질이 가장 안정적.</p>
            <p><b>2차 알루미늄</b> = 스크랩·드로스를 녹여 만든 재생 알루미늄(저렴). 탈산제 원가를 낮춰 줌.</p>
            <p><b>1차-2차 가격차</b> = 1차가 2차보다 비싼 폭. 재생 알루미늄(2차) 원료 시장의 강도를 보여주는 지표.</p>
            <p className="spread-explain-h">시장 읽는 법</p>
            <ul className="spread-explain-list">
              <li><b>1차·2차 가격이 함께 오르면</b> → 알루미늄 시세 전반 상승 국면.</li>
              <li><b>가격차가 좁아지면</b> → 재생 알루미늄(2차)이 신품에 근접 = 재생 원료 강세.</li>
              <li><b>가격차가 벌어지면</b> → 재생이 신품 대비 상대적으로 저렴.</li>
            </ul>
          </div>
        </SectionCard>
      )}

      <KeyIssuesSection issues={data.key_issues ?? []} />

      {data.supply && (data.supply.signal || data.supply.drivers) && (
        <SectionCard title="원료(공급) — 드로스 확보" accent="공급">
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

      {data.scrap?.live && data.scrap.live.regions.length > 0 && (
        <SectionCard title="해외 시세 — 지역별 라이브" accent="SCRAP">
          <TextBlock text={data.scrap.weekly_summary} />
          <ScrapLiveSnapshot live={data.scrap.live} />
          <div className="region-basis-note">※ 전부 USD 환산(원통화 병기) · 무료 라이브 소스만(미국 거래가·중국 SHFE·일본 딜러가) · 유럽은 무료 라이브 도매 부재로 미표시 · 국내 공시가 없음</div>
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
