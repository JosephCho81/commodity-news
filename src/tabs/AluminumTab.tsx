import { useState } from 'react';
import type { AluminumData } from '../types';
import { formatNum, isValidLmePrice } from '../utils/format';
import { SectionCard, TextBlock } from '../components/ui';
import { PriceMeta, SourceChip, Sparkline } from '../components/data-viz';
import { KeyIssuesSection } from '../components/KeyIssues';
import { SecondaryAluminumTab } from './SecondaryAluminumTab';

// LME 가격 히어로 — 본문(모바일·태블릿)과 우측 레일(데스크탑)에 이중 렌더
function LmeHero({ data }: { data: AluminumData }) {
  const { lme } = data;
  const isUp = lme.change != null && !String(lme.change).startsWith('-');
  const priceValid = isValidLmePrice(lme.price);

  return (
    <div className="price-hero">
      <div className="price-hero-main">
        <span className="price-hero-label">LME 알루미늄 공식가</span>
        {priceValid
          ? <span className="price-hero-value">{formatNum(lme.price)} <small>USD/MT</small></span>
          : <span className="price-hero-value">2,000~2,800 <small>USD/MT</small></span>
        }
        {lme.change && priceValid && (
          <span className="price-hero-change" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
            전일 대비 {isUp ? '+' : ''}{formatNum(lme.change)} USD/MT
            {lme.change_pct ? ` (${lme.change_pct})` : ''}
          </span>
        )}
      </div>
      {(lme.date || lme.carried_over) && (
        <span className="price-hero-date">
          {lme.date && <>기준: {lme.date}</>}
          {(lme as any).holiday_note && (
            <span className="price-hero-holiday">
              {' · '}{(lme as any).holiday_note}
            </span>
          )}
          {' '}
          {priceValid && lme.source === 'westmetall' && <SourceChip label="LME 공식" />}
          <PriceMeta carriedOver={lme.carried_over} />
        </span>
      )}
      <Sparkline history={data._price_history} valueKey="lme" width={120} height={26} />
    </div>
  );
}

// 1차 알루미늄(LME 신지금) — 기존 LME 시황. 스크랩·드로스는 '2차 알루미늄'으로 분리됨.
function PrimaryAluminumView({ data }: { data: AluminumData }) {
  const { lme } = data;

  return (
    <div className="tab-content tab-layout tc-alu-primary">
      <div className="tab-main">
        <div className="rail-dup"><LmeHero data={data} /></div>

        <KeyIssuesSection issues={(lme as any).key_issues ?? []} />

        <SectionCard title="가격 변동 이유" accent="WHY">
          <TextBlock text={lme.move_reason} />
        </SectionCard>
        <SectionCard title="시장 현황" accent="NOW">
          <TextBlock text={lme.market_status} />
        </SectionCard>
        <SectionCard title="가격 전망" accent="NEXT">
          <TextBlock text={lme.outlook} />
        </SectionCard>
      </div>

      <aside className="tab-rail">
        <LmeHero data={data} />
      </aside>
    </div>
  );
}

export function AluminumTab({ data }: { data: AluminumData }) {
  const [sub, setSub] = useState<'primary' | 'secondary'>('primary');

  return (
    <div>
      <div className="subtab-bar" role="tablist">
        <button
          role="tab"
          className={`subtab ${sub === 'primary' ? 'active' : ''}`}
          onClick={() => setSub('primary')}
        >
          1차 알루미늄
          <span className="subtab-sub">LME 국제시세</span>
        </button>
        <button
          role="tab"
          className={`subtab ${sub === 'secondary' ? 'active' : ''}`}
          onClick={() => setSub('secondary')}
        >
          2차 알루미늄
          <span className="subtab-sub">스크랩·드로스·탈산제</span>
        </button>
      </div>

      {/* 두 서브뷰 상시 마운트 + CSS 숨김 — 토글 시 dross 재fetch 방지(진입당 1회 고정) */}
      <div className={sub === 'primary' ? '' : 'subview-hidden'}>
        <PrimaryAluminumView data={data} />
      </div>
      <div className={sub === 'secondary' ? '' : 'subview-hidden'}>
        <SecondaryAluminumTab />
      </div>
    </div>
  );
}
