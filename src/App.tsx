// src/App.tsx — 비철금속 원자재 인텔리전스 앱 (한국에이원 CI 적용)
import { useState, useEffect, useCallback } from 'react';
import type {
  TabId, AluminumData, FerrosiliconData, RecarburizerData, SummaryData
} from './types';
import { TABS } from './types';

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const API_BASE = '/api/get-news';

function formatNum(val: string | null | undefined) {
  if (!val) return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(n)) return String(val);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAge(min: number) {
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

function directionColor(d: string | null | undefined) {
  if (d === 'UP') return 'var(--up)';
  if (d === 'DOWN') return 'var(--down)';
  return 'var(--neutral)';
}

function urgencyBadge(u: string | null | undefined) {
  if (!u) return '참고';
  const map: Record<string, string> = { HIGH: '고위험', MEDIUM: '주의', LOW: '참고' };
  return map[u.toUpperCase()] ?? u;
}

// LME 알루미늄 현실 범위: $1,500 ~ $4,500/톤
function isValidLmePrice(val: string | null | undefined): boolean {
  if (!val) return false;
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(n)) return false;
  return n >= 1500 && n <= 4500;
}

// ─── 서브 컴포넌트들 ──────────────────────────────────────────────────────────

function Logo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="brand-logo-fallback"><span>A1</span></div>;
  }
  return (
    <img
      src="/logo.png"
      alt="한국에이원"
      className="brand-logo"
      onError={() => setFailed(true)}
    />
  );
}

