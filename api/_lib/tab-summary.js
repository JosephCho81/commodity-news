// api/_lib/tab-summary.js — 브리핑(시황 종합) 탭 모듈
// 각 탭 캐시를 컨텍스트로 주입해 일일 시그널 생성. 가격 스트립은 클라이언트가 조립.

import { getFromFirestore, saveToFirestore } from './firebase.js';
import { getKSTDate, readLatest, fetchPrevDayData } from './cache-store.js';
import { fetchGlobalMacroNews, buildMacroSection } from './macro-news.js';
import { getSummaryPrompt } from '../_prompts/summary.js';

export const recency = 'day';
export const maxTokens = 3500;

async function readTab(token, tabName) {
  const today = await getFromFirestore(token, 'commodity_cache', `${tabName}_${getKSTDate()}`).catch(() => null);
  if (today?.data) return today;
  return readLatest(token, tabName);
}

export async function prefetch(token) {
  let summaryContext = '';
  // 글로벌 매크로 헤드라인 — 결정적 수집 (sonar 검색 의존 제거).
  // 전일 브리핑 — 리스크 국면 전환(갈등→합의 등) 비교 근거.
  const [macro, prevSummary] = await Promise.all([
    fetchGlobalMacroNews().catch(e => { console.warn('[Summary] 매크로 수집 실패:', e.message); return null; }),
    fetchPrevDayData(token, 'summary'),
  ]);
  if (!token) return { summaryContext, macro, prevSummary };
  try {
    const [alData, drData, faData, recData, smData] = await Promise.all([
      readTab(token, 'aluminum'),
      readTab(token, 'dross'),
      readTab(token, 'ferroalloy'),
      readTab(token, 'recarburizer'),
      readTab(token, 'steelmaker'),
    ]);

    summaryContext = '\n\n【오늘 수집된 각 탭 실제 데이터 — 반드시 아래 내용을 기반으로 시그널 작성】\n';

    if (alData?.data) {
      const al = JSON.parse(alData.data);
      summaryContext += `\n[알루미늄]\n`;
      summaryContext += `LME Cash Settlement: ${al.lme?.price ?? 'N/A'} USD/톤 (${al.lme?.date ?? ''})\n`;
      summaryContext += `변동: ${al.lme?.change ?? 'N/A'} USD/톤 (${al.lme?.change_pct ?? ''})\n`;
      summaryContext += `시장현황: ${al.lme?.market_status ?? ''}\n`;
      summaryContext += `전망: ${al.lme?.outlook ?? ''}\n`;
    }

    if (drData?.data) {
      const dr = JSON.parse(drData.data);
      summaryContext += `\n[2차 알루미늄·드로스·탈산제]\n`;
      const hj = dr.headline_judgment ?? {};
      summaryContext += `판단: 원료확보 ${hj.feedstock ?? 'N/A'} · 탈산제수요 ${hj.demand ?? 'N/A'} · 순알 대비 스프레드 ${hj.spread ?? 'N/A'}\n`;
      if (dr.spread?.prim_sec_spread != null) summaryContext += `전해-주조 스프레드: ${dr.spread.prim_sec_spread} CNY/MT (${dr.spread.prim_sec_spread_pct ?? ''})\n`;
      summaryContext += `스크랩: ${dr.scrap?.weekly_summary ?? ''}\n`;
      summaryContext += `종합: ${dr.market_summary ?? ''}\n`;
    }

    if (faData?.data) {
      const fa = JSON.parse(faData.data);
      summaryContext += `\n[합금철]\n`;
      // 브리핑 본문은 USD 단일 통화 — 서버가 환산한 settle_usd/price_usd만 주입 (LLM 환산 금지)
      const futLine = (p, label) => p?.futures
        ? `${label} ZCE 정산: ${p.futures.settle_usd ? `USD ${p.futures.settle_usd}/MT` : '(USD 환산 없음 — 숫자 생략)'} (${p.futures.change_pct ?? ''})\n` : '';
      const spotLine = (p, label) =>
        `${label} 내수: ${p?.price_usd ? `USD ${p.price_usd}/MT` : 'N/A'} ${p?.direction ?? ''}\n`;
      summaryContext += futLine(fa.fesi, 'FeSi') + futLine(fa.simn, 'SiMn');
      summaryContext += spotLine(fa.fesi, 'FeSi') + spotLine(fa.femn, 'FeMn') + spotLine(fa.simn, 'SiMn');
      const faSummaryText = typeof fa.market_summary === 'string'
        ? fa.market_summary
        : [fa.market_summary?.fesi, fa.market_summary?.femn, fa.market_summary?.simn, fa.market_summary?.outlook]
            .filter(Boolean).join(' ');
      summaryContext += `종합: ${faSummaryText}\n`;
    }

    if (recData?.data) {
      const rec = JSON.parse(recData.data);
      summaryContext += `\n[가탄제]\n`;
      summaryContext += `중국: ${rec.china_price?.fob_qinhuangdao ?? rec.china_price?.price_range_text ?? 'N/A'} USD/MT\n`;
      summaryContext += `러시아: ${rec.russia_price?.fob_murmansk ?? rec.russia_price?.price_range_text ?? 'N/A'} USD/MT\n`;
      summaryContext += `종합: ${rec.market_summary ?? ''}\n`;
    }

    if (smData?.data) {
      const sm = JSON.parse(smData.data);
      summaryContext += `\n[제강사]\n`;
      summaryContext += `국내 제강사: ${sm.domestic_makers?.map(m => `${m.name} ${m.direction}`).join(', ') ?? ''}\n`;
    }

    console.log('[Summary] 탭 데이터 주입 완료');
  } catch (e) {
    console.warn('[Summary] 탭 데이터 주입 실패:', e.message);
  }
  return { summaryContext, macro, prevSummary };
}

