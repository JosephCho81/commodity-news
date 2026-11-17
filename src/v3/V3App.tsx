// src/v3/V3App.tsx — 새 화면(시장 단위 브리핑). /api/get-report 하나만 읽는다(생성 없음).
// 탭: 브리핑 | 세계 동향 | 합금철 | 알루미늄(1차·2차·스크랩) | 가탄제 | 철강 업황. 세계 동향은 get-report 응답의 world(explore.js가 따로 저장)
import { useEffect, useMemo, useState } from 'react';
import './v3.css';

type Series = { key: string; label: string; unit: string; value: number; date: string; d1_pct: number | null; w1_pct: number | null; m1_pct: number | null; y_low: number; y_high: number; y_pos: number; spark: number[] };
type Market = {
  market: string; name: string; direction: 'up' | 'down' | 'flat' | 'mixed';
  metrics: {
    series: Series[];
    krw: { price_pct: number; fx_pct: number; krw_pct: number } | null;
    quarter: { quarter: string; base_date: string; usd_pct: number | null; krw_pct: number | null } | null;
  };
  headline: string | null; now: string[]; why: { region: string; title: string; text: string }[]; impact: { area: string; text: string }[];
  outlook: { view: string | null; watch: string[]; up: string | null; down: string | null };
  error?: string;
};
type ScrapItem = { item: string; grade: string; price: number; change: number };
type Signal = { key: string; group: string; label: string; value: number; unit: string; prev?: number | null; prev_label?: string; yoy?: number; when: string; desc: string };
type Issue = {
  title: string; region: string; category: 'demand' | 'supply' | 'policy' | 'logistics' | 'other'; effect: 'up' | 'down' | 'unclear'; scale: 'large' | 'medium' | 'small';
  markets: string[]; uses: string; published: string; first_seen: string; what: string[]; relation: string; reach: string; outlook: string;
};
type World = { date: string; issues_date: string; signals: Signal[]; issues: Issue[] };
type Report = {
  date: string; generated_at: string; world?: World | null;
  brief: { one_liner: string | null; lead: string | null; common: { title: string; text: string; markets: string[] }[] } | null;
  markets: Record<string, Market>;
  numbers: {
    fx?: { usd_krw?: { rate: number; date: string } };
    lme_al?: { price: string; date: string };
    scrap_kr?: { base_date: string; period_end: string | null; base_lme: number; base_lme_date: string; base_fx: number; base_fx_date: string; items: ScrapItem[] };
    scrap_overseas?: Record<string, { date: string; items: { grade: string; usd_lb: number | null; usd_t: number; change_pct: number | null }[] }>;
    anthracite_customs?: { latest_ym: string; countries: Record<string, { ym: string; tons: number; usd_per_t: number | null }[]> };
  } | null;
};

const TABS: [string, string][] = [['brief', '브리핑'], ['world', '세계 동향'], ['ferro', '합금철'], ['al', '알루미늄'], ['recarb', '가탄제'], ['steel', '철강 업황']];
const SIGNAL_ROWS: [string, string][] = [['ferro', 'ferro'], ['al1', 'al'], ['al2', 'al'], ['recarb', 'recarb'], ['steel', 'steel']];
const DIR_KO: Record<string, string> = { up: '강세', down: '약세', flat: '보합', mixed: '혼조' };
const DIR_ARROW: Record<string, string> = { up: '▲', down: '▼', flat: '─', mixed: '◆' };
const COUNTRY: Record<string, string> = { us: '미국', ca: '캐나다', uk: '영국' };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const won = (n: number) => n.toLocaleString('ko-KR');
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const signClass = (v: number | null | undefined) => (v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const pctText = (v: number | null | undefined) => (v == null ? '─' : `${v > 0 ? '▲' : v < 0 ? '▼' : '─'} ${Math.abs(v).toFixed(2)}%`);
function dateLabel(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  return `${d.replaceAll('-', '.')} (${WEEKDAY[t.getUTCDay()]})`;
}

const md = (d?: string) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '');

