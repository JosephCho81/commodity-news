// api/get-news.js — 비철금속 원자재 인텔리전스 API
// 탭: steelmaker | aluminum | ferroalloy | recarburizer | summary

export const config = { maxDuration: 60 };

import {
  FIREBASE_ENABLED,
  getFirestoreToken,
  saveToFirestore,
  getFromFirestore,
  fetchPrevDayData,
} from './_lib/firebase.js';

import { callPerplexity, parseJSON } from './_lib/perplexity.js';
import { toNumber, validatePrice, carryForward, dedupKeyIssues, attachSourceMeta, isDuplicateNews } from './_lib/validate.js';
import { fetchLmePrice, fetchAluminumOutlook, fetchScrapPrices, fetchJapanScrapPrices } from './_lib/aluminum-data.js';
import { fetchCNYUSDRate, fetchUSDKRWRate, cnyToUsd } from './_lib/exchange-rate.js';
import { FERRO_EXPORT_TARIFFS } from './_lib/tariff-rates.js';
import { getAluminumPrompt }          from './_prompts/aluminum.js';
import { getFesiPrompt }              from './_prompts/fesi.js';
import { getFemnPrompt }              from './_prompts/femn.js';
import { getSimnPrompt }              from './_prompts/simn.js';
import { getFerroalloySummaryPrompt } from './_prompts/ferroalloy-summary.js';
import { getRecarburizerPrompt }      from './_prompts/recarburizer.js';
import { getSteelmakerPrompt }        from './_prompts/steelmaker.js';
import { getSummaryPrompt }           from './_prompts/summary.js';

// ─── 환경변수 ───────────────────────────────────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// ─── KST 날짜 헬퍼 ──────────────────────────────────────────────────────────
const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ─── 탭별 프롬프트 빌더 (요청마다 호출하여 날짜 고정 방지) ─────────────────
const PROMPT_BUILDERS = {
  steelmaker:   getSteelmakerPrompt,
  aluminum:     getAluminumPrompt,
  recarburizer: getRecarburizerPrompt,
  summary:      getSummaryPrompt,
};

const VALID_TABS = new Set(['steelmaker', 'aluminum', 'ferroalloy', 'recarburizer', 'summary']);

// 탭별 Perplexity 검색 최신성 필터
// ferroalloy 3품목·recarburizer는 월 단위 시세(HBIS 입찰가 등)라 month, 뉴스성 탭은 week/day
const RECENCY_BY_TAB = {
  steelmaker:   'week',
  aluminum:     'week',
  recarburizer: 'month',
  summary:      'day',
};

// ─── 뉴스 히스토리 (최근 7일 보도 이슈 — 중복 제거용) ───────────────────────
const NEWS_HISTORY_DAYS = 7;

async function readNewsHistory(token, tab) {
  if (!token) return [];
  try {
    const doc = await getFromFirestore(token, 'commodity_cache', `news_history_${tab}`).catch(() => null);
    if (doc?.items) {
      const items = JSON.parse(doc.items);
      if (Array.isArray(items)) return items;
    }
  } catch (e) {
    console.warn('[NewsHistory] 읽기 실패:', e.message);
  }
  return [];
}

function buildExclusionSection(historyItems, productKey = null) {
  const items = productKey ? historyItems.filter(h => h.k === productKey) : historyItems;
  if (items.length === 0) return '';
  let s = '\n\n【최근 보도한 이슈 — 제외】\n아래는 최근 7일 내 이미 보도한 이슈 목록. 실질적으로 같은 이슈는 다시 선정하지 말 것. 같은 이슈라도 가격·수치에 새로운 변화가 보도된 경우에만 새 수치 중심으로 작성 가능:\n';
  for (const h of items) s += `- (${h.d}) ${h.t}\n`;
  return s;
}

