// 브리핑 홈 위젯 — 가격 스트립(전 품목 결정적 수치) + 신규 이슈 집계
import type { FerroalloyData, AluminumData, RecarburizerData, KeyIssue, MacroEvent, PriceHistoryEntry } from '../types';
import { isValidLmePrice, formatNum } from '../utils/format';
import { SectionCard } from './ui';
import { SourceChip, DeltaPill, Sparkline } from './data-viz';

// 가격 스트립·레일 보드가 공유하는 한 행의 결정적 데이터
export interface PriceRow {
  key: string; name: string; value: string; unit: string;
  change?: number | string | null; changePct?: string | null;
  chip?: string; sparkKey?: string; history?: PriceHistoryEntry[] | null;
}

// 전 품목 가격 셀 구성 로직 — 순수 함수(표시 컴포넌트는 결과만 소비).
// 실소스: ZCE 합금철×2 + LME×1 + DCE 원료탄·코크스×2. 화이트리스트 금지(DCE 탈락 방지).
export function collectPrices(fa?: FerroalloyData, al?: AluminumData, rec?: RecarburizerData):
  { rows: PriceRow[]; fxLine: string | null } {
  const rows: PriceRow[] = [];

  // 브리핑은 USD 단일 통화 — CNY 정산가는 당일 환율로 결정적 환산 (환율 없으면 CNY 그대로)
  const cnyRate = fa?.exchange_rate_cny_usd ?? null;
  const toUsd = (v?: number | null) =>
    typeof v === 'number' && cnyRate ? Math.round(v * cnyRate) : null;
  const cnyCell = (settle: number, change?: number | null) => {
    const u = toUsd(settle);
    return u !== null
      ? { value: u.toLocaleString('en-US'), unit: 'USD', change: toUsd(change) }
      : { value: settle.toLocaleString('en-US'), unit: 'CNY', change };
  };

  if (fa?.fesi?.futures) {
    const f = fa.fesi.futures;
    const c = cnyCell(f.settle, f.change);
    rows.push({ key: 'sf', name: 'FeSi', value: c.value, unit: c.unit,
      change: c.change, changePct: f.change_pct, chip: 'ZCE', sparkKey: 'sf', history: fa._price_history });
  }
  if (fa?.simn?.futures) {
    const f = fa.simn.futures;
    const c = cnyCell(f.settle, f.change);
    rows.push({ key: 'sm', name: 'SiMn', value: c.value, unit: c.unit,
      change: c.change, changePct: f.change_pct, chip: 'ZCE', sparkKey: 'sm', history: fa._price_history });
  }
  if (al?.lme?.price && isValidLmePrice(al.lme.price)) {
    rows.push({ key: 'lme', name: 'LME Al', value: formatNum(al.lme.price) ?? '', unit: 'USD',
      change: al.lme.change, changePct: al.lme.change_pct, chip: 'LME', sparkKey: 'lme', history: al._price_history });
  }
  for (const f of rec?._china_futures ?? []) {
    const c = cnyCell(f.settle, f.change);
    rows.push({ key: f.product ?? (f.label ?? 'f'), name: f.label ?? f.product ?? '', value: c.value,
      unit: c.unit, change: c.change, changePct: f.change_pct, chip: f.exchange });
  }

  const fxLine = fa?.exchange_rate_usd_krw
    ? `USD/KRW ${Math.round(fa.exchange_rate_usd_krw).toLocaleString('ko-KR')}원`
      + (fa.exchange_rate_cny_usd ? ` · CNY/USD ${fa.exchange_rate_cny_usd.toFixed(4)}` : '')
    : null;

  return { rows, fxLine };
}

function PriceStripCell({ name, value, unit, change, changePct, chip, spark }: {
  name: string; value: string; unit: string;
  change?: number | string | null; changePct?: string | null;
  chip?: string; spark?: React.ReactNode;
}) {
  return (
    <div className="brief-cell">
      <span className="brief-cell-name">{name}</span>
      <span className="brief-cell-value">{value}<small> {unit}</small></span>
      <DeltaPill change={change} changePct={changePct} />
      <div className="brief-cell-foot">
        {spark}
        {chip && <SourceChip label={chip} tone="muted" />}
      </div>
    </div>
  );
}

export function PriceStrip({ fa, al, rec }: {
  fa?: FerroalloyData; al?: AluminumData; rec?: RecarburizerData;
}) {
  const { rows, fxLine } = collectPrices(fa, al, rec);
  if (rows.length === 0) return null;
  return (
    <div className="brief-strip">
      <div className="brief-strip-row">
        {rows.map(r => (
          <PriceStripCell key={r.key} name={r.name} value={r.value} unit={r.unit}
            change={r.change} changePct={r.changePct} chip={r.chip}
            spark={r.sparkKey
              ? <Sparkline history={r.history} valueKey={r.sparkKey} width={56} height={16} />
              : undefined} />
        ))}
      </div>
      {fxLine && <div className="brief-strip-meta">{fxLine}</div>}
    </div>
  );
}

// 신규 이슈 집계 — 없으면 "없음"을 떳떳하게 표시 (재탕보다 신뢰)
// 긴급 시황(macro_event)이 있으면 신규 이슈 목록에도 첫 줄로 노출 — 위 카드와 불일치 방지
export function NewIssues({ fa, al, rec, macro, macroUrl }: {
  fa?: FerroalloyData; al?: AluminumData; rec?: RecarburizerData;
  macro?: MacroEvent | null; macroUrl?: string | null;
}) {
  const tagged: Array<{ tag: string; issue: KeyIssue }> = [
    ...(macro?.headline
      ? [{ tag: '긴급', issue: { title: macro.headline, what: macro.what ?? undefined, url: macroUrl ?? undefined } }]
      : []),
    ...(fa?.key_issues ?? []).map(issue => ({ tag: '합금철', issue })),
    ...(al?.lme?.key_issues ?? []).map(issue => ({ tag: '알루미늄', issue })),
    ...(rec?.key_issues ?? []).map(issue => ({ tag: '가탄제', issue })),
  ].filter(t => t.issue?.title && !String(t.issue.title).includes('10자 이내'));

  return (
    <SectionCard title="오늘 신규 이슈">
      {tagged.length === 0 ? (
        <div className="brief-no-news">
          오늘 새로 보도된 핵심 이슈 없음 — 기존 시황은 각 품목 탭 참조
        </div>
      ) : (
        <div className="brief-issue-list">
          {tagged.map(({ tag, issue }, i) => (
            <div key={i} className="brief-issue-item">
              <span className="brief-issue-tag">{tag}</span>
              <div className="brief-issue-body">
                <span className="brief-issue-title">
                  {issue.url
                    ? <a href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a>
                    : issue.title}
                </span>
                {issue.what && <span className="brief-issue-what">{issue.what}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