function SectionCard({ title, accent, children }: {
  title: string; accent?: string; children: React.ReactNode;
}) {
  return (
    <div className="section-card">
      <div className="section-header">
        {accent && <span className="section-accent">{accent}</span>}
        <span className="section-title">{title}</span>
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

function TextBlock({ text }: { text: string | null | undefined }) {
  if (!text || String(text).trim().length === 0) return null;
  const cleaned = String(text).replace(/Yuan/g, 'CNY');
  return <p className="text-block">{cleaned}</p>;
}

function SkeletonBlock({ width = '100%', height = 14 }: { width?: string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} />;
}

function LoadingState() {
  return (
    <div className="tab-content">
      {/* 가격 히어로 스켈레톤 */}
      <div className="price-hero">
        <div className="price-hero-main" style={{ gap: 8 }}>
          <SkeletonBlock width="120px" height={10} />
          <SkeletonBlock width="180px" height={28} />
          <SkeletonBlock width="140px" height={12} />
        </div>
      </div>
      {/* 섹션 카드 스켈레톤 3개 */}
      {[1,2,3].map(i => (
        <div key={i} className="section-card">
          <div className="section-header">
            <SkeletonBlock width="60px" height={10} />
            <SkeletonBlock width="100px" height={10} />
          </div>
          <div className="section-body" style={{ gap: 8 }}>
            <SkeletonBlock height={12} />
            <SkeletonBlock width="90%" height={12} />
            <SkeletonBlock width="75%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Watermark() {
  return (
    <div className="watermark" aria-hidden="true">
      <img src="/logo.png" alt="" className="watermark-img" />
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="error-state">
      <p>데이터를 불러오지 못했습니다.</p>
      <button onClick={onRetry} className="retry-btn">다시 시도</button>
    </div>
  );
}

// ─── 탭 콘텐츠: 알루미늄 ──────────────────────────────────────────────────────
function AluminumTab({ data }: { data: AluminumData }) {
  const { lme, scrap } = data;
  const d = data as any;
  const isUp = lme.change != null && !String(lme.change).startsWith('-');
  const priceValid = isValidLmePrice(lme.price);

  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="price-hero-main">
          <span className="price-hero-label">LME 알루미늄 Cash Settlement</span>
          {priceValid
            ? <span className="price-hero-value">{formatNum(lme.price)} <small>USD/톤</small></span>
            : <span className="price-hero-na">가격 확인 중</span>
          }
          {lme.change && priceValid && (
            <span className="price-hero-change" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
              전일 대비 {isUp ? '+' : ''}{formatNum(lme.change)} USD/톤
              {lme.change_pct ? ` (${lme.change_pct})` : ''}
            </span>
          )}
        </div>
        {lme.date && <span className="price-hero-date">기준: {lme.date}</span>}
      </div>

      <SectionCard title="가격 변동 이유" accent="WHY">
        <TextBlock text={lme.move_reason} />
      </SectionCard>
      <SectionCard title="시장 현황" accent="NOW">
        <TextBlock text={lme.market_status} />
      </SectionCard>
      <SectionCard title="가격 전망" accent="NEXT">
        <TextBlock text={lme.outlook} />
      </SectionCard>

      <SectionCard title="알루미늄 스크랩 주간 시황" accent="SCRAP">
        <TextBlock text={scrap.weekly_summary} />
        {(scrap.us_premium || scrap.eu_premium || scrap.japan_premium) && (
          <div className="premium-row">
            <span className="premium-label">P1020A 프리미엄</span>
            <div className="premium-values">
              {scrap.us_premium && <span><em>미국</em> {scrap.us_premium}</span>}
              {scrap.eu_premium && <span><em>유럽</em> {scrap.eu_premium}</span>}
              {scrap.japan_premium && <span><em>일본</em> {scrap.japan_premium}</span>}
            </div>
          </div>
        )}
        <div className="region-list">
          {scrap.regions.map((r) => (
            <div key={r.region} className="region-item">
              <div className="region-title-row">
                <span className="region-name">{r.region}</span>
              </div>
              {r.price_range && r.price_range !== 'null' && (
                <div className="region-price-row">{r.price_range}</div>
              )}
              {r.key_grades && <div className="region-grades-line">{r.key_grades}</div>}
              {r.price_driver && <p className="region-driver">{r.price_driver}</p>}
              {r.flow && <p className="region-flow-text">📦 {r.flow}</p>}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ─── 탭 콘텐츠: 페로실리콘 ────────────────────────────────────────────────────
function FerrosiliconTab({ data }: { data: FerrosiliconData }) {
  const { china_price, china_production, non_china, market_summary, non_china_context, korea_import } = data as any;

  // HBIS 입찰가 우선, 없으면 FOB 월별 가격 fallback
  const hbisBidRaw = china_price.hbis_bid_price ?? null;
  const hbisBid = hbisBidRaw && !String(hbisBidRaw).includes('미확인') ? hbisBidRaw : null;
  const hbisMonth = china_price.hbis_bid_month ?? null;
  const hbisChange = china_price.hbis_bid_change ?? null;
  const hbisChangeDown = hbisChange && String(hbisChange).startsWith('-');

  // FOB fallback — fob_tianjin_monthly
  const m = china_price.fob_tianjin_monthly as any;
  const isValid = (v: any) => v && !String(v).includes('미확인') && !String(v).includes('검색');
  const validEntries = Object.entries(m || {}).filter(([, v]) => isValid(v)).sort(([a], [b]) => b.localeCompare(a));
  const fobLatestVal = validEntries[0]?.[1] as string ?? null;
  const numMatch = fobLatestVal ? fobLatestVal.match(/([\d,]+~[\d,]+)/) : null;
  const fobRange = numMatch ? numMatch[1] : null;

  // FOB fallback2 — china_context 텍스트에서 USD X,XXX~X,XXX 패턴 추출
  const ctxFobMatch = china_price.china_context
    ? String(china_price.china_context).match(/USD\s*([\d,]+[~\-][\d,]+)/)
    : null;
  const ctxFobRange = ctxFobMatch ? ctxFobMatch[1] : null;

  return (
    <div className="tab-content">
      <div className="price-hero">
        <div className="price-hero-main">
          {hbisBid ? (
            <>
              <span className="price-hero-label">HBIS GROUP 페로실리콘 입찰가</span>
              {(() => {
                const raw = String(hbisBid);
                // USD와 CNY 추출
                const usdMatch = raw.match(/USD\s*[약]?\s*([\d,]+)/i);
                const cnyMatch = raw.match(/(?:CNY|Yuan)\s*([\d,]+)/i);
                const usd = usdMatch ? Number(usdMatch[1].replace(/,/g, '')).toLocaleString() : null;
                const cny = cnyMatch ? Number(cnyMatch[1].replace(/,/g, '')).toLocaleString() : null;
                if (usd || cny) {
                  return (
                    <span className="price-hero-value" style={{ fontSize: 20 }}>
                      {usd && `USD ${usd}/톤`}
                      {usd && cny && <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400 }}> (CNY {cny}/톤 · 중국 내수가)</span>}
                      {!usd && cny && `CNY ${cny}/톤`}
                    </span>
                  );
                }
                return <span className="price-hero-value" style={{ fontSize: 16 }}>{raw}</span>;
              })()}
              {hbisChange && (
                <span className="price-hero-change" style={{ color: hbisChangeDown ? 'var(--down)' : 'var(--up)' }}>
                  {String(hbisChange).replace(/Yuan/g, 'CNY')}
                </span>
              )}
              <span className="fsi-hbis-note">※ HBIS Group(중국 2위 철강사) 월별 공식 입찰가 기준</span>
            </>
          ) : fobRange ? (
            <>
              <span className="price-hero-label">페로실리콘 75 FOB 천진항</span>
              <span className="price-hero-value">{fobRange} <small>USD/톤</small></span>
            </>
          ) : ctxFobRange ? (
            <>
              <span className="price-hero-label">페로실리콘 75 FOB 천진항</span>
              <span className="price-hero-value">{ctxFobRange} <small>USD/톤</small></span>
            </>
          ) : (
            <>
              <span className="price-hero-label">페로실리콘 75</span>
              <span className="price-hero-na">가격 확인 중</span>
            </>
          )}
        </div>
        {hbisMonth && (() => {
          const parts = String(hbisMonth).split('-');
          const yr = parts[0] ? parts[0].slice(2) + '년' : '';
          const mo = parts[1] ? parseInt(parts[1]) + '월' : '';
          return <span className="price-hero-date">기준: {yr} {mo}</span>;
        })()}
      </div>

      {/* 중국 시장 맥락 & 전망 */}
      <SectionCard title="중국 시장 현황 및 전망" accent="CTX">
        {china_price.china_context && <TextBlock text={china_price.china_context} />}
        {china_price.china_outlook && (
          <div className="outlook-box">
            <span className="outlook-label">단기 전망</span>
            <p className="outlook-text">{china_price.china_outlook}</p>
          </div>
        )}
      </SectionCard>

      {/* 중국 생산 현황 */}
      <SectionCard title="중국 생산 현황" accent="PROD">
        <TextBlock text={china_production.overall} />
      </SectionCard>

      {/* 비중국 생산국 동향 */}
      <SectionCard title="비중국 생산국 동향" accent="INTL">
        {non_china_context && <div className="non-china-summary"><TextBlock text={non_china_context} /></div>}
        {non_china.map((c) => (
          <div key={c.country} className="country-row">
            <span className="country-name">{c.country}</span>
            {c.producer && <span className="country-producer">{c.producer}</span>}
            <p className="country-status">{c.status}</p>
            {(c as any).price_context && (
              <div className="country-price-tag">💲 {(c as any).price_context}</div>
            )}
            <div className="country-flow-tag">→ {c.export_direction}</div>
          </div>
        ))}
      </SectionCard>

      {/* 시장 종합 및 전망 */}
      <SectionCard title="시장 종합 및 전망" accent="SUM">
        <TextBlock text={market_summary} />
      </SectionCard>
    </div>
  );
}

// ─── 탭 콘텐츠: 가탄제 ────────────────────────────────────────────────────────
// 빈 문자열·null·undefined 모두 걸러내는 헬퍼
function hasText(v: any): boolean {
  return typeof v === 'string' && v.trim().length > 4;
}

function RecarburizerTab({ data }: { data: RecarburizerData }) {
  const d = data as any;
  const cp    = d.china_price      ?? {};
  const rp    = d.russia_price     ?? {};
  const gm    = d.global_market    ?? {};
  const cprod = d.china_production ?? {};
  const rprod = d.russia_production ?? {};
  const af    = d.asia_flows;
  const market_summary: string = d.market_summary ?? '';

  // asia_flows 정규화 (신: { available, flows } / 구: 배열)
  const flowAvailable: boolean = Array.isArray(af) ? af.length > 0 : (af?.available ?? false);
  const flowList: any[] = Array.isArray(af) ? af : (af?.flows ?? []);

  const chinaDown  = cp.change && String(cp.change).startsWith('-');
  const russiaDown = rp.change && String(rp.change).startsWith('-');

  // 중국·러시아 생산 섹션에 표시할 내용이 하나라도 있는지 확인
  const hasChinaProd = hasText(cprod.production_status) || hasText(cprod.cbam_carbon)
    || hasText(cprod.policy) || hasText(cprod.outlook)
    || cprod.annual_output || cprod.annual_consumption || cprod.export_volume;
  const hasRussiaProd = hasText(rprod.production_status) || hasText(rprod.sanctions_impact)
    || hasText(rprod.war_impact) || hasText(rprod.outlook)
    || rprod.annual_output || rprod.export_volume || hasText(rprod.main_importers);

  // price_range_text 우선 표시 (숫자 자동 추출 제거 — 오추출 방지)
  const chinaHint: string | null = null;
  const russiaHint = hasText(rp.vs_china) ? rp.vs_china : null;

  return (
    <div className="tab-content">

      {/* ══ 가격 박스 2개 나란히 ══ */}
      <div className="recab-price-grid">

        {/* 중국 무연탄 */}
        <div className="recab-price-box">
          <div className="recab-price-box-country">🇨🇳 중국 무연탄</div>
          <div className="recab-price-box-main">
            {cp.fob_qinhuangdao
              ? <><span className="recab-price-val">USD {cp.fob_qinhuangdao}/MT</span></>
              : cp.domestic_shanxi
                ? <><span className="recab-price-val">{cp.domestic_shanxi}</span><span className="recab-price-unit"> CNY/MT</span></>
                : hasText(cp.price_range_text)
                  ? <span className="recab-price-val">{cp.price_range_text}</span>
                  : <span className="recab-price-na">—</span>
            }
          </div>
          {!cp.fob_qinhuangdao && !cp.domestic_shanxi && (
            <>
              {hasText(cp.price_range_source) && (
                <div className="recab-price-ref">({cp.price_range_source})</div>
              )}
              {hasText(cp.price_range_note) && (
                <div className="recab-price-note">※ {cp.price_range_note}</div>
              )}
            </>
          )}
          {!cp.fob_qinhuangdao && !cp.domestic_shanxi && !hasText(cp.price_range_text) && chinaHint && (
            <div className="recab-price-ref">※ 시장 보도 참고가</div>
          )}
          {cp.change && (
            <div className="recab-price-change" style={{ color: chinaDown ? 'var(--down)' : 'var(--up)' }}>
              {cp.change}
            </div>
          )}
          <div className="recab-price-tags">
            {cp.fob_qinhuangdao && <span className="recab-tag">FOB 친황다오</span>}
            {cp.cif_korea        && <span className="recab-tag">CIF 한국 {cp.cif_korea}</span>}
            {cp.domestic_shanxi && cp.fob_qinhuangdao && <span className="recab-tag">산시 {cp.domestic_shanxi} CNY</span>}
            {cp.calcined_cac_fob && <span className="recab-tag">CAC {cp.calcined_cac_fob}</span>}
            {cp.date             && <span className="recab-tag-date">{cp.date}</span>}
          </div>
        </div>

        {/* 러시아 안트라사이트 */}
        <div className="recab-price-box recab-price-box--russia">
          <div className="recab-price-box-country">🇷🇺 러시아 안트라사이트</div>
          <div className="recab-price-box-main">
            {rp.fob_murmansk
              ? <><span className="recab-price-val">USD {rp.fob_murmansk}/MT</span></>
              : hasText(rp.price_range_text)
                ? <span className="recab-price-val">{rp.price_range_text}</span>
                : <span className="recab-price-na">—</span>
            }
          </div>
          {!rp.fob_murmansk && (
            <>
              {hasText(rp.price_range_source) && (
                <div className="recab-price-ref recab-price-ref--russia">({rp.price_range_source})</div>
              )}
              {hasText(rp.price_range_note) && (
                <div className="recab-price-note recab-price-note--russia">※ {rp.price_range_note}</div>
              )}
            </>
          )}
          {!rp.fob_murmansk && !hasText(rp.price_range_text) && russiaHint && (
            <div className="recab-price-ref recab-price-ref--russia">{russiaHint}</div>
          )}
          {rp.change && (
            <div className="recab-price-change" style={{ color: russiaDown ? 'var(--down)' : 'var(--up)' }}>
              {rp.change}
            </div>
          )}
          <div className="recab-price-tags">
            {rp.fob_murmansk && <span className="recab-tag">FOB 무르만스크</span>}
            {rp.cif_korea    && <span className="recab-tag">CIF 한국 {rp.cif_korea}</span>}
            {rp.date         && <span className="recab-tag-date">{rp.date}</span>}
          </div>
        </div>
      </div>

      {/* ══ 전세계 시장 상황 ══ */}
      {(hasText(gm.headline) || hasText(gm.current_level) || hasText(gm.key_drivers)) && (
        <SectionCard title="전세계 시장 상황" accent="MKT">
          {hasText(gm.headline) && (
            <div className="recab-headline-box">
              <span className="recab-headline-text">{gm.headline}</span>
            </div>
          )}
          {hasText(gm.current_level) && (
            <div style={{ marginBottom: 8 }}>
              <span className="recab-sub-label">현재 가격 수준</span>
              <TextBlock text={gm.current_level} />
            </div>
          )}
          {hasText(gm.key_drivers) && (
            <div style={{ marginBottom: 8 }}>
              <span className="recab-sub-label">주요 가격 동인</span>
              <TextBlock text={gm.key_drivers} />
            </div>
          )}
          {hasText(gm.outlook) && (
            <div className="outlook-box">
              <span className="outlook-label">단기 전망</span>
              <p className="outlook-text">{gm.outlook}</p>
            </div>
          )}
        </SectionCard>
      )}

      {/* ══ 중국 생산 현황 ══ */}
      {hasChinaProd && (
        <SectionCard title="중국 생산 현황" accent="CHN">
          {(cprod.annual_output || cprod.annual_consumption || cprod.export_volume || cprod.import_volume) && (
            <div className="recab-stat-grid">
              {cprod.annual_output      && <div className="recab-stat-cell"><span className="recab-stat-label">연간 생산량</span><span className="recab-stat-val">{cprod.annual_output}</span></div>}
              {cprod.annual_consumption && <div className="recab-stat-cell"><span className="recab-stat-label">연간 소비량</span><span className="recab-stat-val">{cprod.annual_consumption}</span></div>}
              {cprod.export_volume      && <div className="recab-stat-cell"><span className="recab-stat-label">수출량</span><span className="recab-stat-val">{cprod.export_volume}</span></div>}
              {cprod.import_volume      && <div className="recab-stat-cell"><span className="recab-stat-label">수입량</span><span className="recab-stat-val">{cprod.import_volume}</span></div>}
            </div>
          )}
          {hasText(cprod.production_status) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">생산·채굴 현황</span><TextBlock text={cprod.production_status} /></div>}
          {hasText(cprod.cbam_carbon)       && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">CBAM · 탄소배출권</span><TextBlock text={cprod.cbam_carbon} /></div>}
          {hasText(cprod.policy)            && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">주요 정책</span><TextBlock text={cprod.policy} /></div>}
          {hasText(cprod.outlook) && (
            <div className="outlook-box">
              <span className="outlook-label">생산·수출 전망</span>
              <p className="outlook-text">{cprod.outlook}</p>
            </div>
          )}
        </SectionCard>
      )}

      {/* ══ 러시아 생산 현황 ══ */}
      {hasRussiaProd && (
        <SectionCard title="러시아 생산 현황" accent="RUS">
          {(rprod.annual_output || rprod.export_volume) && (
            <div className="recab-stat-grid">
              {rprod.annual_output  && <div className="recab-stat-cell"><span className="recab-stat-label">연간 생산량</span><span className="recab-stat-val">{rprod.annual_output}</span></div>}
              {rprod.export_volume  && <div className="recab-stat-cell"><span className="recab-stat-label">수출량</span><span className="recab-stat-val">{rprod.export_volume}</span></div>}
            </div>
          )}
          {hasText(rprod.main_importers)    && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">주요 수입국</span><div className="country-price-tag">{rprod.main_importers}</div></div>}
          {hasText(rprod.production_status) && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">생산·채굴 현황</span><TextBlock text={rprod.production_status} /></div>}
          {hasText(rprod.war_impact)        && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">전쟁 영향</span><TextBlock text={rprod.war_impact} /></div>}
          {hasText(rprod.sanctions_impact)  && <div style={{ marginBottom: 8 }}><span className="recab-sub-label">제재 및 수출 루트</span><TextBlock text={rprod.sanctions_impact} /></div>}
          {hasText(rprod.outlook) && (
            <div className="outlook-box">
              <span className="outlook-label">생산·수출 전망</span>
              <p className="outlook-text">{rprod.outlook}</p>
            </div>
          )}
        </SectionCard>
      )}

      {/* ══ 아시아 물동량 흐름 (데이터 있을 때만) ══ */}
      {flowAvailable && flowList.length > 0 && (
        <SectionCard title="아시아 물동량 흐름" accent="FLOW">
          <div className="flow-table">
            <div className="flow-table-header">
              <span>수입국</span><span>주요 공급국</span><span>물량 추이</span><span>단가 동향</span>
            </div>
            {flowList.map((f: any) => (
              <div key={f.importer} className="flow-table-row">
                <span className="flow-importer">{f.importer}</span>
                <span>{f.main_sources}</span>
                <span>{f.volume_trend}</span>
                <span>{f.price_trend}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ══ 시장 종합 의견 ══ */}
      {hasText(market_summary) && (
        <SectionCard title="시장 종합 의견" accent="SUM">
          <TextBlock text={market_summary} />
        </SectionCard>
      )}

      {/* ══ 모든 내용이 비어있을 때 fallback ══ */}
      {!hasChinaProd && !hasRussiaProd && !hasText(gm.headline) && !hasText(market_summary) && (
        <div className="recab-empty-state">
          <div className="recab-empty-icon">◍</div>
          <p className="recab-empty-text">가탄제 시황 데이터를 수집하지 못했습니다.</p>
          <p className="recab-empty-sub">잠시 후 다시 시도해 주세요.</p>
        </div>
      )}
    </div>
  );
}

// ─── 탭 콘텐츠: 시황 종합 ─────────────────────────────────────────────────────
function SummaryTab({ data }: { data: SummaryData }) {
  const { one_liner, key_signals, risk_signals, week_ahead } = data;
  // one_liner에서 따옴표 제거
  const cleanOneLiner = (one_liner ?? '').replace(/^["'"']+|["'"']+$/g, '').trim();

  return (
    <div className="tab-content">
      <div className="one-liner-card">
        <div className="one-liner-label">TODAY</div>
        <div className="one-liner-text">{cleanOneLiner || '시장 데이터 수집 중'}</div>
      </div>

      <SectionCard title="품목별 핵심 시그널" accent="SIGNAL">
        {(key_signals ?? []).map((s, i) => (
          <div key={s.commodity ?? i} className="signal-row">
            <div className="signal-meta">
              <span className="signal-commodity">{s.commodity}</span>
              <span className="signal-dir" style={{ color: directionColor(s.direction) }}>
                {s.direction === 'UP' ? '▲' : s.direction === 'DOWN' ? '▼' : '—'}
              </span>
              <span className={`signal-urgency urgency-${(s.urgency ?? 'low').toLowerCase()}`}>
                {urgencyBadge(s.urgency)}
              </span>
            </div>
            {s.signal && <p className="signal-text">{s.signal}</p>}
          </div>
        ))}
      </SectionCard>

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
            {r.impact && <p className="risk-impact">{r.impact}</p>}
          </div>
        ))}
      </SectionCard>

      {week_ahead && (
        <SectionCard title="이번 주 주목 변수" accent="WATCH">
          <div className="watch-text">{week_ahead}</div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── 메인 앱 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('aluminum');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState<Record<TabId, boolean>>({
    aluminum: false, ferrosilicon: false, recarburizer: false, summary: false,
  });
  const [error, setError] = useState<Record<TabId, boolean>>({
    aluminum: false, ferrosilicon: false, recarburizer: false, summary: false,
  });

  const fetchTab = useCallback(async (tab: TabId) => {
    setLoading(p => ({ ...p, [tab]: true }));
    setError(p => ({ ...p, [tab]: false }));
    try {
      const res = await fetch(`${API_BASE}?tab=${tab}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(p => ({ ...p, [tab]: json }));
    } catch {
      setError(p => ({ ...p, [tab]: true }));
    } finally {
      setLoading(p => ({ ...p, [tab]: false }));
    }
  }, []);

  useEffect(() => {
    if (!data[activeTab] && !loading[activeTab]) {
      fetchTab(activeTab);
    }
  }, [activeTab]);

  const tabData = data[activeTab] as never;
  const isLoading = loading[activeTab];
  const isError = error[activeTab];

  function renderContent() {
    if (isLoading) return <LoadingState />;
    if (isError) return <ErrorState onRetry={() => fetchTab(activeTab)} />;
    if (!tabData) return null;
    switch (activeTab) {
      case 'aluminum':     return <AluminumTab data={tabData as AluminumData} />;
      case 'ferrosilicon': return <FerrosiliconTab data={tabData as FerrosiliconData} />;
      case 'recarburizer': return <RecarburizerTab data={tabData as RecarburizerData} />;
      case 'summary':      return <SummaryTab data={tabData as SummaryData} />;
    }
  }

  const meta = tabData as (AluminumData | null);
  const ageMin = meta?._age_min ?? null;

  // KST 오늘 날짜 (UTC+9)
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 리포트 생성 — 없는 탭 데이터 먼저 fetch 후 생성
  async function generateReport(newTab?: Window | null) {
    const tabs: TabId[] = ['aluminum', 'ferrosilicon', 'recarburizer', 'summary'];
    const currentData = { ...data };

    // 로드 안 된 탭 먼저 fetch
    const missing = tabs.filter(t => !currentData[t] && !loading[t]);
    if (missing.length > 0) {
      await Promise.all(missing.map(async (tab) => {
        try {
          const res = await fetch(`${API_BASE}?tab=${tab}`);
          const json = await res.json();
          if (!json.error) currentData[tab] = json;
        } catch {}
      }));
      setData(currentData);
    }

    const al  = currentData['aluminum']     as any;
    const fsi = currentData['ferrosilicon'] as any;
    const rec = currentData['recarburizer'] as any;
    const sum = currentData['summary']      as any;

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans KR', sans-serif; font-size: 11pt; color: #1a1a1a; background: #fff; }
  .page { max-width: 780px; margin: 0 auto; padding: 40px 48px; }

  /* 헤더 */
  .rpt-header { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 16px; border-bottom: 3px solid #1fa83c; margin-bottom: 28px; }
  .rpt-company { font-size: 13pt; font-weight: 700; color: #1fa83c; letter-spacing: -0.3px; }
  .rpt-title { font-size: 20pt; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; margin-top: 4px; }
  .rpt-date { font-size: 10pt; color: #666; text-align: right; }

  /* 섹션 */
  .rpt-section { margin-bottom: 28px; break-inside: avoid; }
  .rpt-section-title { font-size: 12pt; font-weight: 700; color: #fff; background: #1fa83c; padding: 6px 14px; border-radius: 3px; margin-bottom: 12px; display: inline-block; }
  .rpt-section-body { padding: 0 4px; }

  /* 가격 하이라이트 */
  .rpt-price-box { background: #f2fbf4; border: 1.5px solid #c2eacc; border-radius: 6px; padding: 14px 18px; margin-bottom: 12px; display: flex; align-items: center; gap: 24px; }
  .rpt-price-label { font-size: 9pt; color: #4a6652; font-weight: 500; min-width: 120px; }
  .rpt-price-value { font-size: 16pt; font-weight: 700; color: #177a2c; }
  .rpt-price-change { font-size: 10pt; font-weight: 600; margin-left: 8px; }
  .up { color: #1fa83c; }
  .down { color: #d93b3b; }

  /* 텍스트 */
  .rpt-text { font-size: 10pt; line-height: 1.8; color: #333; margin-bottom: 8px; }
  .rpt-sub-title { font-size: 10pt; font-weight: 700; color: #1fa83c; margin: 10px 0 4px; }

  /* 테이블 */
  .rpt-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
  .rpt-table th { background: #1fa83c; color: #fff; padding: 6px 10px; text-align: left; font-weight: 600; }
  .rpt-table td { padding: 6px 10px; border-bottom: 1px solid #e0eedf; }
  .rpt-table tr:nth-child(even) td { background: #f7fdf8; }

  /* 시그널 */
  .rpt-signal-row { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; border-bottom: 1px solid #e8f3ea; }
  .rpt-signal-row:last-child { border-bottom: none; }
  .rpt-signal-name { font-weight: 700; min-width: 120px; font-size: 10pt; color: #177a2c; }
  .rpt-signal-text { font-size: 10pt; color: #333; line-height: 1.6; flex: 1; }
  .badge { font-size: 8pt; padding: 1px 7px; border-radius: 10px; font-weight: 600; }
  .badge-high { background: #fdf2f2; color: #c0392b; border: 1px solid #c0392b; }
  .badge-medium { background: #fef9f0; color: #e67e22; border: 1px solid #e67e22; }
  .badge-low { background: #f2fbf4; color: #4a6652; border: 1px solid #c2eacc; }

  /* 푸터 */
  .rpt-footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #c2eacc; display: flex; justify-content: space-between; font-size: 8.5pt; color: #999; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 20px 28px; }
  }
  .watermark-wrap {
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none; z-index: 0;
  }
  .watermark-wrap img {
    width: 300px; opacity: 0.04; filter: grayscale(100%);
  }
  .page { position: relative; z-index: 1; }
</style>
</head>
<body>
<div class="watermark-wrap">
  <img src="${window.location.origin}/logo.png" alt="" />
</div>
<div class="page">

  <div class="rpt-header">
    <div>
      <div class="rpt-company">(주)한국에이원</div>
      <div class="rpt-title">오늘의 원자재 시황 브리핑</div>
    </div>
    <div class="rpt-date">기준일: ${todayKST}</div>
  </div>

  ${sum ? `
  <div class="rpt-section">
    <div class="rpt-section-title">▪ 시황 종합</div>
    <div class="rpt-section-body">
      <p class="rpt-text" style="font-weight:600; font-size:11pt; color:#177a2c; margin-bottom:12px;">${sum.one_liner ?? ''}</p>
      ${(sum.key_signals ?? []).map((s: any) => `
        <div class="rpt-signal-row">
          <span class="rpt-signal-name">${s.commodity}</span>
          <span class="rpt-signal-text">${s.signal ?? ''}</span>
          <span class="badge badge-${(s.urgency ?? 'low').toLowerCase()}">${s.urgency === 'HIGH' ? '고위험' : s.urgency === 'MEDIUM' ? '주의' : '참고'}</span>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${al ? `
  <div class="rpt-section">
    <div class="rpt-section-title">▪ LME 알루미늄</div>
    <div class="rpt-section-body">
      <div class="rpt-price-box">
        <span class="rpt-price-label">Cash Settlement</span>
        <span class="rpt-price-value">${al.lme?.price ? Number(al.lme.price).toLocaleString() : '-'} USD/톤</span>
        ${al.lme?.change ? `<span class="rpt-price-change ${String(al.lme.change).startsWith('-') ? 'down' : 'up'}">전일 대비 ${al.lme.change} USD/톤 ${al.lme.change_pct ? `(${al.lme.change_pct})` : ''}</span>` : ''}
        ${al.lme?.date ? `<span style="font-size:9pt;color:#999;margin-left:auto">기준: ${al.lme.date}</span>` : ''}
      </div>
      ${al.lme?.move_reason ? `<div class="rpt-sub-title">가격 변동 이유</div><p class="rpt-text">${al.lme.move_reason}</p>` : ''}
      ${al.lme?.market_status ? `<div class="rpt-sub-title">시장 현황</div><p class="rpt-text">${al.lme.market_status}</p>` : ''}
      ${al.lme?.outlook ? `<div class="rpt-sub-title">가격 전망</div><p class="rpt-text">${al.lme.outlook}</p>` : ''}
      ${al.scrap?.weekly_summary ? `<div class="rpt-sub-title">스크랩 주간 시황</div><p class="rpt-text">${al.scrap.weekly_summary}</p>` : ''}
      ${al.scrap?.regions?.length ? `
        <table class="rpt-table" style="margin-top:10px">
          <thead><tr><th>지역</th><th>주요 등급</th><th>가격 범위</th></tr></thead>
          <tbody>
            ${al.scrap.regions.map((r: any) => `
              <tr>
                <td style="font-weight:600">${r.region}</td>
                <td style="font-size:9pt;color:#555">${r.key_grades ?? ''}</td>
                <td style="font-family:monospace">${r.price_range ?? '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
    </div>
  </div>
  ` : ''}

  ${fsi ? `
  <div class="rpt-section">
    <div class="rpt-section-title">▪ 페로실리콘 75</div>
    <div class="rpt-section-body">
      ${fsi.china_price?.hbis_bid_price ? `
        <div class="rpt-price-box">
          <span class="rpt-price-label">HBIS Group 입찰가</span>
          <span class="rpt-price-value" style="font-size:13pt">${String(fsi.china_price.hbis_bid_price).replace(/Yuan/g,'CNY')}</span>
          ${fsi.china_price?.hbis_bid_change ? `<span class="rpt-price-change ${String(fsi.china_price.hbis_bid_change).startsWith('-') ? 'down' : 'up'}">${String(fsi.china_price.hbis_bid_change).replace(/Yuan/g,'CNY')}</span>` : ''}
        </div>
      ` : ''}
      ${fsi.china_price?.china_context ? `<div class="rpt-sub-title">중국 시장 현황</div><p class="rpt-text">${fsi.china_price.china_context}</p>` : ''}
      ${fsi.china_price?.china_outlook ? `<div class="rpt-sub-title">단기 전망</div><p class="rpt-text">${fsi.china_price.china_outlook}</p>` : ''}
      ${fsi.market_summary ? `<div class="rpt-sub-title">시장 종합</div><p class="rpt-text">${fsi.market_summary}</p>` : ''}
    </div>
  </div>
  ` : ''}

  ${rec ? `
  <div class="rpt-section">
    <div class="rpt-section-title">▪ 가탄제 (안트라사이트)</div>
    <div class="rpt-section-body">
      <div class="rpt-price-box" style="flex-wrap:wrap; gap:16px;">
        <div>
          <div class="rpt-price-label">🇨🇳 중국 무연탄</div>
          <div class="rpt-price-value" style="font-size:13pt">${rec.china_price?.fob_qinhuangdao ? `${rec.china_price.fob_qinhuangdao} USD/MT` : rec.china_price?.price_range_text ?? '-'}</div>
          ${rec.china_price?.price_range_source ? `<div style="font-size:8.5pt;color:#666">(${rec.china_price.price_range_source})</div>` : ''}
        </div>
        <div>
          <div class="rpt-price-label">🇷🇺 러시아 안트라사이트</div>
          <div class="rpt-price-value" style="font-size:13pt">${rec.russia_price?.fob_murmansk ? `${rec.russia_price.fob_murmansk} USD/MT` : rec.russia_price?.price_range_text ?? '-'}</div>
          ${rec.russia_price?.price_range_source ? `<div style="font-size:8.5pt;color:#666">(${rec.russia_price.price_range_source})</div>` : ''}
        </div>
      </div>
      ${rec.global_market?.key_drivers ? `<div class="rpt-sub-title">전세계 시장 상황</div><p class="rpt-text">${rec.global_market.key_drivers}</p>` : ''}
      ${rec.market_summary ? `<div class="rpt-sub-title">시장 종합</div><p class="rpt-text">${rec.market_summary}</p>` : ''}
    </div>
  </div>
  ` : ''}

  <div class="rpt-footer">
    <span>(주)한국에이원 내부 참고용 자료</span>
    <span>LME(westmetall.com) · scrapmonster.com · dokindokin.com · tradingeconomics.com · mysteel.net · Perplexity AI</span>
  </div>

</div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // iOS Safari는 Blob 다운로드 미지원 → 미리 열린 탭에 삽입
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && newTab) {
      newTab.location.href = url;
    } else if (isIOS) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `한국에이원_원자재시황_${todayKST}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="app-header">
          <div className="header-brand">
            <Logo />
            <div className="brand-text">
              <div className="brand-name">오늘의 원자재 뉴스</div>
              <div className="brand-sub">(주)한국에이원</div>
            </div>
          </div>
          <div className="header-actions">
            <button className="report-btn" onClick={async () => {
              // iOS: async 함수 내 window.open은 팝업 차단됨 → 미리 탭 열기
              const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
              let newTab: Window | null = null;
              if (isIOS) newTab = window.open('', '_blank');
              await generateReport(newTab);
            }}>📄 리포트</button>
            <span className="cache-badge">{todayKST}</span>
          </div>
        </header>

        <div className="app-body">
          <main className="app-main">
            <Watermark />
            {renderContent()}
          </main>

          <nav className="bottom-nav">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="nav-label">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

// ─── CSS — 한국에이원 CI 기반 라이트 테마 ────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

  :root {
    --green-primary:  #1fa83c;
    --green-dark:     #177a2c;
    --green-light:    #e8f7ec;
    --green-mid:      #c2eacc;
    --green-subtle:   #f2fbf4;

    --bg:       #f5f8f6;
    --surface:  #ffffff;
    --surface2: #f0f6f2;
    --border:   #d4e8da;
    --border2:  #eaf3ec;

    --text:     #1a2e1f;
    --text2:    #4a6652;
    --text3:    #8aab94;

    --up:       #1fa83c;
    --down:     #d93b3b;
    --neutral:  #7a9485;

    --high:     #c0392b;
    --medium:   #e67e22;
    --low:      #7a9485;

    --mono:     'IBM Plex Mono', monospace;
    --sans:     'Noto Sans KR', sans-serif;

    --shadow-sm: 0 1px 4px rgba(31,168,60,0.07);
    --shadow:    0 2px 12px rgba(31,168,60,0.10);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  .app {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  /* ── 헤더 ── */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--surface);
    border-bottom: 3px solid var(--green-primary);
    position: sticky;
    top: 0;
    z-index: 10;
    box-shadow: var(--shadow-sm);
  }

  .header-brand { display: flex; align-items: center; gap: 10px; }

  .brand-logo { height: 38px; width: auto; object-fit: contain; }

  .brand-logo-fallback {
    height: 38px; width: 38px;
    background: var(--green-primary);
    color: #fff;
    font-family: var(--mono);
    font-size: 14px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    border-radius: 4px; flex-shrink: 0;
  }

  .brand-name { font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .brand-sub  { font-size: 11px; color: var(--green-primary); font-weight: 500; }

  .header-actions { display: flex; align-items: center; }

  .cache-badge {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    background: var(--green-subtle);
    border: 1px solid var(--border);
    padding: 3px 8px;
    border-radius: 20px;
  }

  /* ── 메인 ── */
  .app-body { display: flex; flex-direction: column; flex: 1; }
  .app-main { flex: 1; overflow-y: auto; padding: 14px 14px 84px; }
  .tab-content { display: flex; flex-direction: column; gap: 10px; }

  .report-btn {
    font-family: var(--sans); font-size: 11px; font-weight: 600;
    color: var(--green-primary); background: var(--green-subtle);
    border: 1.5px solid var(--green-mid); border-radius: 4px;
    padding: 4px 10px; cursor: pointer; margin-right: 8px;
    transition: background 0.15s;
  }
  .report-btn:hover { background: var(--green-light); }

  .lme-verify-row { margin-top: 4px; }
  .lme-verify-badge {
    font-family: var(--mono); font-size: 9px;
    padding: 2px 7px; border-radius: 3px; display: inline-block;
  }
  .lme-verify-ok   { background: #e8f7ec; border: 1px solid var(--green-mid); color: var(--green-dark); }
  .lme-verify-warn { background: #fef9f0; border: 1px solid #e67e22; color: #a05c00; }

  /* ── 가격 히어로 ── */
  .price-hero {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 4px solid var(--green-primary);
    padding: 16px;
    border-radius: 0 6px 6px 0;
    box-shadow: var(--shadow-sm);
    display: flex; flex-direction: column; gap: 6px;
  }

  .price-hero-main { display: flex; flex-direction: column; gap: 3px; }

  .price-hero-label {
    font-size: 10px; font-family: var(--mono);
    color: var(--text2); letter-spacing: 1px; text-transform: uppercase;
  }

  .price-hero-value {
    font-size: 24px; font-family: var(--mono);
    font-weight: 500; color: #1a2e1f; letter-spacing: -0.5px; line-height: 1.2;
  }
  .price-hero-value small { font-size: 13px; color: var(--text2); font-weight: 400; margin-left: 4px; }

  .price-hero-na { font-size: 18px; font-family: var(--mono); color: var(--text3); }

  .price-hero-change { font-family: var(--mono); font-size: 12px; font-weight: 500; }
  .price-hero-date   { font-family: var(--mono); font-size: 10px; color: var(--text2); }



  .fsi-hbis-note {
    font-family: var(--mono); font-size: 9px; color: var(--text3);
    margin-top: 2px; display: block;
  }

  .fob-price-tag {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    color: #1a2e1f;
    background: var(--green-mid);
    padding: 2px 8px; border-radius: 3px;
  }
  .non-china-summary {
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border2);
    margin-bottom: 4px;
  }
  .price-hero-sub {
    display: flex; flex-wrap: wrap; gap: 12px;
    font-family: var(--mono); font-size: 11px; color: var(--text);
    padding-top: 6px; border-top: 1px solid var(--border2); margin-top: 2px;
  }

  /* ── 섹션 카드 ── */
  .section-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px; overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .section-header {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border2);
    background: var(--green-subtle);
  }

  .section-accent {
    font-family: var(--mono); font-size: 9px; font-weight: 500;
    color: var(--green-primary); letter-spacing: 1.5px;
    padding: 1px 5px; border: 1px solid var(--green-mid); border-radius: 2px; background: #fff;
  }

  .section-title { font-size: 12px; font-weight: 600; color: var(--text); }
  .section-body  { padding: 14px; display: flex; flex-direction: column; gap: 10px; }

  /* ── 텍스트 / 인포 ── */
  .text-block { font-size: 13px; color: var(--text); line-height: 1.8; }

  .info-row { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border2); }
  .info-row:last-child { border-bottom: none; }
  .info-label { font-family: var(--mono); font-size: 10px; color: var(--text3); min-width: 64px; padding-top: 2px; flex-shrink: 0; }
  .info-value { font-size: 12px; color: var(--text); line-height: 1.6; }

  /* ── 생산 그리드 ── */
  .production-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }

  .prod-region {
    background: var(--green-subtle); border: 1px solid var(--border);
    padding: 10px; border-radius: 4px;
    display: flex; flex-direction: column; gap: 6px;
  }

  .prod-region-name {
    font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--green-primary);
    padding-bottom: 4px; border-bottom: 1px solid var(--green-mid); margin-bottom: 2px;
  }

  /* ── 국가 로우 ── */
  .country-row { border-bottom: 1px solid var(--border2); padding: 10px 0; display: flex; flex-direction: column; gap: 4px; }
  .country-row:last-child { border-bottom: none; }
  .country-header { display: flex; align-items: baseline; gap: 8px; }
  .country-name     { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--green-dark); }
  .country-producer { font-size: 10px; color: var(--text3); }
  .country-status   { font-size: 12px; color: var(--text); line-height: 1.6; }
  .outlook-box {
    background: var(--green-subtle);
    border-left: 3px solid var(--green-primary);
    padding: 10px 12px;
    border-radius: 0 4px 4px 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .outlook-label {
    font-family: var(--mono); font-size: 9px; font-weight: 600;
    color: var(--green-primary); letter-spacing: 1.5px; text-transform: uppercase;
  }
  .outlook-text { font-size: 12px; color: var(--text); line-height: 1.7; }

  .country-price-tag {
    font-family: var(--mono); font-size: 11px;
    color: #1a2e1f; font-weight: 500;
    background: var(--green-subtle);
    border: 1px solid var(--green-mid);
    padding: 3px 8px; border-radius: 3px;
    display: inline-block; margin-top: 2px;
  }

  .country-flow-tag {
    font-family: var(--mono); font-size: 10px; color: var(--green-primary);
    border: 1px solid var(--green-mid); background: var(--green-subtle);
    padding: 2px 7px; display: inline-block; margin-top: 2px; border-radius: 2px;
  }

  /* ── 물동량 테이블 ── */
  .flow-table { display: flex; flex-direction: column; }

  .flow-table-header {
    display: grid; grid-template-columns: 72px 1fr 72px 72px; gap: 6px;
    padding: 6px 0; border-bottom: 2px solid var(--border);
    font-family: var(--mono); font-size: 9px; color: var(--text3);
    letter-spacing: 0.5px; text-transform: uppercase;
  }

  .flow-table-row {
    display: grid; grid-template-columns: 72px 1fr 72px 72px; gap: 6px;
    padding: 8px 0; border-bottom: 1px solid var(--border2);
    font-size: 11px; color: var(--text); align-items: start;
  }
  .flow-table-row:last-child { border-bottom: none; }
  .flow-importer { font-family: var(--mono); font-size: 11px; color: var(--green-primary); font-weight: 600; }

  /* ── ONE-LINER ── */
  .one-liner-card {
    background: var(--green-primary);
    padding: 20px 18px; border-radius: 6px; box-shadow: var(--shadow);
  }
  .one-liner-label { font-family: var(--mono); font-size: 9px; color: rgba(255,255,255,0.6); letter-spacing: 3px; margin-bottom: 8px; }
  .one-liner-text  { font-size: 15px; font-weight: 600; color: #ffffff; line-height: 1.7; }

  /* ── 시그널 ── */
  .signal-row { border-bottom: 1px solid var(--border2); padding: 10px 0; display: flex; flex-direction: column; gap: 4px; }
  .signal-row:last-child { border-bottom: none; }
  .signal-meta { display: flex; align-items: center; gap: 8px; }
  .signal-commodity { font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--green-dark); }
  .signal-dir  { font-family: var(--mono); font-size: 13px; font-weight: 600; }
  .signal-text { font-size: 12px; color: var(--text); line-height: 1.65; }

  .signal-urgency { font-family: var(--mono); font-size: 9px; padding: 1px 6px; margin-left: auto; border-radius: 2px; }
  .urgency-high   { color: var(--high);   border: 1px solid var(--high);   background: #fdf2f2; }
  .urgency-medium { color: var(--medium); border: 1px solid var(--medium); background: #fef9f0; }
  .urgency-low    { color: var(--low);    border: 1px solid var(--border); background: var(--green-subtle); }

  /* ── 리스크 ── */
  .risk-row { border-bottom: 1px solid var(--border2); padding: 10px 0; display: flex; flex-direction: column; gap: 4px; }
  .risk-row:last-child { border-bottom: none; }
  .risk-header   { display: flex; align-items: center; justify-content: space-between; }
  .risk-name     { font-size: 12px; font-weight: 600; color: var(--text); }
  .risk-affected { font-size: 10px; color: var(--text3); font-family: var(--mono); }
  .risk-impact   { font-size: 12px; color: var(--text2); line-height: 1.6; }

  .risk-prob { font-family: var(--mono); font-size: 9px; padding: 1px 6px; border-radius: 2px; }
  .prob-high   { color: var(--high);   border: 1px solid var(--high);   background: #fdf2f2; }
  .prob-medium { color: var(--medium); border: 1px solid var(--medium); background: #fef9f0; }
  .prob-low    { color: var(--low);    border: 1px solid var(--border); background: var(--green-subtle); }

  /* ── 주목 변수 ── */
  .watch-text { font-size: 13px; color: var(--text); line-height: 1.9; white-space: pre-line; }

  /* ── 스켈레톤 ── */
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position: 400px 0; }
  }
  .skeleton {
    border-radius: 4px;
    background: linear-gradient(90deg, #e8f0ea 25%, #d4e8da 50%, #e8f0ea 75%);
    background-size: 800px 100%;
    animation: shimmer 1.4s infinite linear;
    display: block;
  }

  /* ── 워터마크 ── */
  .watermark {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 5;
    user-select: none;
  }
  .watermark-img {
    width: 220px;
    opacity: 0.045;
    filter: grayscale(100%);
  }

  /* ── 로딩 / 에러 ── */
  .loading-state, .error-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; padding: 60px 20px; color: var(--text3); font-family: var(--mono); font-size: 12px;
  }
  .loading-spinner {
    width: 26px; height: 26px;
    border: 2px solid var(--green-mid); border-top-color: var(--green-primary);
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .retry-btn {
    background: var(--green-primary); border: none; color: #fff;
    font-family: var(--mono); font-size: 11px; padding: 7px 18px; cursor: pointer; border-radius: 4px;
  }

  /* ── 프리미엄 ── */
  .premium-row {
    background: var(--green-subtle); border: 1px solid var(--border);
    padding: 10px 12px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px;
  }
  .premium-label { font-family: var(--mono); font-size: 9px; color: var(--text3); letter-spacing: 1px; text-transform: uppercase; }
  .premium-values { display: flex; flex-wrap: wrap; gap: 16px; }
  .premium-values span { font-family: var(--mono); font-size: 12px; color: var(--green-dark); font-weight: 500; }
  .premium-values em  { font-style: normal; color: var(--text3); font-size: 10px; margin-right: 4px; }

  /* ── 지역 리스트 ── */
  .region-list { display: flex; flex-direction: column; }
  .region-item {
    padding: 14px 0;
    border-bottom: 1px solid var(--border2);
    display: flex; flex-direction: column; gap: 6px;
  }
  .region-item:last-child { border-bottom: none; }

  .region-title-row {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--green-mid);
    margin-bottom: 2px;
  }
  .region-name {
    font-family: var(--mono); font-size: 13px; font-weight: 700;
    color: var(--green-dark);
    letter-spacing: 0.5px;
  }
  .region-price-row {
    font-family: var(--mono); font-size: 12px;
    color: #1a2e1f; font-weight: 600;
    background: var(--green-subtle);
    border: 1px solid var(--green-mid);
    padding: 5px 10px;
    border-radius: 3px;
    line-height: 1.6;
  }
  .region-grades-line {
    font-family: var(--mono); font-size: 10px;
    color: var(--text3);
    padding: 2px 0;
  }
  .region-driver { font-size: 12px; color: var(--text); line-height: 1.75; }
  .region-flow-text { font-size: 11px; color: var(--text2); line-height: 1.6; }

  .recab-empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 48px 20px; gap: 10px; color: var(--text3);
  }
  .recab-empty-icon { font-size: 32px; opacity: 0.4; }
  .recab-empty-text { font-size: 14px; font-weight: 600; color: var(--text2); }
  .recab-empty-sub  { font-family: var(--mono); font-size: 11px; color: var(--text3); }

  .recab-price-note {
    font-size: 10px; color: var(--text3); line-height: 1.5;
    font-family: var(--sans); margin-top: 2px;
  }
  .recab-price-note--russia { color: #7a78a8; }

  .recab-price-range-text {
    font-size: 11px; color: var(--text2); line-height: 1.5;
    font-family: var(--sans); margin-top: 4px;
    background: var(--green-subtle); border: 1px solid var(--border);
    border-radius: 4px; padding: 6px 8px;
  }

  .recab-price-ref {
    font-size: 10px; color: var(--text3); line-height: 1.5;
    font-family: var(--sans); margin-top: 2px;
  }
  .recab-price-ref--russia {
    font-size: 10px; color: #7a78a8; line-height: 1.5;
    font-family: var(--sans); margin-top: 2px;
  }

  /* ── 가탄제 가격 2박스 ── */
  .recab-price-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    margin-bottom: 12px;
  }
  .recab-price-box {
    background: #ffffff;
    border: 1.5px solid var(--green-mid);
    border-radius: 8px;
    padding: 14px 12px 12px;
    display: flex; flex-direction: column; gap: 4px;
    box-shadow: var(--shadow);
  }
  .recab-price-box--russia {
    border-color: #d0cfe8;
    background: #fafafe;
  }
  .recab-price-box-country {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    color: var(--text3); letter-spacing: 0.5px; margin-bottom: 2px;
  }
  .recab-price-box-main {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px;
  }
  .recab-price-val {
    font-family: var(--mono); font-size: 20px; font-weight: 700;
    color: var(--green-dark); line-height: 1.2;
  }
  .recab-price-unit {
    font-family: var(--mono); font-size: 11px; color: var(--text3);
  }
  .recab-price-na {
    font-family: var(--mono); font-size: 13px; color: var(--text3);
  }
  .recab-price-change {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
  }
  .recab-price-tags {
    display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
  }
  .recab-tag {
    font-family: var(--mono); font-size: 9px;
    background: var(--green-subtle); border: 1px solid var(--green-mid);
    color: var(--green-dark); padding: 2px 6px; border-radius: 3px;
  }
  .recab-tag--diff {
    background: #f0eeff; border-color: #c8c4e8; color: #5548a0;
  }
  .recab-tag-date {
    font-family: var(--mono); font-size: 9px; color: var(--text3);
    padding: 2px 4px;
  }

  /* ── 가탄제 서브라벨 ── */
  .recab-sub-label {
    display: block;
    font-family: var(--mono); font-size: 9px; font-weight: 600;
    color: var(--green-primary); letter-spacing: 1.2px; text-transform: uppercase;
    margin-bottom: 4px;
  }

  /* ── 가탄제 헤드라인 박스 ── */
  .recab-headline-box {
    background: var(--green-primary);
    border-radius: 5px; padding: 12px 14px; margin-bottom: 12px;
  }
  .recab-headline-text {
    font-size: 13px; font-weight: 600; color: #ffffff; line-height: 1.65;
  }

  /* ── 가탄제 통계 그리드 ── */
  .recab-stat-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    margin-bottom: 12px;
  }
  .recab-stat-cell {
    background: var(--green-subtle); border: 1px solid var(--border);
    border-radius: 5px; padding: 9px 10px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .recab-stat-label {
    font-family: var(--mono); font-size: 9px; color: var(--text3); letter-spacing: 0.3px;
  }
  .recab-stat-val {
    font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--green-dark);
    line-height: 1.4;
  }

  /* ── 가탄제 전용 (구 스타일 유지) ── */
  .recab-region-row {
    padding: 10px 0;
    border-bottom: 1px solid var(--border2);
    display: flex; flex-direction: column; gap: 4px;
  }
  .recab-region-row:last-child { border-bottom: none; }

  .recab-region-header {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid var(--green-mid);
    margin-bottom: 2px;
  }

  .recab-util-badge {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    color: var(--green-primary); border: 1px solid var(--green-mid);
    background: var(--green-subtle); padding: 1px 7px; border-radius: 10px;
  }

  .recab-proc-box {
    background: var(--green-subtle);
    border-left: 3px solid var(--green-primary);
    padding: 10px 12px;
    border-radius: 0 4px 4px 0;
    display: flex; flex-direction: column; gap: 4px;
    margin-top: 4px;
  }

  .recab-kr-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    margin-bottom: 10px;
  }
  .recab-kr-cell {
    background: var(--green-subtle); border: 1px solid var(--border);
    border-radius: 4px; padding: 8px 10px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .recab-kr-label { font-family: var(--mono); font-size: 9px; color: var(--text3); letter-spacing: 0.5px; }
  .recab-kr-value { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--green-dark); }

  /* ── 바텀 네비 ── */
  .bottom-nav {
    display: flex;
    background: #f0f6f2;
    border-top: 2px solid var(--green-primary);
    position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
    width: 100%; max-width: 480px; z-index: 10;
    box-shadow: 0 -2px 12px rgba(31,168,60,0.10);
  }

  .nav-tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 14px 4px; background: none; border: none;
    color: #8aab94; cursor: pointer;
    transition: color 0.15s, background 0.15s;
    gap: 3px; position: relative;
  }
  .nav-tab::after {
    content: ''; position: absolute;
    top: -2px; left: 15%; right: 15%; height: 3px;
    background: var(--green-primary); transform: scaleX(0);
    transition: transform 0.2s; border-radius: 0 0 3px 3px;
  }
  .nav-tab.active { color: var(--green-primary); background: #e4f2e8; }
  .nav-tab.active::after { transform: scaleX(1); }

  .nav-label { font-size: 13px; font-family: var(--sans); font-weight: 600; color: inherit; letter-spacing: -0.2px; }

  /* ── 스크롤바 ── */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--green-mid); border-radius: 2px; }

  /* ── 반응형 ── */
  @media (max-width: 360px) {
    .production-grid { grid-template-columns: 1fr; }
    .flow-table-header, .flow-table-row { grid-template-columns: 58px 1fr 58px 58px; }
  }

  /* ── PC 반응형 (768px 이상) ── */
  @media (min-width: 768px) {
    .app {
      max-width: 100%;
      min-height: 100dvh;
    }

    /* 헤더 */
    .app-header {
      padding: 14px 40px;
    }
    .brand-logo { height: 44px; }
    .brand-name { font-size: 18px; }
    .brand-sub  { font-size: 13px; }
    .report-btn { font-size: 13px; padding: 6px 16px; }
    .cache-badge { font-size: 12px; }

    /* 전체 레이아웃: 사이드탭 + 콘텐츠 */
    .app-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* 사이드 탭바 */
    .bottom-nav {
      position: sticky;
      top: 0;
      left: 0;
      bottom: auto;
      transform: none;
      width: 180px;
      max-width: 180px;
      min-height: calc(100dvh - 72px);
      flex-direction: column;
      border-top: none;
      border-right: 2px solid var(--green-primary);
      box-shadow: 2px 0 12px rgba(31,168,60,0.08);
      padding: 16px 0;
      background: var(--surface);
      align-items: stretch;
    }

    .nav-tab {
      flex: none;
      padding: 16px 20px;
      align-items: flex-start;
      justify-content: flex-start;
      border-radius: 0;
    }
    .nav-tab::after {
      top: 15%; bottom: 15%;
      left: -2px; right: auto;
      width: 3px; height: auto;
      transform: scaleY(0);
      border-radius: 0 3px 3px 0;
    }
    .nav-tab.active::after { transform: scaleY(1); }
    .nav-label { font-size: 15px; }

    /* 메인 콘텐츠 */
    .app-main {
      flex: 1;
      padding: 24px 40px 40px;
      overflow-y: auto;
      max-width: 860px;
    }

    /* 콘텐츠 2컬럼 그리드 */
    .tab-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      align-items: start;
    }

    /* 가격 히어로는 항상 전체 너비 */
    .price-hero {
      grid-column: 1 / -1;
    }

    /* 가탄제 가격 그리드 전체 너비 */
    .recab-price-grid {
      grid-column: 1 / -1;
    }

    /* 시황종합 시그널은 전체 너비 */
    .section-card:first-of-type {
      grid-column: 1 / -1;
    }

    .price-hero-value { font-size: 32px; }
    .section-card { font-size: 14px; }
  }

  /* ── 와이드 PC (1200px 이상) ── */
  @media (min-width: 1200px) {
    .app-main { max-width: 1100px; }
    .bottom-nav { width: 200px; max-width: 200px; }
    .nav-label { font-size: 16px; }
  }
`;