// 이어 읽는 문단 — 해설은 한 줄 한 문장으로 끊지 않는다(glove-news 2026-11-17 사용자 결정: "단답형으로 보인다"). 숫자는 굵게.
// 정규식 lookbehind는 구형 iOS Safari에서 구문 오류(앱 전체가 안 뜸)라 쓰지 않는다
const boldNums = (text: string) => text.split(/(\d[\d,]*(?:\.\d+)?\s?%?)/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
function Para({ text, className = 'para' }: { text: string; className?: string }) {
  return <p className={className}>{boldNums(text)}</p>;
}

function readHash() {
  const h = (typeof location !== 'undefined' ? location.hash.slice(1) : '').split('.');
  return { tab: TABS.some(t => t[0] === h[0]) ? h[0] : 'brief', sub: h[1] || 'al1', region: h[2] || 'kr' };
}

// ─── 작은 조각 ───────────────────────────────────────────────────────────────
function DirPill({ dir }: { dir: string }) {
  return <span className={`dir ${dir}`}>{DIR_ARROW[dir]} {DIR_KO[dir]}</span>;
}

function Spark({ values, cls }: { values: number[]; cls: string }) {
  if (!values || values.length < 2) return null;
  const w = 200, h = 34, p = 3;
  const mn = Math.min(...values), mx = Math.max(...values);
  const x = (i: number) => p + (i * (w - 2 * p)) / (values.length - 1);
  const y = (v: number) => h - p - ((v - mn) / (mx - mn || 1)) * (h - 2 * p);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const col = `var(--${cls})`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${x(values.length - 1)} ${h} L${x(0)} ${h} Z`} fill={col} opacity={0.1} />
      <path d={line} fill="none" stroke={col} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.6} fill={col} />
    </svg>
  );
}

function NumCell({ s }: { s: Series }) {
  const cls = signClass(s.w1_pct);
  return (
    <div className="n">
      <div className="n-l">{s.label}</div>
      <div className="n-v">
        <strong className="num">{fmt(s.value)}</strong><span className="u">{s.unit.replace('USD', '달러')}</span>
        <span className={`chg ${cls}`}>{pctText(s.w1_pct)}</span><span className="u">주간</span>
      </div>
      <Spark values={s.spark} cls={cls} />
      <div className="range" aria-label={`1년 범위 중 ${s.y_pos}% 위치`}>
        <div className="range-bar"><div className="range-dot" style={{ left: `${s.y_pos}%` }} /></div>
        <div className="range-t num"><span>1년 최저 {fmt(s.y_low)}</span><span>최고 {fmt(s.y_high)}</span></div>
      </div>
      <div className="n-src">{s.date} · 1일 {pctText(s.d1_pct)} · 1개월 {pctText(s.m1_pct)}</div>
    </div>
  );
}

// 관세청 월간 평균 수입단가 칸 (가탄제)
function CustomsCell({ name, rows }: { name: string; rows: { ym: string; usd_per_t: number | null }[] }) {
  const valid = rows.filter(r => r.usd_per_t);
  if (!valid.length) return null;
  const last = valid[valid.length - 1], prev = valid[valid.length - 2];
  const chg = prev ? +(((last.usd_per_t! - prev.usd_per_t!) / prev.usd_per_t!) * 100).toFixed(2) : null;
  const cls = signClass(chg);
  return (
    <div className="n">
      <div className="n-l">{name}산 무연탄 평균 수입단가 (관세청)</div>
      <div className="n-v">
        <strong className="num">{fmt(last.usd_per_t!)}</strong><span className="u">달러/톤</span>
        {prev && <><span className={`chg ${cls}`}>{pctText(chg)}</span><span className="u">{Number(prev.ym.slice(5))}월 대비</span></>}
      </div>
      <Spark values={valid.map(r => r.usd_per_t!)} cls={cls} />
      <div className="n-src">{last.ym} 통관 기준 · CIF · 전 용도 평균 · 소량 월 제외</div>
    </div>
  );
}

// 분기 시작 전 마지막 거래일 대비 변동 — 입찰이 분기 단위라 직전 입찰 시점의 기준선. 철강 업황은 수요 지표라 달러 기준
function QuarterChg({ m }: { m: Market }) {
  const q = m.metrics.quarter;
  const v = m.market === 'steel' ? q?.usd_pct : q?.krw_pct;
  if (!q || v == null) return null;
  return (
    <span className="qtr">
      <small>{q.quarter.slice(5)} 대비{m.market === 'steel' ? '' : ' (원화)'}</small>
      <b className={`chg ${signClass(v)}`}>{pctText(v)}</b>
    </span>
  );
}

// ─── 시장 패널 ───────────────────────────────────────────────────────────────
function MarketView({ m, extra }: { m: Market; extra?: any }) {
  if (!m || m.error) return <div className="box state">이 시장의 오늘 해석을 만들지 못했습니다. 숫자는 위 표를 참고하세요.</div>;
  const demand = m.market === 'steel';
  return (
    <>
      <div className="box">
        <div className="mkt-head">
          <h1>{m.name}</h1><DirPill dir={m.direction} /><span className="sp" /><QuarterChg m={m} />
          {m.headline && <p>{m.headline}</p>}
        </div>
        <div className="nums">
          {m.metrics.series.map(s => <NumCell key={s.key} s={s} />)}
          {extra}
        </div>
      </div>
      <div className="four">
        <div className="cell"><h3><i>지금</i>어떻게 돌아가나</h3><Para text={m.now.join(' ')} /></div>
        <div className="cell">
          <h3><i>왜</i>원인</h3>
          <div className="causes">
            {m.why.map((w, i) => <div className="cause" key={i}><b><span className="tag">{w.region}</span>{w.title || null}</b><p>{w.text}</p></div>)}
          </div>
        </div>
        <div className="cell">
          <h3><i>영향</i>{demand ? '어떤 원자재 수요에' : '어디에, 어떻게'}</h3>
          {/* 이어 읽는 문단으로 두되 분야(원가·입찰 등)는 문장 앞 태그로 남긴다 */}
          {m.impact.length > 0 && (
            <p className="para">{m.impact.map((x, i) => <span key={i}>{i > 0 && ' '}{x.area && <span className="tag imp-a">{x.area}</span>}{boldNums(x.text)}</span>)}</p>
          )}
          {m.metrics.krw && (
            <div className="krw num">
              <div><small>달러 가격 (주간)</small><strong className={`chg ${signClass(m.metrics.krw.price_pct)}`}>{pctText(m.metrics.krw.price_pct)}</strong></div>
              <div><small>환율 효과</small><strong className={`chg ${signClass(m.metrics.krw.fx_pct)}`}>{pctText(m.metrics.krw.fx_pct)}</strong></div>
              <div><small>원화 구매가</small><strong className={`chg ${signClass(m.metrics.krw.krw_pct)}`}>{pctText(m.metrics.krw.krw_pct)}</strong></div>
            </div>
          )}
        </div>
        <div className="cell">
          <h3><i>전망</i>1~2주</h3>
          {m.outlook.view && <Para className="para view" text={m.outlook.view} />}
          <div className="watch">{m.outlook.watch.map((w, i) => <div className="w" key={i}><b>{i + 1}</b><p>{w}</p></div>)}</div>
          {(m.outlook.up || m.outlook.down) && (
            <div className="scen">
              {m.outlook.up && <div className="s-up"><b>▲ 상방</b>{m.outlook.up}</div>}
              {m.outlook.down && <div className="s-dn"><b>▼ 하방</b>{m.outlook.down}</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── 스크랩 ──────────────────────────────────────────────────────────────────
const STEP = 50;
function DomesticScrap({ n }: { n: Report['numbers'] }) {
  const kr = n?.scrap_kr;
  if (!kr?.items?.length) return <div className="box state">국내 스크랩 고시를 아직 받지 못했습니다.</div>;
  const nowLme = Number(n?.lme_al?.price), nowFx = Number(n?.fx?.usd_krw?.rate);
  const baseIdx = (kr.base_lme * kr.base_fx) / 1000;
  const canCalc = nowLme > 0 && nowFx > 0;
  const f = canCalc ? (nowLme * nowFx) / 1000 / baseIdx : 1;
  const pct = (f - 1) * 100;
  return (
    <div className="box">
      <div className="box-h"><h2>국내 알루미늄 스크랩</h2><small>원/kg{kr.period_end ? ` · ~${kr.period_end.slice(5).replace('-', '/')} 적용` : ''}</small></div>
      {canCalc && (
        <div className="calc">
          <div className="calc-row num">
            <div><small>기준 LME ({kr.base_lme_date?.slice(5)})</small><b>{fmt(kr.base_lme)}</b></div>
            <div><small>기준 환율 ({kr.base_fx_date?.slice(5)})</small><b>{fmt(kr.base_fx)}</b></div>
            <em>→</em>
            <div><small>현재 LME ({n?.lme_al?.date?.slice(5)})</small><b>{fmt(nowLme)}</b></div>
            <div><small>현재 환율</small><b>{fmt(nowFx)}</b></div>
            <em>=</em>
            <div className="calc-res"><small>원화 LME 변동</small><b className={`chg ${signClass(pct)}`}>{pctText(+pct.toFixed(2))}</b></div>
          </div>
          <p>다음 주 예상 = 이번 주 단가 × (현재 LME × 현재 환율) ÷ (기준 LME × 기준 환율), 50원 단위 반올림. 보합 범위는 현재 환율에서 이번 주 단가가 유지되는 LME 구간입니다.</p>
        </div>
      )}
      <div className="tbl-wrap"><table className="num">
        <thead><tr><th>품목</th><th>등급</th><th className="r">이번 주</th><th className="r">전주 대비</th><th className="r">LME 대비</th>{canCalc && <><th className="r">다음 주 예상</th><th className="r">보합 LME 범위</th></>}</tr></thead>
        <tbody>
          {kr.items.map((it, i) => {
            const first = i === 0 || kr.items[i - 1].item !== it.item;
            const exp = Math.round((it.price * f) / STEP) * STEP, diff = exp - it.price;
            const lo = ((it.price - STEP / 2) / it.price) * baseIdx * 1000 / nowFx;
            const hi = ((it.price + STEP / 2) / it.price) * baseIdx * 1000 / nowFx;
            return (
              <tr key={i} className={first && i > 0 ? 'grp' : ''}>
                <td className="item">{first ? it.item : ''}</td><td>{it.grade}</td>
                <td className="r"><b>{won(it.price)}</b></td>
                <td className="r"><span className={`chg ${signClass(it.change)}`}>{it.change ? `${it.change > 0 ? '▲' : '▼'} ${won(Math.abs(it.change))}` : '─'}</span></td>
                <td className="r">{((it.price / baseIdx) * 100).toFixed(1)}%</td>
                {canCalc && <>
                  <td className="r"><b>{won(exp)}</b> <span className={`chg ${signClass(diff)}`}>{diff ? `${diff > 0 ? '▲' : '▼'} ${won(Math.abs(diff))}` : '─'}</span></td>
                  <td className="r">{won(Math.ceil(lo))} ~ {won(Math.floor(hi))}</td>
                </>}
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div className="tbl-note">
        <span>기준일 {kr.base_date} · 국내 매입가 주간 고시 · 차주 입고분 기준, 품질·이물질·수분·운송 조건에 따라 조정될 수 있음</span>
        {canCalc && <span>다음 주 예상은 LME·환율만 반영한 참고 추정입니다.</span>}
      </div>
    </div>
  );
}

function OverseasScrap({ code, n }: { code: string; n: Report['numbers'] }) {
  const g = n?.scrap_overseas?.[code];
  const fx = Number(n?.fx?.usd_krw?.rate);
  if (!g?.items?.length) return <div className="box state">{COUNTRY[code]} 가격을 받지 못했습니다.</div>;
  return (
    <div className="box">
      <div className="box-h"><h2>{COUNTRY[code]} 알루미늄 스크랩</h2><small>{g.date} · 해외 야드 매입가</small></div>
      <div className="tbl-wrap"><table className="num">
        <thead><tr><th>등급</th><th className="r">달러/lb</th><th className="r">달러/톤</th>{fx > 0 && <th className="r">원/kg 환산</th>}<th className="r">전일 대비</th></tr></thead>
        <tbody>
          {g.items.map(it => (
            <tr key={it.grade}>
              <td className="item">{it.grade}</td>
              <td className="r">{it.usd_lb != null ? it.usd_lb.toFixed(2) : '─'}</td>
              <td className="r"><b>{won(it.usd_t)}</b></td>
              {fx > 0 && <td className="r">{won(Math.round((it.usd_t * fx) / 1000))}</td>}
              <td className="r"><span className={`chg ${signClass(it.change_pct)}`}>{pctText(it.change_pct)}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

// ─── 세계 동향 ────────────────────────────────────────────────────────────────
// 신호판(코드가 받은 공식 통계)과 사안 카드(웹 탐색 → 원문 대조 → 작성·검증). 근거 매체·주소는 화면에 내지 않는다
const CATEGORY: Record<Issue['category'], string> = { demand: '수요', supply: '공급', policy: '정책·무역', logistics: '물류', other: '기타' };
const MARKET_TAG: Record<string, string> = { ferro: '합금철', al1: '알루미늄 1차', al2: '알루미늄 2차', recarb: '가탄제', steel: '철강' };
const EFFECT: Record<Issue['effect'], [string, string] | null> = { up: ['up', '▲ 가격 상승 요인'], down: ['down', '▼ 가격 하락 요인'], unclear: null };
const SCALE: Record<Issue['scale'], string> = { large: '영향 큼', medium: '영향 중간', small: '영향 작음' };
const SIGNAL_GROUPS: [string, string][] = [['steel', '철강'], ['alu', '알루미늄'], ['demand', '수요 현장'], ['freight', '운임']];
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

function IssueMeta({ x, date }: { x: Issue; date: string }) {
  const eff = EFFECT[x.effect];
  const days = dayCount(x.first_seen ?? x.published, date);
  return (
    <div className="iss-m">
      <span className="tag">{CATEGORY[x.category]}</span>
      {x.region && <span className="tag">{x.region}</span>}
      {x.markets.map(k => <span key={k} className="tag mk">{MARKET_TAG[k]}</span>)}
      {eff && <span className={`dir ${eff[0]}`}>{eff[1]}</span>}
      <span className="iss-d">{SCALE[x.scale]} · {md(x.published)} 발표{days >= 2 ? ` · ${days}일째` : ''}</span>
    </div>
  );
}

function SignalTile({ s }: { s: Signal }) {
  const pct = s.yoy != null ? s.yoy : s.prev ? +(((s.value - s.prev) / s.prev) * 100).toFixed(2) : null;
  return (
    <div className="ws">
      <div className="n-l">{s.label}</div>
      <div className="n-v"><strong className="num">{fmt(s.value)}</strong>{s.unit && <span className="u">{s.unit}</span>}</div>
      <div className="ws-c num">
        {pct != null && <span className={`chg ${signClass(pct)}`}>{pctText(pct)}</span>}
        <span className="u">{s.yoy != null ? '전년 같은 달 대비' : s.prev != null ? `${s.prev_label} ${fmt(s.prev)}` : ''}</span>
      </div>
      <div className="n-src">{s.when} · {s.desc}</div>
    </div>
  );
}

function SignalBoard({ signals }: { signals: Signal[] }) {
  return (
    <div className="box">
      <div className="box-h"><h2>수요·공급 신호</h2><small>공식 통계</small></div>
      {SIGNAL_GROUPS.map(([g, name]) => {
        const items = signals.filter(s => s.group === g);
        return items.length ? (
          <div className="ws-g" key={g}>
            <div className="ws-gh">{name}</div>
            <div className="ws-grid">{items.map(s => <SignalTile key={s.key} s={s} />)}</div>
          </div>
        ) : null;
      })}
    </div>
  );
}

function IssueCard({ x, date }: { x: Issue; date: string }) {
  const sec = (label: string, text: string) => text && <div className="iss-s"><h4>{label}</h4><Para text={text} /></div>;
  return (
    <article className="cell iss">
      <IssueMeta x={x} date={date} />
      <h3 className="iss-t">{x.title}</h3>
      <Para text={x.what.join(' ')} />
      {sec(x.uses ? `품목과의 관계 · ${x.uses}` : '품목과의 관계', x.relation)}
      {sec('영향 범위', x.reach)}
      {sec('앞으로 예상', x.outlook)}
    </article>
  );
}

function WorldPage({ r }: { r: Report }) {
  const w = r.world;
  if (!w) return <section className="panel"><div className="box state">세계 동향을 아직 불러오지 못했습니다.</div></section>;
  const stale = w.issues_date && w.issues_date !== r.date;
  return (
    <section className="panel">
      <div className="box lead">
        <div className="lbl">세계 동향 · {md(w.issues_date ?? w.date)} 기준{stale ? ' · 오늘 새 사안 없음' : ''}</div>
        <h1>합금철·알루미늄·가탄제·철강을 움직이는 세계의 일</h1>
        <p>품목이 쓰이는 제강·자동차·건설·전력 현장과 생산·무역 길목에서 최근 일어난 일을 원문과 대조해 정리했습니다.</p>
      </div>
      {w.signals.length > 0 && <SignalBoard signals={w.signals} />}
      {w.issues.length ? w.issues.map((x, i) => <IssueCard key={i} x={x} date={r.date} />) : <div className="box state">최근 2주 안에 확인된 사안이 없습니다.</div>}
    </section>
  );
}

// 사안 목록(제목 + 한 문단) — 누르면 세계 동향 탭으로
function IssueList({ label, items, date, go }: { label: string; items: Issue[]; date: string; go: (tab: string) => void }) {
  return (
    <div className="box">
      <div className="box-h"><h2>{label}</h2><small>눌러서 전체 보기</small></div>
      <div className="rel">
        {items.map((x, i) => (
          <button className="rel-row" key={i} onClick={() => go('world')}>
            <IssueMeta x={x} date={date} />
            <div className="rel-t">{x.title}</div>
            <Para className="rel-x" text={[x.what[0], x.outlook].filter(Boolean).join(' ')} />
          </button>
        ))}
      </div>
    </div>
  );
}

// 브리핑 — 영향이 큰 사안부터 3건(생성 단계에서 규모 순으로 정렬돼 온다)
function TopIssues({ r, go }: { r: Report; go: (tab: string) => void }) {
  const items = (r.world?.issues ?? []).slice(0, 3);
  return items.length ? <IssueList label="오늘의 세계 동향" items={items} date={r.date} go={go} /> : null;
}
// 품목 탭 — 그 품목에 닿는 사안
function RelatedIssues({ r, keys, go }: { r: Report; keys: string[]; go: (tab: string) => void }) {
  const items = (r.world?.issues ?? []).filter(x => x.markets.some(k => keys.includes(k))).slice(0, 4);
  return items.length ? <IssueList label="이 품목에 닿는 세계 동향" items={items} date={r.date} go={go} /> : null;
}

// ─── 브리핑 ──────────────────────────────────────────────────────────────────
function Briefing({ r, go }: { r: Report; go: (tab: string, sub?: string) => void }) {
  return (
    <section className="panel">
      {r.brief?.one_liner && (
        <div className="box lead">
          <div className="lbl">오늘의 시장</div>
          <h1>{r.brief.one_liner}</h1>
          {r.brief.lead && <p>{r.brief.lead}</p>}
        </div>
      )}
      <div className="box">
        <div className="box-h"><h2>시장 신호판</h2><small>눌러서 시장별 상세</small></div>
        <div className="sig">
          {SIGNAL_ROWS.map(([id, tab]) => {
            const m = r.markets[id];
            if (!m || m.error) return null;
            const main = m.metrics.series[0];
            return (
              <button className="sig-row" key={id} onClick={() => go(tab, id)}>
                <div className="sig-name-w">
                  <div className="sig-name">{m.name}</div><DirPill dir={m.direction} />
                  {main && <div className="sig-num num">{main.label.replace(/\(.*\)/, '').trim()} {fmt(main.value)} · 주간 {pctText(main.w1_pct)}</div>}
                </div>
                <div className="sig-dir-w"><DirPill dir={m.direction} /></div>
                <div className="sig-text">{m.headline}</div>
                <div className="sig-end"><QuarterChg m={m} /></div>
              </button>
            );
          })}
        </div>
      </div>
      <TopIssues r={r} go={go} />
      {r.brief?.common?.length ? (
        <div className="box">
          <div className="box-h"><h2>공통 요인</h2><small>여러 시장에 동시에 작용</small></div>
          <div className="factors">
            {r.brief.common.map((c, i) => (
              <div className="factor" key={i}>
                <h3>{c.title}</h3><p>{c.text}</p>
                {c.markets?.length > 0 && <div className="tags">{c.markets.map(t => <span className="tag" key={t}>{t}</span>)}</div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ─── 앱 ─────────────────────────────────────────────────────────────────────
export default function V3App() {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [{ tab, sub, region }, setNav] = useState(readHash);

  useEffect(() => {
    const pre = (window as any).__preloadReport as Promise<any> | null;
    (pre ?? fetch('/api/get-report').then(x => (x.ok ? x.json() : null)))
      .then(j => (j && !j.error ? setR(j) : setErr(j?.error ?? '리포트를 불러오지 못했습니다.')))
      .catch(() => setErr('리포트를 불러오지 못했습니다.'));
    const onHash = () => setNav(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: string, s?: string, rg?: string) => {
    const next = { tab: t, sub: s && s !== t ? s : sub, region: rg ?? region };
    history.replaceState(null, '', `${location.pathname}${location.search}#${[next.tab, next.sub, next.region].join('.')}`);
    setNav(next);
    window.scrollTo(0, 0);
  };

  const regions = useMemo(() => ['kr', ...Object.keys(r?.numbers?.scrap_overseas ?? {}).filter(c => COUNTRY[c])], [r]);

  let body: any = null;
  if (err) body = <div className="state">{err}</div>;
  else if (!r) body = <div className="state">불러오는 중…</div>;
  else if (tab === 'brief') body = <Briefing r={r} go={go} />;
  else if (tab === 'world') body = <WorldPage r={r} />;
  else if (tab === 'al') {
    const alSub = ['al1', 'al2', 'scrap'].includes(sub) ? sub : 'al1';
    body = (
      <section className="panel">
        <div className="subtabs" role="tablist" aria-label="알루미늄 구분">
          {[['al1', '1차'], ['al2', '2차'], ['scrap', '스크랩']].map(([id, t]) => (
            <button key={id} role="tab" aria-selected={alSub === id} onClick={() => go('al', id)}>{t}</button>
          ))}
        </div>
        {alSub === 'scrap' ? (
          <>
            <div className="subtabs sub2" role="tablist" aria-label="지역">
              {regions.map(c => (
                <button key={c} role="tab" aria-selected={region === c} onClick={() => go('al', 'scrap', c)}>{c === 'kr' ? '국내' : COUNTRY[c]}</button>
              ))}
            </div>
            {region === 'kr' || !regions.includes(region) ? <DomesticScrap n={r.numbers} /> : <OverseasScrap code={region} n={r.numbers} />}
          </>
        ) : <MarketView m={r.markets[alSub]} />}
        <RelatedIssues r={r} keys={[alSub === 'al1' ? 'al1' : 'al2']} go={go} />
      </section>
    );
  } else if (tab === 'recarb') {
    const c = r.numbers?.anthracite_customs?.countries ?? {};
    body = (
      <section className="panel">
        <MarketView m={r.markets.recarb} extra={<>{c.CN && <CustomsCell name="중국" rows={c.CN} />}{c.RU && <CustomsCell name="러시아" rows={c.RU} />}</>} />
        <RelatedIssues r={r} keys={['recarb']} go={go} />
      </section>
    );
  } else body = <section className="panel"><MarketView m={r.markets[tab]} /><RelatedIssues r={r} keys={[tab]} go={go} /></section>;

  return (
    <div className="v3">
      <div className="top">
        <div className="wrap">
          <header className="hdr">
            <div className="brand"><img src="/logo.png" alt="한국에이원" /><b>한국에이원</b><span>오늘의 원자재</span></div>
            {r && <div className="date num">{dateLabel(r.date)}</div>}
          </header>
          <nav role="tablist" aria-label="시장">
            {TABS.map(([id, t]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)}>{t}</button>)}
          </nav>
        </div>
      </div>
      <main className="wrap">
        {body}
        {r && (
          <footer className="foot">
            <span>가격은 거래소·관세청·공시 원자료, 해석은 AI가 근거 기사로 작성한 뒤 숫자를 원자료와 대조해 검증합니다.</span>
            <span>매일 03:30 갱신 · 마지막 생성 {new Date(r.generated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
          </footer>
        )}
      </main>
    </div>
  );
}