async function saveNewsHistory(token, tab, historyItems, newItems, todayKST) {
  if (!token || newItems.length === 0) return;
  try {
    const cutoff = new Date(new Date(todayKST + 'T00:00:00Z').getTime() - NEWS_HISTORY_DAYS * 86400000)
      .toISOString().slice(0, 10);
    const merged = [...historyItems, ...newItems].filter(h => h?.d && h.d >= cutoff);
    await saveToFirestore(token, 'commodity_cache', `news_history_${tab}`, {
      items: JSON.stringify(merged),
      updated_at: String(Date.now()),
    });
    console.log(`[NewsHistory] ${tab} 저장: 신규 ${newItems.length}건, 총 ${merged.length}건`);
  } catch (e) {
    console.warn('[NewsHistory] 저장 실패:', e.message);
  }
}

// key_issues 배열에서 히스토리 항목 생성
function issuesToHistory(issues, todayKST, productKey = null) {
  return (Array.isArray(issues) ? issues : [])
    .filter(i => i?.title)
    .map(i => ({ t: i.title, d: todayKST, u: i.url ?? null, k: productKey }));
}

// ─── _latest fallback 헬퍼 ──────────────────────────────────────────────────
async function readLatest(token, tab) {
  if (!token) return null;
  try {
    const doc = await getFromFirestore(token, 'commodity_cache', `${tab}_latest`).catch(() => null);
    if (doc?.data) return doc;
  } catch (e) { /* silent */ }
  return null;
}

async function saveWithLatest(token, tab, docId, saveData) {
  await Promise.all([
    saveToFirestore(token, 'commodity_cache', docId, saveData),
    saveToFirestore(token, 'commodity_cache', `${tab}_latest`, saveData),
  ]);
  console.log(`[Firestore] ✅ 저장: commodity_cache/${docId} + ${tab}_latest`);
}

