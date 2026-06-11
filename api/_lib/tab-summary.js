// api/_lib/tab-summary.js — 브리핑(시황 종합) 탭 모듈
// 각 탭 캐시를 컨텍스트로 주입해 일일 시그널 생성. 가격 스트립은 클라이언트가 조립.

import { getFromFirestore } from './firebase.js';
import { getKSTDate, readLatest } from './cache-store.js';
import { getSummaryPrompt } from '../_prompts/summary.js';

export const recency = 'day';
export const maxTokens = 3000;

async function readTab(token, tabName) {
  const today = await getFromFirestore(token, 'commodity_cache', `${tabName}_${getKSTDate()}`).catch(() => null);
  if (today?.data) return today;
  return readLatest(token, tabName);
}

export async function prefetch(token) {
  let summaryContext = '';
  if (!token) return { summaryContext };
  try {
    const [alData, faData, recData, smData] = await Promise.all([
      readTab(token, 'aluminum'),
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
      summaryContext += `스크랩: ${al.scrap?.weekly_summary ?? ''}\n`;
    }

    if (faData?.data) {
      const fa = JSON.parse(faData.data);
      summaryContext += `\n[합금철]\n`;
      const futLine = (p, label) => p?.futures
        ? `${label} ZCE 정산: CNY ${p.futures.settle}/MT (${p.futures.change_pct ?? ''})\n` : '';
      summaryContext += futLine(fa.fesi, 'FeSi') + futLine(fa.simn, 'SiMn');
      summaryContext += `FeSi 내수: CNY ${fa.fesi?.price_cny ?? 'N/A'}/MT ${fa.fesi?.direction ?? ''}\n`;
      summaryContext += `FeMn 내수: CNY ${fa.femn?.price_cny ?? 'N/A'}/MT ${fa.femn?.direction ?? ''}\n`;
      summaryContext += `SiMn 내수: CNY ${fa.simn?.price_cny ?? 'N/A'}/MT ${fa.simn?.direction ?? ''}\n`;
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
  return { summaryContext };
}

export function buildPrompt(ctx) {
  return getSummaryPrompt(getKSTDate()) + (ctx.summaryContext ?? '');
}

export async function postProcess() { /* 결정적 후처리 없음 */ }

export function isValid(parsed) {
  return !!(parsed.one_liner && parsed.key_signals?.length > 0);
}

export function newsItems() { return []; } // summary는 뉴스 히스토리 갱신 없음
