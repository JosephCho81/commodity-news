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
          return res.status(200).json({ ...JSON.parse(cached.data), _cached: true, _age_min: ageMin });
        }
        console.log(`[Cache] MISS: ${docId} → Perplexity 호출`);
      } catch (e) {
        console.warn('[Firestore] 캐시 읽기 실패:', e.message);
      }
    }

    // ── 3. ferroalloy 멀티콜 특별 처리 ──────────────────────────────────────
    if (tab === 'ferroalloy') {
      const todayKST = getKSTDate();

      // 3-1. 환율 + 전일 데이터 병렬 fetch
      let exchangeRate = null;
      let prevFerroalloy = null;
      try {
        [exchangeRate, prevFerroalloy] = await Promise.all([
          fetchCNYUSDRate(token, { saveToFirestore, getFromFirestore }),
          fetchPrevDayData(token, 'ferroalloy'),
        ]);
      } catch (e) {
        console.warn('[Ferroalloy] 사전 데이터 fetch 실패:', e.message);
      }
      const prevData = prevFerroalloy?.data ?? null;

      // 3-2. 3품목 병렬 Perplexity 호출
      console.log('[Perplexity] 합금철 3품목 병렬 호출 시작');
      const [fesiSettled, femnSettled, simnSettled] = await Promise.allSettled([
        callPerplexity(getFesiPrompt(todayKST, prevData?.fesi), { maxTokens: 2500 }),
        callPerplexity(getFemnPrompt(todayKST, prevData?.femn), { maxTokens: 2000 }),
        callPerplexity(getSimnPrompt(todayKST, prevData?.simn), { maxTokens: 2000 }),
      ]);

      // 3-3. 개별 파싱 + 품목별 fallback
      const latestDoc = await readLatest(token, 'ferroalloy');
      const latestData = latestDoc?.data ? JSON.parse(latestDoc.data) : null;

      function parseProduct(settled, fallback, name) {
        if (settled.status === 'fulfilled') {
          try { return parseJSON(settled.value); }
          catch (e) { console.warn(`[${name}] JSON 파싱 실패 — fallback 사용`); }
        } else {
          console.warn(`[${name}] 호출 실패 — fallback 사용:`, settled.reason?.message);
        }
        return fallback ?? null;
      }

      let fesi = parseProduct(fesiSettled, latestData?.fesi, 'FeSi');
      let femn = parseProduct(femnSettled, latestData?.femn, 'FeMn');
      let simn = parseProduct(simnSettled, latestData?.simn, 'SiMn');

      // 전체 실패 시
      if (!fesi && !femn && !simn) {
        if (latestData) {
          return res.status(200).json({ ...latestData, _cached: true, _fallback: true, _age_min: 0 });
        }
        return res.status(500).json({ error: '합금철 3품목 호출 전체 실패' });
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
          { maxTokens: 1000 }
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
        exchange_rate_date:    todayKST,
      };

      // 3-8. 유효성 검사 + Firestore 저장
      if (token) {
        try {
          const isValid = !!(parsed.fesi?.price_cny || parsed.market_summary);
          if (!isValid) {
            console.warn('[Firestore] ferroalloy 유효성 검사 실패');
            if (latestData) {
              return res.status(200).json({ ...latestData, _cached: true, _fallback: true, _age_min: 0 });
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
          }
        } catch (e) {
          console.warn('[Firestore] ferroalloy 저장 실패:', e.message);
        }
      }

      return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
    }
    // ── END ferroalloy 멀티콜 ────────────────────────────────────────────────

    // ── 4. 나머지 탭 사전 데이터 fetch ───────────────────────────────────────
    let lmeData = null, outlookText = null, scrapPrices = null, japanScrap = null;
    let prevAluminum = null, prevRecarburizer = null, prevSteelmaker = null;
    let exchangeRate = null, krwRate = null;

    if (tab === 'aluminum') {
      [lmeData, outlookText, scrapPrices, japanScrap, prevAluminum] = await Promise.all([
        fetchLmePrice(),
        fetchAluminumOutlook(),
        fetchScrapPrices(),
        fetchJapanScrapPrices(),
        fetchPrevDayData(token, 'aluminum'),
      ]);
    }
    if (tab === 'recarburizer') {
      prevRecarburizer = await fetchPrevDayData(token, 'recarburizer');
    }
    if (tab === 'steelmaker') {
      [krwRate, prevSteelmaker] = await Promise.all([
        fetchUSDKRWRate(token, { saveToFirestore, getFromFirestore }),
        fetchPrevDayData(token, 'steelmaker'),
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
    if (tab === 'steelmaker' && krwRate) {
      const krwFormatted = Math.round(krwRate).toLocaleString('ko-KR');
      prompt += `\n\n【실시간 환율 데이터 — cost_factors 작성 시 반드시 아래 값 사용】\n`;
      prompt += `USD/KRW: 1 USD = ${krwFormatted}원 (${getKSTDate()} 기준, frankfurter.app 실시간)\n`;
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

    // ── 6. Perplexity 호출 ────────────────────────────────────────────────
    console.log(`[Perplexity] 호출 시작: ${tab}`);
    const raw = await callPerplexity(prompt, { maxTokens: tab === 'steelmaker' ? 6000 : 3000 });

    let parsed;
    try {
      parsed = parseJSON(raw);
    } catch (e) {
      console.error('[JSON] 파싱 실패:', e.message, '| raw:', raw.slice(0, 300));
      const latest = await readLatest(token, tab);
      if (latest?.data) {
        console.log(`[Fallback] JSON 파싱 실패 → ${tab}_latest 반환`);
        return res.status(200).json({ ...JSON.parse(latest.data), _cached: true, _fallback: true, _age_min: 0 });
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
      };
    } else if (tab === 'aluminum') {
      console.warn('[LME] 직접 fetch 전부 실패 — Perplexity fallback (신뢰도 낮음)');
      parsed.lme = { ...parsed.lme, source: 'perplexity' };
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
      } catch (e) {
        console.warn('[Firestore] 저장 실패:', e.message);
      }
    }

    return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });

  } catch (err) {
    console.error('[Handler] 예외:', err.message);
    const latest = await readLatest(token, tab);
    if (latest?.data) {
      console.log(`[Fallback] 예외 → ${tab}_latest 반환`);
      return res.status(200).json({
        ...JSON.parse(latest.data),
        _cached: true, _fallback: true, _age_min: 0,
      });
    }
    return res.status(500).json({ error: err.message });
  }
}