// ─── 메인 핸들러 ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!PERPLEXITY_API_KEY) {
    return res.status(500).json({ error: 'PERPLEXITY_API_KEY not set' });
  }

  const tab = (req.query.tab || 'summary').toLowerCase();
  const force =
    req.query.force === 'true' && req.query.secret === process.env.ADMIN_SECRET;

  if (!VALID_TABS.has(tab)) {
    return res.status(400).json({
      error: `Unknown tab: ${tab}. Use: steelmaker, aluminum, ferroalloy, recarburizer, summary`,
    });
  }

  let token = null;

  try {
    // ── 1. Firestore 토큰 ─────────────────────────────────────────────────
    if (FIREBASE_ENABLED) {
      try {
        token = await getFirestoreToken();
      } catch (e) {
        console.warn('[Firebase] 토큰 발급 실패 (캐시 비활성화):', e.message);
      }
    } else {
      console.log('[Firebase] 비활성 — Perplexity 직접 호출');
    }

    // ── 2. 오늘 캐시 읽기 ─────────────────────────────────────────────────
    if (token && !force) {
      try {
        const todayKST = getKSTDate();
        const docId = `${tab}_${todayKST}`;
        const cached = await getFromFirestore(token, 'commodity_cache', docId);
        if (cached?.data) {
          const ageMin = cached.cached_at
            ? Math.round((Date.now() - Number(cached.cached_at)) / 60000)
            : 0;
          console.log(`[Cache] HIT: ${docId}, age: ${ageMin}분`);
          return res.status(200).json({
            ...JSON.parse(cached.data),
            _cached: true,
            _age_min: ageMin,
            _data_date: cached.date ?? todayKST,
            _cached_at: cached.cached_at ? Number(cached.cached_at) : null,
          });
        }
        console.log(`[Cache] MISS: ${docId} → Perplexity 동기 호출`);
      } catch (e) {
        console.warn('[Firestore] 캐시 읽기 실패:', e.message);
      }
    }

    // ── 3. ferroalloy 멀티콜 특별 처리 ──────────────────────────────────────
    if (tab === 'ferroalloy') {
      const todayKST = getKSTDate();

      // 3-1. 환율 + 전일 데이터 + 뉴스 히스토리 병렬 fetch
      let exchangeInfo = null;
      let prevFerroalloy = null;
      let newsHistory = [];
      try {
        [exchangeInfo, prevFerroalloy, newsHistory] = await Promise.all([
          fetchCNYUSDRate(token, { saveToFirestore, getFromFirestore }),
          fetchPrevDayData(token, 'ferroalloy'),
          readNewsHistory(token, 'ferroalloy'),
        ]);
      } catch (e) {
        console.warn('[Ferroalloy] 사전 데이터 fetch 실패:', e.message);
      }
      const exchangeRate = exchangeInfo?.rate ?? null;
      const prevData = prevFerroalloy?.data ?? null;

      // 3-2. 3품목 병렬 Perplexity 호출 (월 단위 시세 — recency: month)
      console.log('[Perplexity] 합금철 3품목 병렬 호출 시작');
      const pplxOpts = { recency: 'month', withMeta: true };
      const [fesiSettled, femnSettled, simnSettled] = await Promise.allSettled([
        callPerplexity(getFesiPrompt(todayKST, prevData?.fesi) + buildExclusionSection(newsHistory, 'fesi'), { maxTokens: 2500, ...pplxOpts }),
        callPerplexity(getFemnPrompt(todayKST, prevData?.femn) + buildExclusionSection(newsHistory, 'femn'), { maxTokens: 2000, ...pplxOpts }),
        callPerplexity(getSimnPrompt(todayKST, prevData?.simn) + buildExclusionSection(newsHistory, 'simn'), { maxTokens: 2000, ...pplxOpts }),
      ]);

      // 3-3. 개별 파싱 + 품목별 fallback (실패한 호출이 있을 때만 readLatest 조회)
      const anyFailed = [fesiSettled, femnSettled, simnSettled].some(s => s.status === 'rejected');
      const latestDoc = anyFailed ? await readLatest(token, 'ferroalloy') : null;
      const latestData = latestDoc?.data ? JSON.parse(latestDoc.data) : null;

      function parseProduct(settled, fallback, name) {
        if (settled.status === 'fulfilled') {
          try { return parseJSON(settled.value.content); }
          catch (e) { console.warn(`[${name}] JSON 파싱 실패 — fallback 사용`); }
        } else {
          console.warn(`[${name}] 호출 실패 — fallback 사용:`, settled.reason?.message);
        }
        // 전일 캐시 fallback — 이월 데이터임을 명시 (오늘 데이터처럼 보이지 않게)
        if (fallback) return { ...fallback, carried_over: true };
        return null;
      }

      let fesi = parseProduct(fesiSettled, latestData?.fesi, 'FeSi');
      let femn = parseProduct(femnSettled, latestData?.femn, 'FeMn');
      let simn = parseProduct(simnSettled, latestData?.simn, 'SiMn');

      const allSearchResults = [fesiSettled, femnSettled, simnSettled]
        .flatMap(s => (s.status === 'fulfilled' ? s.value.searchResults ?? [] : []));

      // 전체 실패 시
      if (!fesi && !femn && !simn) {
        if (latestData) {
          return res.status(200).json({ ...latestData, _cached: true, _fallback: true, _age_min: 0, _data_date: latestDoc?.date ?? null });
        }
        return res.status(500).json({ error: '합금철 3품목 호출 전체 실패' });
      }

      // 3-3.5. 가격 검증 + carry-forward — LLM 출력 가격은 검증 없이 통과 금지
      //  bound·전일 대비 변동률 위반 또는 null이면 전일값 이월(carried_over) + 원래 기준일 유지
      for (const [key, product] of Object.entries({ fesi, femn, simn })) {
        if (!product) continue;
        if (product.carried_over === true) continue; // 전일 캐시 fallback — 재검증 불필요

        const prev = prevData?.[key] ?? latestData?.[key] ?? null;
        const v = validatePrice(product.price_cny, `${key}_cny`, prev?.price_cny);
        if (v.reason) console.warn(`[Validate] ${key}: ${v.reason}`);

        if (v.value !== null) {
          product.price_cny = v.value;
          product.carried_over = false;
          if (product.price_as_of === undefined) product.price_as_of = null;
        } else {
          const carried = carryForward(prev, prevFerroalloy?.date ?? latestDoc?.date ?? null);
          if (carried) {
            product.price_cny    = carried.value;
            product.price_as_of  = carried.as_of;
            product.price_source = carried.source;
            product.carried_over = true;
            console.warn(`[Validate] ${key}: 전일값 이월 (${carried.value} CNY, 기준 ${carried.as_of ?? '미상'})`);
          } else {
            product.price_cny = null; // 콜드스타트 — UI가 범위 표시로 degrade
            product.carried_over = false;
          }
        }
        // 부가 수치 결정적 정규화 (문자열 → 숫자, 비정상 → null)
        if ('hbis_bid_price' in product)   product.hbis_bid_price   = toNumber(product.hbis_bid_price);
        if ('ningxia_spot' in product)     product.ningxia_spot     = toNumber(product.ningxia_spot);
        if ('mn_ore_cif_korea' in product) product.mn_ore_cif_korea = toNumber(product.mn_ore_cif_korea);
      }

      // 3-3.6. key_issues 결정적 중복 제거 + search_results 기반 출처 부여 (fresh 품목만)
      for (const [key, product] of Object.entries({ fesi, femn, simn })) {
        if (!product || product.carried_over === true) continue;
        product.key_issues = attachSourceMeta(
          dedupKeyIssues(product.key_issues ?? [], newsHistory),
          allSearchResults
        );
      }

      // 3-4. CNY → USD 환율 적용 + FOB 추정 계산 (tariff-rates.js 상수 사용)
      if (exchangeRate) {
        const productMap = { fesi, femn, simn };
        for (const [key, product] of Object.entries(productMap)) {
          if (!product) continue;
          if (product.price_cny) {
            product.price_usd = cnyToUsd(product.price_cny, exchangeRate);
          }
          const t = FERRO_EXPORT_TARIFFS[key];
          if (product.price_cny && t) {
            product.china_export_tariff_pct = t.pct;
            product.china_export_misc_usd   = t.misc_usd;
            product.china_export_tariff_ref = t.hs;
            const fob = Number(product.price_cny) * exchangeRate * (1 + t.pct / 100) + t.misc_usd;
            product.fob_est_usd = Math.round(fob);
          }
        }
        console.log(`[ExRate] ferroalloy USD 변환: 1 CNY = ${exchangeRate} USD`);
      }

      // 3-5. summary 호출 (Step 2 — 순차)
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

      // 3-6. key_issues 병합 (품목별 1개씩, 총 최대 3개)
      const key_issues = [
        ...(Array.isArray(fesi?.key_issues) ? fesi.key_issues : []),
        ...(Array.isArray(femn?.key_issues) ? femn.key_issues : []),
        ...(Array.isArray(simn?.key_issues) ? simn.key_issues : []),
      ];

      // 3-7. 최종 결과 조립
      const parsed = {
        fesi:                  fesi  ?? latestData?.fesi,
        femn:                  femn  ?? latestData?.femn,
        simn:                  simn  ?? latestData?.simn,
        market_summary,
        key_issues,
        exchange_rate_cny_usd: exchangeRate ?? null,
        exchange_rate_date:    exchangeInfo?.date ?? todayKST,
        _sources:              allSearchResults.slice(0, 8),
      };

      // 3-8. 유효성 검사 + Firestore 저장
      //  - 3품목 모두 price 존재(이월 포함) + 최소 1품목 fresh일 때만 저장
      //  - 전부 이월이면 새 정보가 없는 것 — 저장 생략, _latest 보존 (1품목 실패가 신규 2품목을 버리지 않도록 게이트 완화)
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
    // ── END ferroalloy 멀티콜 ────────────────────────────────────────────────

    // ── 4. 나머지 탭 사전 데이터 fetch ───────────────────────────────────────
    let lmeData = null, outlookText = null, scrapPrices = null, japanScrap = null;
    let prevAluminum = null, prevRecarburizer = null, prevSteelmaker = null;
    let krwInfo = null;
    let newsHistory = [];

    if (tab === 'aluminum') {
      [lmeData, outlookText, scrapPrices, japanScrap, prevAluminum, newsHistory] = await Promise.all([
        fetchLmePrice(),
        fetchAluminumOutlook(),
        fetchScrapPrices(),
        fetchJapanScrapPrices(),
        fetchPrevDayData(token, 'aluminum'),
        readNewsHistory(token, 'aluminum'),
      ]);
    }
    if (tab === 'recarburizer') {
      [prevRecarburizer, newsHistory] = await Promise.all([
        fetchPrevDayData(token, 'recarburizer'),
        readNewsHistory(token, 'recarburizer'),
      ]);
    }
    if (tab === 'steelmaker') {
      [krwInfo, prevSteelmaker, newsHistory] = await Promise.all([
        fetchUSDKRWRate(token, { saveToFirestore, getFromFirestore }),
        fetchPrevDayData(token, 'steelmaker'),
        readNewsHistory(token, 'steelmaker'),
      ]);
    }

    // ── 4. summary 탭: 각 탭 캐시 데이터 주입 ────────────────────────────
    let summaryContext = '';
    if (tab === 'summary' && token) {
      try {
        const readTab = async (tabName) => {
          const todayKST = getKSTDate();
          const today = await getFromFirestore(token, 'commodity_cache', `${tabName}_${todayKST}`).catch(() => null);
          if (today?.data) return today;
          return readLatest(token, tabName);
        };

        const [alData, faData, recData, smData] = await Promise.all([
          readTab('aluminum'),
          readTab('ferroalloy'),
          readTab('recarburizer'),
          readTab('steelmaker'),
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
          summaryContext += `FeSi: CNY ${fa.fesi?.price_cny ?? 'N/A'}/MT (USD ${fa.fesi?.price_usd ?? 'N/A'}/MT) ${fa.fesi?.direction ?? ''}\n`;
          summaryContext += `FeMn: CNY ${fa.femn?.price_cny ?? 'N/A'}/MT (USD ${fa.femn?.price_usd ?? 'N/A'}/MT) ${fa.femn?.direction ?? ''}\n`;
          summaryContext += `SiMn: CNY ${fa.simn?.price_cny ?? 'N/A'}/MT (USD ${fa.simn?.price_usd ?? 'N/A'}/MT) ${fa.simn?.direction ?? ''}\n`;
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
    }

    // ── 5. 프롬프트 구성 ──────────────────────────────────────────────────
    let prompt = PROMPT_BUILDERS[tab]?.(getKSTDate());

    // 전일 비교 컨텍스트 주입
    if (tab === 'aluminum' && prevAluminum) {
      const p = prevAluminum.data;
      prompt += `\n\n【전일 데이터 (${prevAluminum.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】\n`;
      prompt += `전일 LME: ${p.lme?.price ?? 'N/A'} USD/MT (변동: ${p.lme?.change ?? 'N/A'} USD)\n`;
      prompt += `전일 move_reason 요약: ${p.lme?.move_reason?.slice(0, 80) ?? 'N/A'}\n`;
      prompt += `전일 스크랩 요약: ${p.scrap?.weekly_summary?.slice(0, 100) ?? 'N/A'}\n`;
      prompt += `→ 오늘 위 수치 대비 달라진 것 구체적 서술. 달라진 것 없으면 "전일 대비 보합" 명시.\n`;
    }

if (tab === 'recarburizer' && prevRecarburizer) {
      const p = prevRecarburizer.data;
      prompt += `\n\n【전일 데이터 (${prevRecarburizer.date}) — 반드시 아래 수치와 오늘을 비교】\n`;
      prompt += `전일 중국 FOB: ${p.china_price?.fob_qinhuangdao ?? p.china_price?.price_range_text ?? 'N/A'} USD/MT\n`;
      prompt += `전일 러시아 FOB: ${p.russia_price?.fob_murmansk ?? p.russia_price?.price_range_text ?? 'N/A'} USD/MT\n`;
      prompt += `전일 시장 요약: ${p.market_summary?.slice(0, 100) ?? 'N/A'}\n`;
      prompt += `→ 오늘 위 수치 대비 달라진 것 구체적 서술. 달라진 것 없으면 "전월 수준 유지" 명시.\n`;
    }

    // steelmaker 전일 비교 컨텍스트 주입
    if (tab === 'steelmaker' && prevSteelmaker) {
      const pm = prevSteelmaker.data;
      prompt += `\n\n【전일 브리핑 (${prevSteelmaker.date}) — direction·수치 변화 감지용 참고 데이터】\n`;
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
      prompt += `- direction이 전일과 달라진 경우: recent_issues에 "전일 ${prevSteelmaker.date} 대비 direction 변화" 명시.\n`;
      prompt += `- direction이 동일한 경우: recent_issues에 별도 언급 불필요. status/reason은 오늘 검색 결과 기반으로 독립 작성.\n`;
      prompt += `- "전일 대비 보합" 표현을 status·reason·outlook 필드에 절대 포함하지 말 것.\n`;
    }

    // steelmaker KRW/USD 환율 주입
    if (tab === 'steelmaker' && krwInfo?.rate) {
      const krwFormatted = Math.round(krwInfo.rate).toLocaleString('ko-KR');
      prompt += `\n\n【실시간 환율 데이터 — cost_factors 작성 시 반드시 아래 값 사용】\n`;
      prompt += `USD/KRW: 1 USD = ${krwFormatted}원 (${krwInfo.date ?? getKSTDate()} 기준, frankfurter.app)\n`;
      prompt += `→ cost_factors에서 환율 언급 시 위 수치 사용. 다른 환율 수치 절대 금지.\n`;
    }

    // aluminum 실시간 데이터 주입
    if (tab === 'aluminum') {
      let context = '\n\n【LME 실시간 수집 데이터 — move_reason/market_status 작성 시 반드시 아래 LME 공식 가격만 사용】\n';
      if (lmeData) {
        const fmt = (v) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const priceFormatted = fmt(lmeData.price);
        const changeFormatted = lmeData.change !== null ? `${parseFloat(lmeData.change) >= 0 ? '+' : ''}${fmt(lmeData.change)}` : null;
        context += `\n[LME Cash Settlement — westmetall.com 파싱값]\n`;
        context += `현재가: ${priceFormatted} USD/MT\n`;
        if (changeFormatted !== null) context += `전일 대비: ${changeFormatted} USD/MT\n`;
        if (lmeData.change_pct) context += `등락률: ${lmeData.change_pct}\n`;
        context += `기준일: ${lmeData.date}\n`;
        context += `[주의] move_reason 작성 시 반드시 위 ${priceFormatted} USD/MT 숫자 사용. 다른 수치 금지.\n`;
      }
      if (outlookText) context += `\n[가격 전망 참고]\n${outlookText}\n`;
      if (scrapPrices?.us && Object.keys(scrapPrices.us).length > 0) {
        context += `\n[미국 알루미늄 스크랩 (USD/톤, scrapmonster.com)]\n`;
        for (const [k, v] of Object.entries(scrapPrices.us)) context += `${k}: $${v.toLocaleString('en-US')}/톤\n`;
      }
      if (scrapPrices?.eu && Object.keys(scrapPrices.eu).length > 0) {
        context += `\n[유럽 알루미늄 스크랩 (USD/톤)]\n`;
        for (const [k, v] of Object.entries(scrapPrices.eu)) context += `${k}: $${v.toLocaleString('en-US')}/톤\n`;
      }
      if (scrapPrices?.cn && Object.keys(scrapPrices.cn).length > 0) {
        context += `\n[중국 알루미늄 스크랩 (CNY/톤)]\n`;
        for (const [k, v] of Object.entries(scrapPrices.cn)) context += `${k}: ${v.toLocaleString('en-US')} CNY/톤\n`;
      }
      if (japanScrap?.prices && Object.keys(japanScrap.prices).length > 0) {
        context += `\n[Japan Aluminum Scrap (JPY/톤, ${japanScrap.date})]\n`;
        for (const [k, v] of Object.entries(japanScrap.prices)) context += `${k}: ${v.toLocaleString('en-US')}円/톤\n`;
      }
      prompt += context;
    }

    if (tab === 'summary' && summaryContext) {
      prompt += summaryContext;
    }

    // 최근 보도 이슈 제외 목록 주입 (뉴스 반복 방지)
    if (tab !== 'summary' && newsHistory.length > 0) {
      prompt += buildExclusionSection(newsHistory);
    }

    // ── 6. Perplexity 호출 ────────────────────────────────────────────────
    console.log(`[Perplexity] 호출 시작: ${tab} (recency: ${RECENCY_BY_TAB[tab] ?? '없음'})`);
    const { content: raw, searchResults } = await callPerplexity(prompt, {
      maxTokens: tab === 'steelmaker' ? 4000 : 3000,
      recency: RECENCY_BY_TAB[tab] ?? null,
      withMeta: true,
    });

    let parsed;
    try {
      parsed = parseJSON(raw);
    } catch (e) {
      console.error('[JSON] 파싱 실패:', e.message, '| raw:', raw.slice(0, 300));
      const latest = await readLatest(token, tab);
      if (latest?.data) {
        console.log(`[Fallback] JSON 파싱 실패 → ${tab}_latest 반환`);
        return res.status(200).json({ ...JSON.parse(latest.data), _cached: true, _fallback: true, _age_min: 0, _data_date: latest.date ?? null });
      }
      return res.status(500).json({ error: 'JSON parse failed', detail: e.message, raw_preview: raw.slice(0, 300) });
    }

    // ── 7. LME 가격 주입 (aluminum) ───────────────────────────────────────
    if (tab === 'aluminum' && lmeData) {
      console.log(`[LME] 가격 주입 (${lmeData.source}): ${lmeData.price} USD/톤 (${lmeData.date})`);
      parsed.lme = {
        ...parsed.lme,
        price:        lmeData.price,
        change:       lmeData.change,
        change_pct:   lmeData.change_pct,
        date:         lmeData.date,
        holiday_note: lmeData.holiday_note ?? null,
        source:       lmeData.source,
        carried_over: false,
      };
    } else if (tab === 'aluminum') {
      // 직접 fetch 실패 — Perplexity 가격은 검증 통과분만, 실패 시 전일값 이월
      console.warn('[LME] 직접 fetch 전부 실패 — Perplexity 가격 검증 시도');
      const prevLme = prevAluminum?.data?.lme ?? null;
      const v = validatePrice(parsed.lme?.price, 'lme_al', prevLme?.price);
      if (v.reason) console.warn('[Validate] lme:', v.reason);
      if (v.value !== null) {
        parsed.lme = { ...parsed.lme, price: v.value, source: 'perplexity', carried_over: false };
      } else if (toNumber(prevLme?.price) !== null) {
        console.warn('[Validate] lme: 전일값 이월');
        parsed.lme = {
          ...parsed.lme,
          price:        toNumber(prevLme.price),
          change:       null,
          change_pct:   null,
          date:         prevLme.date ?? prevAluminum?.date ?? null,
          source:       'carried',
          carried_over: true,
        };
      } else {
        parsed.lme = { ...parsed.lme, price: null, source: 'perplexity' };
      }
    }

    // ── 7.5. 탭별 가격 검증 + 뉴스 중복 제거 (결정적 후처리) ─────────────────
    if (tab === 'aluminum' && parsed.lme) {
      parsed.lme.key_issues = attachSourceMeta(
        dedupKeyIssues(parsed.lme.key_issues ?? [], newsHistory),
        searchResults
      );
    }

    if (tab === 'recarburizer') {
      const prevRec = prevRecarburizer?.data ?? null;
      // 월 시세 특성상 변동률 한계 15%로 완화
      const applyPrice = (obj, field, boundKey, prevObj) => {
        if (!obj) return;
        const v = validatePrice(obj[field], boundKey, prevObj?.[field], 15);
        if (v.reason) console.warn(`[Validate] ${boundKey}: ${v.reason}`);
        if (v.value !== null) {
          obj[field] = v.value;
          obj.carried_over = false;
          return;
        }
        const prevVal = toNumber(prevObj?.[field]);
        if (prevVal !== null) {
          console.warn(`[Validate] ${boundKey}: 전일값 이월 (${prevVal})`);
          obj[field] = prevVal;
          obj.as_of = prevObj?.as_of ?? prevObj?.date ?? prevRecarburizer?.date ?? null;
          obj.source = prevObj?.source ?? null;
          obj.carried_over = true;
        } else {
          obj[field] = null; // 콜드스타트 — price_range_text로 degrade
        }
      };
      applyPrice(parsed.china_price,  'fob_qinhuangdao', 'anthracite_china_fob',  prevRec?.china_price);
      applyPrice(parsed.russia_price, 'fob_murmansk',    'anthracite_russia_fob', prevRec?.russia_price);
      if (parsed.china_price)  parsed.china_price.cif_korea  = validatePrice(parsed.china_price.cif_korea,  'anthracite_cif_korea').value;
      if (parsed.russia_price) parsed.russia_price.cif_korea = validatePrice(parsed.russia_price.cif_korea, 'anthracite_cif_korea').value;

      parsed.key_issues = attachSourceMeta(
        dedupKeyIssues(parsed.key_issues ?? [], newsHistory),
        searchResults
      );
    }

    if (tab === 'steelmaker') {
      // recent_issues가 최근 7일 보도분과 중복이면 "발표 없음" 처리 (재탕 차단)
      const NO_NEWS = '최근 3일 내 주요 발표 없음';
      const makers = [...(parsed.domestic_makers ?? []), ...(parsed.overseas_makers ?? [])];
      for (const m of makers) {
        if (m?.recent_issues && m.recent_issues !== NO_NEWS && isDuplicateNews(m.recent_issues, null, newsHistory)) {
          console.log(`[Dedup] steelmaker recent_issues 중복 → 발표 없음 처리: ${m.name ?? m.country}`);
          m.recent_issues = NO_NEWS;
        }
      }
    }

    if (tab !== 'summary') {
      parsed._sources = (searchResults ?? []).slice(0, 8);
    }

    // ── 8. 유효성 검사 + Firestore 저장 ──────────────────────────────────
    if (token) {
      try {
        const isValidData = (() => {
          if (tab === 'aluminum')     return !!(parsed.lme?.price || parsed.lme?.market_status);
          if (tab === 'steelmaker')   return !!(parsed.domestic_makers?.length > 0);
          if (tab === 'recarburizer') return !!(
            parsed.china_price?.price_range_text || parsed.china_price?.fob_qinhuangdao ||
            parsed.global_market?.headline || parsed.market_summary
          );
          if (tab === 'summary')      return !!(parsed.one_liner && parsed.key_signals?.length > 0);
          return true;
        })();

        if (!isValidData) {
          console.warn(`[Firestore] 유효성 검사 실패 — ${tab}_latest fallback 시도`);
          const latest = await readLatest(token, tab);
          if (latest?.data) {
            return res.status(200).json({
              ...JSON.parse(latest.data),
              _cached: true, _fallback: true, _age_min: 0,
              _data_date: latest.date ?? null,
            });
          }
          return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
        }

        const todayKST = getKSTDate();
        const docId = `${tab}_${todayKST}`;
        const saveData = {
          data: JSON.stringify(parsed),
          cached_at: String(Date.now()),
          tab,
          date: todayKST,
        };
        await saveWithLatest(token, tab, docId, saveData);

        // 저장 성공 시에만 뉴스 히스토리 갱신
        if (tab !== 'summary') {
          const NO_NEWS = '최근 3일 내 주요 발표 없음';
          let newItems = [];
          if (tab === 'aluminum') {
            newItems = issuesToHistory(parsed.lme?.key_issues, todayKST, 'lme');
          } else if (tab === 'recarburizer') {
            newItems = issuesToHistory(parsed.key_issues, todayKST);
          } else if (tab === 'steelmaker') {
            newItems = [...(parsed.domestic_makers ?? []), ...(parsed.overseas_makers ?? [])]
              .filter(m => m?.recent_issues && m.recent_issues !== NO_NEWS)
              .map(m => ({ t: m.recent_issues, d: todayKST, u: null, k: m.name ?? m.country ?? null }));
          }
          await saveNewsHistory(token, tab, newsHistory, newItems, todayKST);
        }
      } catch (e) {
        console.warn('[Firestore] 저장 실패:', e.message);
      }
    }

    return res.status(200).json({ ...parsed, _cached: false, _age_min: 0, _data_date: getKSTDate() });

  } catch (err) {
    console.error('[Handler] 예외:', err.message);
    const latest = await readLatest(token, tab);
    if (latest?.data) {
      console.log(`[Fallback] 예외 → ${tab}_latest 반환`);
      return res.status(200).json({
        ...JSON.parse(latest.data),
        _cached: true, _fallback: true, _age_min: 0,
        _data_date: latest.date ?? null,
      });
    }
    return res.status(500).json({ error: err.message });
  }
}
