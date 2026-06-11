// api/_lib/tab-steelmaker.js — 철강 업황(제강사) 탭 모듈

import { saveToFirestore, getFromFirestore } from './firebase.js';
import { isDuplicateNews } from './validate.js';
import { fetchUSDKRWRate } from './exchange-rate.js';
import { fetchZceFutures } from './zce-futures.js';
import { fetchKoreanSteelNews } from './rss-news.js';
import { getKSTDate, fetchPrevDayData, readNewsHistory } from './cache-store.js';
import { getSteelmakerPrompt } from '../_prompts/steelmaker.js';

export const recency = 'week';
export const maxTokens = 4000;

const NO_NEWS = '최근 3일 내 주요 발표 없음';

export async function prefetch(token) {
  const [krwInfo, prev, newsHistory, chainFutures, krNews] = await Promise.all([
    fetchUSDKRWRate(token, { saveToFirestore, getFromFirestore }),
    fetchPrevDayData(token, 'steelmaker'),
    readNewsHistory(token, 'steelmaker'),
    fetchZceFutures(['rb', 'hc', 'i', 'jm', 'j']).catch(() => ({})),
    fetchKoreanSteelNews('steelmaker', 10).catch(() => []),
  ]);
  return { krwInfo, prev, newsHistory, chainFutures, krNews };
}

export function buildPrompt(ctx) {
  let prompt = getSteelmakerPrompt(getKSTDate());

  // 전일 비교 컨텍스트 주입
  if (ctx.prev) {
    const pm = ctx.prev.data;
    prompt += `\n\n【전일 브리핑 (${ctx.prev.date}) — direction·수치 변화 감지용 참고 데이터】\n`;
    if (Array.isArray(pm.domestic_makers)) {
      prompt += `전일 국내 제강사:\n`;
      for (const m of pm.domestic_makers) {
        prompt += `  ${m.name}: ${m.direction} — ${(m.status ?? '').slice(0, 60)}\n`;
      }
    }
    if (Array.isArray(pm.overseas_makers)) {
      prompt += `전일 해외 제강사:\n`;
      for (const m of pm.overseas_makers) {
        prompt += `  ${m.country}: ${m.direction} — ${(m.status ?? '').slice(0, 60)}\n`;
      }
    }
    prompt += `\n[적용 규칙]\n`;
    prompt += `- direction이 전일과 달라진 경우: recent_issues에 "전일 ${ctx.prev.date} 대비 direction 변화" 명시.\n`;
    prompt += `- direction이 동일한 경우: recent_issues에 별도 언급 불필요. status/reason은 오늘 검색 결과 기반으로 독립 작성.\n`;
    prompt += `- "전일 대비 보합" 표현을 status·reason·outlook 필드에 절대 포함하지 말 것.\n`;
  }

  // KRW/USD 환율 주입
  if (ctx.krwInfo?.rate) {
    const krwFormatted = Math.round(ctx.krwInfo.rate).toLocaleString('ko-KR');
    prompt += `\n\n【실시간 환율 데이터 — cost_factors 작성 시 반드시 아래 값 사용】\n`;
    prompt += `USD/KRW: 1 USD = ${krwFormatted}원 (${ctx.krwInfo.date ?? getKSTDate()} 기준, frankfurter.app)\n`;
    prompt += `→ cost_factors에서 환율 언급 시 위 수치 사용. 다른 환율 수치 절대 금지.\n`;
  }

  // 중국 철강 체인 선물 주입 (거래소 공식 수치)
  const futuresList = Object.values(ctx.chainFutures ?? {}).filter(Boolean);
  if (futuresList.length > 0) {
    prompt += `\n\n【중국 철강 체인 선물 정산가 (거래소 공식, ${futuresList[0].date ?? ''}) — 시황 서술 시 이 수치 사용】\n`;
    for (const f of futuresList) {
      prompt += `${f.label}: CNY ${f.settle}/MT (전일比 ${f.change_pct ?? 'N/A'})\n`;
    }
  }

  return prompt;
}

export async function postProcess({ parsed, ctx }) {
  // recent_issues가 최근 7일 보도분과 중복이면 "발표 없음" 처리 (재탕 차단)
  const makers = [...(parsed.domestic_makers ?? []), ...(parsed.overseas_makers ?? [])];
  for (const m of makers) {
    if (m?.recent_issues && m.recent_issues !== NO_NEWS && isDuplicateNews(m.recent_issues, null, ctx.newsHistory)) {
      console.log(`[Dedup] steelmaker recent_issues 중복 → 발표 없음 처리: ${m.name ?? m.country}`);
      m.recent_issues = NO_NEWS;
    }
  }
}

export function isValid(parsed) {
  return !!(parsed.domestic_makers?.length > 0);
}

export function newsItems(parsed, todayKST) {
  return [...(parsed.domestic_makers ?? []), ...(parsed.overseas_makers ?? [])]
    .filter(m => m?.recent_issues && m.recent_issues !== NO_NEWS)
    .map(m => ({ t: m.recent_issues, d: todayKST, u: null, k: m.name ?? m.country ?? null }));
}