function buildPrevRiskSection(prevSummary) {
  const risks = prevSummary?.data?.risk_signals;
  if (!Array.isArray(risks) || risks.length === 0) return '';
  let s = `\n\n【어제의 리스크 신호 (${prevSummary.date}) — 오늘 헤드라인과 비교해 국면 전환 여부 판단】\n`;
  for (const r of risks) {
    if (r?.risk) s += `- ${r.risk} (${r.probability ?? ''}): ${String(r.why ?? '').slice(0, 80)}\n`;
  }
  const prevMacro = prevSummary?.data?.macro_event;
  if (prevMacro?.headline) s += `- [어제의 매크로 이벤트] ${prevMacro.headline}\n`;
  return s;
}

export function buildPrompt(ctx) {
  return getSummaryPrompt(getKSTDate())
    + (ctx.summaryContext ?? '')
    + buildMacroSection(ctx.macro)
    + buildPrevRiskSection(ctx.prevSummary);
}

export async function postProcess({ parsed, ctx, token }) {
  // 결정적 가드: 주입된 헤드라인이 없으면 macro_event는 무조건 null — 환각 이벤트 차단
  if (!ctx.macro || ctx.macro.items.length === 0) {
    parsed.macro_event = null;
    return;
  }
  if (parsed.macro_event && !parsed.macro_event.headline) parsed.macro_event = null;
  // UI 출처 표기용 — 충격 판정 증거 헤드라인 (LLM을 거치지 않은 원본)
  if (parsed.macro_event && ctx.macro.analysis.evidence.length > 0) {
    parsed._macro_headlines = ctx.macro.analysis.evidence.slice(0, 4)
      .map(({ title, url, source, date }) => ({ title, url, source, date }));
  }
  // 생성 시점 fingerprint 기록 — 센티널이 같은 이벤트로 중복 갱신하지 않게 한다
  if (token && ctx.macro.analysis.fingerprint) {
    try {
      const st = await getFromFirestore(token, 'commodity_cache', 'macro_state').catch(() => null);
      await saveToFirestore(token, 'commodity_cache', 'macro_state', {
        ...(st ?? {}),
        fingerprint: ctx.macro.analysis.fingerprint,
        updated_at: String(Date.now()),
      });
    } catch (e) {
      console.warn('[Summary] macro_state 기록 실패:', e.message);
    }
  }
}

export function isValid(parsed) {
  return !!(parsed.one_liner && parsed.key_signals?.length > 0);
}

export function newsItems() { return []; } // summary는 뉴스 히스토리 갱신 없음
