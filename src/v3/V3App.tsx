// src/v3/V3App.tsx — 새 화면(시장 단위 브리핑). /api/get-report 하나만 읽는다(생성 없음).
// 탭: 브리핑 | 세계 동향 | 합금철 | 알루미늄(1차·2차·스크랩) | 가탄제 | 철강 업황. 세계 동향은 get-report 응답의 world(explore.js가 따로 저장)
import { useEffect, useMemo, useState } from 'react';
import './v3.css';
import { BAND_COLOR, SIGNAL_ICON, bandArt, heroArt, thumbArt, worldArt } from './art';

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
const Art = ({ html, className }: { html: string; className?: string }) => <div className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
const SecH = ({ title, sub }: { title: string; sub?: string }) => <div className="nl-h"><b>{title}</b>{sub && <small>{sub}</small>}</div>;

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

// 품목 탭 숫자 칸 — 구조가 같은 칸이라 높이를 고정하고 여러 열로 둔다
function NumCell({ s }: { s: Series }) {
  const cls = signClass(s.w1_pct);
  return (
    <div className="mt">
      <div className="nl-k">{s.label}</div>
      <div className="nl-v num">{fmt(s.value)}<small>{s.unit.replace('USD', '달러')}</small><span className={`chg ${cls}`}>1주 {pctText(s.w1_pct)}</span></div>
      <Spark values={s.spark} cls={cls} />
      <div className="rg" aria-label={`1년 범위 중 ${s.y_pos}% 위치`}>
        <div className="rg-bar"><i style={{ left: `${s.y_pos}%` }} /></div>
        <div className="rg-t"><span>1년 최저 {fmt(s.y_low)}</span><span>최고 {fmt(s.y_high)}</span></div>
      </div>
      <div className="mt-src">{s.date} · 1일 {pctText(s.d1_pct)} · 1개월 {pctText(s.m1_pct)}</div>
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
    <div className="mt">
      <div className="nl-k">{name}산 무연탄 평균 수입단가 (관세청)</div>
      <div className="nl-v num">{fmt(last.usd_per_t!)}<small>달러/톤</small>{prev && <span className={`chg ${cls}`}>{Number(prev.ym.slice(5))}월 대비 {pctText(chg)}</span>}</div>
      <Spark values={valid.map(r => r.usd_per_t!)} cls={cls} />
      <div className="mt-src">{last.ym} 통관 기준 · CIF · 전 용도 평균 · 소량 월 제외</div>
    </div>
  );
}

