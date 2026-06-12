// api/_lib/ferroalloy-tab.js — 합금철 탭 핸들러 (3품목 멀티콜 + 결정적 가격 계층)
// 주 가격 = ZCE 거래소 정산가(FeSi=SF, SiMn=SM), 내수 현물(Perplexity)은 검증·이월 후 참고용.

import { callPerplexity, parseJSON } from './perplexity.js';
import { toNumber, dedupKeyIssues, attachSourceMeta, stripUncertaintyDeep } from './validate.js';
import { prefetchFerroalloy, callFerroProducts, parseProduct } from './ferro-fetch.js';
import { validateSpotPrices, attachFuturesAndBaseline, applyConversions } from './ferro-pricing.js';
import {
  getKSTDate, saveNewsHistory, issuesToHistory, savePriceHistory, readLatest, saveWithLatest,
} from './cache-store.js';
import { getFerroalloySummaryPrompt } from '../_prompts/ferroalloy-summary.js';

export async function handleFerroalloyTab(token, res) {
  const todayKST = getKSTDate();

  // 1. 사전 데이터 수집 (환율·전일·히스토리·ZCE·RSS·시계열+백필 — ferro-fetch.js)
  const ctx = await prefetchFerroalloy(token);
  const { newsHistory, zce, krNews, exchangeInfo, exchangeRate, krwRate, prevData, prevFerroalloy } = ctx;
  let { priceHistory } = ctx;

  // 2. 3품목 병렬 Perplexity 호출
  const [fesiSettled, femnSettled, simnSettled] = await callFerroProducts(todayKST, ctx);

  // 3. 개별 파싱 + 품목별 fallback (실패한 호출이 있을 때만 readLatest 조회)
  const anyFailed = [fesiSettled, femnSettled, simnSettled].some(s => s.status === 'rejected');
  const latestDoc = anyFailed ? await readLatest(token, 'ferroalloy') : null;
  const latestData = latestDoc?.data ? JSON.parse(latestDoc.data) : null;

  let fesi = parseProduct(fesiSettled, latestData?.fesi, 'FeSi');
  let femn = parseProduct(femnSettled, latestData?.femn, 'FeMn');
  let simn = parseProduct(simnSettled, latestData?.simn, 'SiMn');

  // "검색 결과에 확인되지 않으며" 류 내레이션·불확실 문구 결정적 제거
  fesi = stripUncertaintyDeep(fesi);
  femn = stripUncertaintyDeep(femn);
  simn = stripUncertaintyDeep(simn);

  const allSearchResults = [fesiSettled, femnSettled, simnSettled]
    .flatMap(s => (s.status === 'fulfilled' ? s.value.searchResults ?? [] : []));

  // 전체 실패 시
  if (!fesi && !femn && !simn) {
    if (latestData) {
      return res.status(200).json({ ...latestData, _cached: true, _fallback: true, _age_min: 0, _data_date: latestDoc?.date ?? null });
    }
    return res.status(500).json({ error: '합금철 3품목 호출 전체 실패' });
  }

  // 4. 가격 결정 계층 (ferro-pricing.js — 전부 결정적): 검증·이월 → 선물·입찰 기준점 → 환산
  const products = { fesi, femn, simn };
  validateSpotPrices(products, {
    prevData, latestData,
    prevDate: prevFerroalloy?.date ?? latestDoc?.date ?? null,
  });
  attachFuturesAndBaseline(products, zce, priceHistory);
  applyConversions(products, exchangeRate, krwRate);

  // 5. key_issues 결정적 중복 제거 + search_results 기반 출처 부여 (fresh 품목만)
  for (const [, product] of Object.entries(products)) {
    if (!product || product.carried_over === true) continue;
    product.key_issues = attachSourceMeta(
      dedupKeyIssues(product.key_issues ?? [], newsHistory),
      allSearchResults
    );
  }

  // 9. 종합 요약 호출 (순차)
  let market_summary;
  try {
    console.log('[Perplexity] 합금철 종합 호출 시작');
    const summaryRaw = await callPerplexity(
      getFerroalloySummaryPrompt(todayKST, fesi, femn, simn),
      { maxTokens: 1000, recency: 'week' }
    );
    const sr = parseJSON(summaryRaw);
    market_summary = {
      fesi:              fesi?.context ?? null,
      femn:              femn?.context ?? null,
      simn:              simn?.context ?? null,
      intl_context:      sr.intl_context ?? null,
      non_china_summary: sr.non_china_summary ?? null,
      outlook:           sr.outlook ?? null,
    };
  } catch (e) {
    console.warn('[FerroSummary] 실패 — context로 조립:', e.message);
    market_summary = {
      fesi: fesi?.context ?? null,
      femn: femn?.context ?? null,
      simn: simn?.context ?? null,
    };
  }

  market_summary = stripUncertaintyDeep(market_summary);

  // 10. key_issues 병합 (품목별 1개씩, 총 최대 3개)
  const key_issues = [
    ...(Array.isArray(fesi?.key_issues) ? fesi.key_issues : []),
    ...(Array.isArray(femn?.key_issues) ? femn.key_issues : []),
    ...(Array.isArray(simn?.key_issues) ? simn.key_issues : []),
  ];

  // 11. 가격 시계열 적립 (거래소 정산가 — LLM 무관, 게이트와 독립 저장)
  if (token && (zce?.sf?.settle || zce?.sm?.settle)) {
    priceHistory = await savePriceHistory(token, 'ferroalloy', priceHistory, {
      d: zce?.sf?.date ?? zce?.sm?.date ?? todayKST,
      sf: zce?.sf?.settle ?? null,
      sm: zce?.sm?.settle ?? null,
      femn: toNumber(femn?.price_cny),
    });
  }

  // 12. 최종 결과 조립
  const parsed = {
    fesi:                  fesi  ?? latestData?.fesi,
    femn:                  femn  ?? latestData?.femn,
    simn:                  simn  ?? latestData?.simn,
    market_summary,
    key_issues,
    exchange_rate_cny_usd: exchangeRate ?? null,
    exchange_rate_usd_krw: krwRate ?? null,
    exchange_rate_date:    exchangeInfo?.date ?? todayKST,
    _sources:              allSearchResults.slice(0, 8),
    _kr_news:              krNews,
    _price_history:        priceHistory,
  };

  // 13. 유효성 검사 + Firestore 저장
  //  - 3품목 모두 price 존재(이월 포함) + 최소 1품목 fresh일 때만 저장
  //  - 전부 이월이면 새 정보가 없는 것 — 저장 생략, _latest 보존
  if (token) {
    try {
      const allPresent = !!(parsed.fesi?.price_cny && parsed.femn?.price_cny && parsed.simn?.price_cny);
      const anyFresh = [parsed.fesi, parsed.femn, parsed.simn].some(p => p && p.carried_over !== true);
      if (!allPresent || !anyFresh) {
        console.warn(`[Firestore] ferroalloy 저장 생략 (allPresent:${allPresent} anyFresh:${anyFresh}) — _latest 보존`);
        if (!allPresent && latestData) {
          return res.status(200).json({ ...latestData, _cached: true, _fallback: true, _age_min: 0, _data_date: latestDoc?.date ?? null });
        }
      } else {
        const docId = `ferroalloy_${todayKST}`;
        const saveData = {
          data: JSON.stringify(parsed),
          cached_at: String(Date.now()),
          tab: 'ferroalloy',
          date: todayKST,
        };
        await saveWithLatest(token, 'ferroalloy', docId, saveData);
        // 저장 성공 시에만 뉴스 히스토리 갱신 (fresh 품목의 이슈만)
        const newItems = [
          ...issuesToHistory(fesi?.carried_over !== true ? fesi?.key_issues : [], todayKST, 'fesi'),
          ...issuesToHistory(femn?.carried_over !== true ? femn?.key_issues : [], todayKST, 'femn'),
          ...issuesToHistory(simn?.carried_over !== true ? simn?.key_issues : [], todayKST, 'simn'),
        ];
        await saveNewsHistory(token, 'ferroalloy', newsHistory, newItems, todayKST);
      }
    } catch (e) {
      console.warn('[Firestore] ferroalloy 저장 실패:', e.message);
    }
  }

  return res.status(200).json({ ...parsed, _cached: false, _age_min: 0, _data_date: todayKST });
}
