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
import { fetchCNYUSDRate, cnyToUsd } from './_lib/exchange-rate.js';
import { getAluminumPrompt }    from './_prompts/aluminum.js';
import { getFerroalloyPrompt }  from './_prompts/ferroalloy.js';
import { getRecarburizerPrompt } from './_prompts/recarburizer.js';
import { getSteelmakerPrompt }  from './_prompts/steelmaker.js';
import { getSummaryPrompt }     from './_prompts/summary.js';

// ─── 환경변수 ───────────────────────────────────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// ─── KST 날짜 헬퍼 ──────────────────────────────────────────────────────────
const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ─── 탭별 프롬프트 ──────────────────────────────────────────────────────────
const PROMPTS = (() => {
  const date = getKSTDate();
  return {
    steelmaker:   getSteelmakerPrompt(date),
    aluminum:     getAluminumPrompt(date),
    ferroalloy:   getFerroalloyPrompt(date),
    recarburizer: getRecarburizerPrompt(date),
    summary:      getSummaryPrompt(date),
  };
})();

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

  if (!PROMPTS[tab]) {
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

    // ── 3. 탭별 사전 데이터 fetch ─────────────────────────────────────────
    let lmeData = null, outlookText = null, scrapPrices = null, japanScrap = null;
    let prevAluminum = null, prevFerroalloy = null, prevRecarburizer = null, prevSteelmaker = null;
    let exchangeRate = null;

    if (tab === 'aluminum') {
      [lmeData, outlookText, scrapPrices, japanScrap, prevAluminum] = await Promise.all([
        fetchLmePrice(),
        fetchAluminumOutlook(),
        fetchScrapPrices(),
        fetchJapanScrapPrices(),
        fetchPrevDayData(token, 'aluminum'),
      ]);
    }
    if (tab === 'ferroalloy') {
      [exchangeRate, prevFerroalloy] = await Promise.all([
        fetchCNYUSDRate(token, { saveToFirestore, getFromFirestore }),
        fetchPrevDayData(token, 'ferroalloy'),
      ]);
    }
    if (tab === 'recarburizer') {
      prevRecarburizer = await fetchPrevDayData(token, 'recarburizer');
    }
    if (tab === 'steelmaker') {
      prevSteelmaker = await fetchPrevDayData(token, 'steelmaker');
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
          summaryContext += `종합: ${fa.market_summary ?? ''}\n`;
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
          summaryContext += `부원료 수요 전망: ${sm.raw_material_forecast?.summary ?? ''}\n`;
        }

        console.log('[Summary] 탭 데이터 주입 완료');
      } catch (e) {
        console.warn('[Summary] 탭 데이터 주입 실패:', e.message);
      }
    }

    // ── 5. 프롬프트 구성 ──────────────────────────────────────────────────
    let prompt = PROMPTS[tab];

    // 전일 비교 컨텍스트 주입
    if (tab === 'aluminum' && prevAluminum) {
      const p = prevAluminum.data;
      prompt += `\n\n【전일 데이터 (${prevAluminum.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】\n`;
      prompt += `전일 LME: ${p.lme?.price ?? 'N/A'} USD/MT (변동: ${p.lme?.change ?? 'N/A'} USD)\n`;
      prompt += `전일 move_reason 요약: ${p.lme?.move_reason?.slice(0, 80) ?? 'N/A'}\n`;
      prompt += `전일 스크랩 요약: ${p.scrap?.weekly_summary?.slice(0, 100) ?? 'N/A'}\n`;
      prompt += `→ 오늘 위 수치 대비 달라진 것 구체적 서술. 달라진 것 없으면 "전일 대비 보합" 명시.\n`;
    }

    if (tab === 'ferroalloy' && prevFerroalloy) {
      const p = prevFerroalloy.data;
      prompt += `\n\n【전일 데이터 (${prevFerroalloy.date}) — 반드시 아래 수치와 오늘을 비교】\n`;
      prompt += `전일 FeSi: CNY ${p.fesi?.price_cny ?? 'N/A'}/MT\n`;
      prompt += `전일 FeMn: CNY ${p.femn?.price_cny ?? 'N/A'}/MT\n`;
      prompt += `전일 SiMn: CNY ${p.simn?.price_cny ?? 'N/A'}/MT\n`;
      prompt += `전일 종합: ${p.market_summary?.slice(0, 100) ?? 'N/A'}\n`;
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

    // ── 8. CNY → USD 환율 적용 (ferroalloy) ──────────────────────────────
    if (tab === 'ferroalloy' && exchangeRate) {
      for (const product of ['fesi', 'femn', 'simn']) {
        if (parsed[product]?.price_cny) {
          parsed[product].price_usd = cnyToUsd(parsed[product].price_cny, exchangeRate);
        }
      }
      parsed.exchange_rate_cny_usd = exchangeRate;
      console.log(`[ExRate] ferroalloy USD 변환 완료: 1 CNY = ${exchangeRate} USD`);
    }

    // ── 9. 유효성 검사 + Firestore 저장 ──────────────────────────────────
    if (token) {
      try {
        const isValidData = (() => {
          if (tab === 'aluminum')     return !!(parsed.lme?.price || parsed.lme?.market_status);
          if (tab === 'ferroalloy')   return !!(parsed.fesi?.price_cny || parsed.market_summary);
          if (tab === 'steelmaker')   return !!(parsed.domestic_makers?.length > 0 || parsed.raw_material_forecast?.summary);
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