// ─── 시장 패널 ───────────────────────────────────────────────────────────────
// 상단 품목 배너 → 숫자 칸 → 해설(상자 없이 구분선으로 잇는 기사형 한 열)
function MarketView({ m, extra }: { m: Market; extra?: any }) {
  if (!m || m.error) return <div className="box state">이 시장의 오늘 해석을 만들지 못했습니다. 숫자는 위 표를 참고하세요.</div>;
  const steel = m.market === 'steel';
  const q = m.metrics.quarter;
  // 분기 시작 전 마지막 거래일 대비 — 입찰이 분기 단위라 직전 입찰 시점의 기준선. 철강 업황은 수요 지표라 달러 기준
  const qv = steel ? q?.usd_pct : q?.krw_pct;
  return (
    <>
      <div className="tb" style={{ background: BAND_COLOR[m.market] ?? BAND_COLOR.steel }}>
        <div className="tb-t">
          <div className="nl-kick">MARKET · {m.name}</div>
          <h1>{m.headline ?? m.name}</h1>
          <div className="tb-chips">
            <span className={`nl-chip ${m.direction}`}>{DIR_KO[m.direction]}</span>
            {q && qv != null && <span className="tb-q">{q.quarter.slice(5)} 대비{steel ? '' : '(원화)'} <b className={signClass(qv)}>{pctText(qv)}</b></span>}
          </div>
        </div>
        <Art className="tb-art" html={bandArt(m.market)} />
      </div>
      <div className="nl-sec">
        <SecH title="오늘의 숫자" sub="1주 변동 · 1년 범위 · 중국 선물은 달러 환산" />
        <div className="mt-tiles">
          {m.metrics.series.map(s => <NumCell key={s.key} s={s} />)}
          {extra}
        </div>
      </div>
      <article className="nl-sec art">
        <div className="ar"><div className="ar-l"><i>지금</i>어떻게 돌아가나</div><Para text={m.now.join(' ')} /></div>
        {m.why.length > 0 && (
          <div className="ar">
            <div className="ar-l"><i>왜</i>원인</div>
            {m.why.map((w, i) => <div className="cz" key={i}>{w.region && <span className="cz-rg">【{w.region}】</span>}{w.title && <b>{w.title}</b>}<Para text={w.text} /></div>)}
          </div>
        )}
        <div className="ar">
          <div className="ar-l"><i>영향</i>{steel ? '어떤 원자재 수요에' : '어디에, 어떻게'}</div>
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
        <div className="ar">
          <div className="ar-l"><i>전망</i>1~2주</div>
          {m.outlook.view && <Para className="para view" text={m.outlook.view} />}
          {m.outlook.watch.length > 0 && <ol className="wt">{m.outlook.watch.map((w, i) => <li key={i}>{w}</li>)}</ol>}
          {(m.outlook.up || m.outlook.down) && (
            <div className="scen">
              {m.outlook.up && <div className="s-up"><b>▲ 상방</b>{m.outlook.up}</div>}
              {m.outlook.down && <div className="s-dn"><b>▼ 하방</b>{m.outlook.down}</div>}
            </div>
          )}
        </div>
      </article>
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
// 신호판(코드가 받은 공식 통계)과 사안(웹 탐색 → 원문 대조 → 작성·검증). 근거 매체·주소는 화면에 내지 않는다
const CATEGORY: Record<Issue['category'], string> = { demand: '수요', supply: '공급', policy: '정책·무역', logistics: '물류', other: '기타' };
const MARKET_TAG: Record<string, string> = { ferro: '합금철', al1: '알루미늄 1차', al2: '알루미늄 2차', recarb: '가탄제', steel: '철강' };
const EFFECT: Record<Issue['effect'], [string, string] | null> = { up: ['up', '▲ 가격 상승 요인'], down: ['down', '▼ 가격 하락 요인'], unclear: null };
const SCALE: Record<Issue['scale'], string> = { large: '영향 큼', medium: '영향 중간', small: '영향 작음' };
const SIGNAL_GROUPS: [string, string][] = [['steel', '철강'], ['alu', '알루미늄'], ['demand', '수요 현장'], ['freight', '운임']];
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
const signalPct = (s: Signal) => (s.yoy != null ? s.yoy : s.prev ? +(((s.value - s.prev) / s.prev) * 100).toFixed(2) : null);
// 같은 분야 사안이 이어지면 다음 그림을 쓴다(썸네일 반복 줄이기)
function thumbs(items: Issue[]) {
  const seen: Record<string, number> = {};
  return items.map(x => thumbArt(x.category, BAND_COLOR[x.markets[0]] ?? BAND_COLOR.steel, (seen[x.category] = (seen[x.category] ?? -1) + 1)));
}

// 썸네일 카드(브리핑·품목 탭) — 제목 줄 수 고정이라 여러 열로 둬도 높이가 같다
function IssueCards({ items, go }: { items: Issue[]; go: (tab: string) => void }) {
  const art = thumbs(items);
  return (
    <div className="nl-cards">
      {items.map((x, i) => {
        const eff = EFFECT[x.effect];
        return (
          <button className="nl-card" key={i} onClick={() => go('world')}>
            <div className="nl-thumb"><Art html={art[i]} />{eff && <span className={`nl-eff ${eff[0]}`}>{eff[1]}</span>}</div>
            {x.region && <span className="nl-rg">【{x.region}】</span>}
            <h3>{x.title}</h3>
          </button>
        );
      })}
    </div>
  );
}

function IssueArticle({ x, date, art }: { x: Issue; date: string; art: string }) {
  const eff = EFFECT[x.effect];
  const days = dayCount(x.first_seen ?? x.published, date);
  const sec = (label: string, text: string) => text && <div className="is-s"><h4>{label}</h4><Para text={text} /></div>;
  return (
    <article className="is">
      <div className="is-h">
        <Art className="is-th" html={art} />
        <div>
          <div className="is-m">
            <span className="tag">{CATEGORY[x.category]}</span>
            {x.markets.map(k => <span key={k} className="tag mk">{MARKET_TAG[k]}</span>)}
            {eff && <span className={`nl-eff ${eff[0]}`}>{eff[1]}</span>}
          </div>
          {x.region && <span className="nl-rg l">【{x.region}】</span>}
          <h2>{x.title}</h2>
          <div className="is-d">{SCALE[x.scale]} · {md(x.published)} 발표{days >= 2 ? ` · ${days}일째` : ''}</div>
        </div>
      </div>
      <Para text={x.what.join(' ')} />
      {sec(x.uses ? `품목과의 관계 · ${x.uses}` : '품목과의 관계', x.relation)}
      {sec('영향 범위', x.reach)}
      {sec('앞으로 예상', x.outlook)}
    </article>
  );
}

function WorldPage({ r }: { r: Report }) {
  const w = r.world;
  if (!w) return <section className="panel nl"><div className="box state">세계 동향을 아직 불러오지 못했습니다.</div></section>;
  const stale = w.issues_date && w.issues_date !== r.date;
  const banner = worldArt();
  const art = thumbs(w.issues);
  return (
    <section className="panel nl">
      <div className="tb" style={{ background: banner.bg }}>
        <div className="tb-t">
          <div className="nl-kick">WORLD</div>
          <h1>품목을 움직이는 세계의 일</h1>
          <div className="tb-d">{md(w.issues_date ?? w.date)} 기준 · 사안 {w.issues.length}건{stale ? ' · 오늘 새 사안 없음' : ''}</div>
        </div>
        <Art className="tb-art" html={banner.svg} />
      </div>
      {w.signals.length > 0 && (
        <div className="nl-sec">
          <SecH title="수요·공급 신호" sub="공식 통계" />
          {SIGNAL_GROUPS.map(([g, name]) => {
            const items = w.signals.filter(s => s.group === g);
            return items.length ? (
              <div key={g}>
                <div className="sg-h"><Art html={SIGNAL_ICON[g] ?? SIGNAL_ICON.steel} /><b>{name}</b></div>
                <div className="sg">
                  {items.map(s => {
                    const pct = signalPct(s);
                    return (
                      <div className="sg-t" key={s.key}>
                        <div className="nl-k">{s.label}</div>
                        <div className="sg-v">{fmt(s.value)}{s.unit && <small>{s.unit}</small>}</div>
                        <div className="sg-c">{pct != null && <><span className={`chg ${signClass(pct)}`}>{pctText(pct)}</span> {s.yoy != null ? '전년 같은 달 대비' : `${s.prev_label} 대비`}</>}</div>
                        <div className="mt-src">{s.when} · {s.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })}
        </div>
      )}
      <div className="nl-sec">
        <SecH title="사안" sub="최근 2주 · 원문 대조를 통과한 것만" />
        {w.issues.length ? w.issues.map((x, i) => <IssueArticle key={i} x={x} date={r.date} art={art[i]} />) : <div className="state">최근 2주 안에 확인된 사안이 없습니다.</div>}
      </div>
    </section>
  );
}

// 품목 탭 — 그 품목에 닿는 사안
function RelatedIssues({ r, keys, go }: { r: Report; keys: string[]; go: (tab: string) => void }) {
  const items = (r.world?.issues ?? []).filter(x => x.markets.some(k => keys.includes(k))).slice(0, 6);
  return items.length ? <div className="nl-sec"><SecH title="이 품목에 닿는 세계 동향" sub="눌러서 전체 보기" /><IssueCards items={items} go={go} /></div> : null;
}

// ─── 브리핑(뉴스레터풍) ──────────────────────────────────────────────────────
// 상단 그림 → 오늘의 한 사안 → 숫자 6칸 → 품목 띠 → 오늘의 흐름(lead·공통 요인) → 세계 동향 카드 → 신호·지켜볼 것.
// 여러 열로 놓는 칸(숫자·카드)은 높이를 고정해 날마다 글 길이가 달라도 빈 공간이 생기지 않게 한다
const FOOT_SIGNALS = ['steel_world', 'lme_al_stock', 'us_housing'];

function Briefing({ r, go }: { r: Report; go: (tab: string, sub?: string) => void }) {
  const hero = heroArt(r.date);
  const d = new Date(`${r.date}T00:00:00Z`);
  const rows = SIGNAL_ROWS.map(([id, tab]) => ({ id, tab, m: r.markets[id] })).filter(x => x.m && !x.m.error);
  const top = r.world?.issues?.[0];
  const issues = r.world?.issues ?? [];
  const cards = issues.slice(0, issues.length > 1 ? Math.min(6, issues.length - (issues.length % 2)) : 1);
  const signals = r.world?.signals ?? [];
  const foot = [...FOOT_SIGNALS.map(k => signals.find(s => s.key === k)).filter((s): s is Signal => !!s), ...signals.filter(s => !FOOT_SIGNALS.includes(s.key))].slice(0, 3);
  const fx = r.numbers?.fx?.usd_krw;
  return (
    <section className="panel nl">
      <div className="nl-hero" style={{ background: hero.bg }}>
        <div className="nl-hero-t">
          <div className="nl-kick">DAILY BRIEF</div>
          <h1>{(r.brief?.one_liner ?? '오늘의 원자재').split(', ').map((t, i) => <span key={i}>{i > 0 && <br />}{t}</span>)}</h1>
          <div className="nl-hero-d">{d.getUTCMonth() + 1}.{d.getUTCDate()} {WEEKDAY[d.getUTCDay()]}요일</div>
        </div>
        <Art className="nl-hero-art" html={hero.svg} />
      </div>

      {top && (
        <button className="nl-ins" onClick={() => go('world')}>
          <div className="nl-tag">TODAY INSIGHT</div>
          <h2>{top.title}</h2>
          {top.outlook && <Para text={top.outlook} />}
          <span className="nl-go">GO<br />INSIDE<em>→</em></span>
        </button>
      )}

      <div className="nl-sec">
        <SecH title="오늘의 숫자" sub="1주 변동 · 중국 선물은 달러 환산" />
        <div className="nl-tiles">
          {rows.map(({ id, tab, m }) => {
            const s = m.metrics.series[0];
            if (!s) return null;
            const cls = signClass(s.w1_pct);
            return (
              <button className="nl-tile" key={id} onClick={() => go(tab, id)}>
                <div className="nl-k">{m.name} · {s.label.replace(/\(.*\)/, '').trim()}</div>
                <div className="nl-v num">{fmt(s.value)}<small>{s.unit.replace('USD', '달러')}</small></div>
                <div className={`chg ${cls}`}>1주 {pctText(s.w1_pct)}</div>
                <Spark values={s.spark} cls={cls} />
              </button>
            );
          })}
          {fx && (
            <div className="nl-tile">
              <div className="nl-k">원/달러 환율</div>
              <div className="nl-v num">{fmt(fx.rate)}<small>원</small></div>
              <div className="u">{md(fx.date)} 기준</div>
            </div>
          )}
        </div>
      </div>

      <div className="nl-sec">
        <SecH title="품목별 한 줄" sub="누르면 품목 탭으로" />
        <div className="nl-bands">
          {rows.map(({ id, tab, m }) => (
            <button className="nl-band" key={id} style={{ background: BAND_COLOR[id] }} onClick={() => go(tab, id)}>
              <div className="nl-band-n"><b>{m.name}</b><span className={`nl-chip ${m.direction}`}>{DIR_KO[m.direction]}</span></div>
              <i className="nl-band-bar" />
              <p className="nl-band-m">{m.headline}</p>
              <Art className="nl-band-art" html={bandArt(id)} />
            </button>
          ))}
        </div>
      </div>

      {(r.brief?.lead || r.brief?.common?.length) ? (
        <div className="nl-sec">
          <SecH title="오늘의 흐름" sub="여러 시장에 동시에 작용하는 요인" />
          {r.brief?.lead && <Para className="para nl-lead" text={r.brief.lead} />}
          <div className="nl-factors">
            {(r.brief?.common ?? []).map((c, i) => (
              <div className="nl-factor" key={i}>
                <h3>{c.title}</h3><Para text={c.text} />
                {c.markets?.length > 0 && <div className="tags">{c.markets.map(t => <span className="tag" key={t}>{t}</span>)}</div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {cards.length > 0 && (
        <div className="nl-sec">
          <SecH title="세계 동향" sub="눌러서 전체 보기" />
          <IssueCards items={cards} go={go} />
        </div>
      )}

      <div className="nl-foot">
        {foot.length > 0 && (
          <div className="nl-sig">
            {foot.map(s => {
              const pct = s.yoy != null ? s.yoy : s.prev ? +(((s.value - s.prev) / s.prev) * 100).toFixed(2) : null;
              return (
                <div key={s.key}>
                  <Art className="nl-ico" html={SIGNAL_ICON[s.group] ?? SIGNAL_ICON.steel} />
                  <b>{s.label}</b>
                  <div className="nl-sv num">{fmt(s.value)}{s.unit}</div>
                  <small>{s.when}{pct != null && <> · <span className={`chg ${signClass(pct)}`}>{pctText(pct)}</span> {s.yoy != null ? '전년 대비' : `${s.prev_label} 대비`}</>}</small>
                </div>
              );
            })}
          </div>
        )}
        <div className="nl-cal">
          <b>지켜볼 것</b>
          {rows.map(({ id, m }) => m.outlook.watch[0] && (
            <div key={id}><div className="nl-when">{m.name}</div><div className="nl-what">{m.outlook.watch[0]}</div></div>
          ))}
        </div>
      </div>
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
      <section className="panel nl">
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
      <section className="panel nl">
        <MarketView m={r.markets.recarb} extra={<>{c.CN && <CustomsCell name="중국" rows={c.CN} />}{c.RU && <CustomsCell name="러시아" rows={c.RU} />}</>} />
        <RelatedIssues r={r} keys={['recarb']} go={go} />
      </section>
    );
  } else body = <section className="panel nl"><MarketView m={r.markets[tab]} /><RelatedIssues r={r} keys={[tab]} go={go} /></section>;

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
      <main className={r ? 'wrap nl-main' : 'wrap'}>
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
