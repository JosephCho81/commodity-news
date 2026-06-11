// api/get-news.js — 비철금속 원자재 인텔리전스 API (라우팅 + 범용 탭 오케스트레이터)
// 탭별 로직: _lib/tab-{aluminum,steelmaker,recarburizer,summary}.js + _lib/ferroalloy-tab.js
// 탭 모듈 인터페이스: recency·maxTokens·prefetch → buildPrompt → postProcess → isValid → newsItems

export const config = { maxDuration: 60 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore } from './_lib/firebase.js';
import { callPerplexity, parseJSON } from './_lib/perplexity.js';
import { stripUncertaintyDeep } from './_lib/validate.js';
import { buildKrNewsSection } from './_lib/rss-news.js';
import { handleFerroalloyTab } from './_lib/ferroalloy-tab.js';
import {
  getKSTDate, buildExclusionSection, saveNewsHistory, readLatest, saveWithLatest,
} from './_lib/cache-store.js';
import * as tabAluminum     from './_lib/tab-aluminum.js';
import * as tabSteelmaker   from './_lib/tab-steelmaker.js';
import * as tabRecarburizer from './_lib/tab-recarburizer.js';
import * as tabSummary      from './_lib/tab-summary.js';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

const TAB_MODULES = {
  aluminum:     tabAluminum,
  steelmaker:   tabSteelmaker,
  recarburizer: tabRecarburizer,
  summary:      tabSummary,
};

const VALID_TABS = new Set(['steelmaker', 'aluminum', 'ferroalloy', 'recarburizer', 'summary']);

function sendLatestFallback(res, latest) {
  return res.status(200).json({
    ...JSON.parse(latest.data),
    _cached: true, _fallback: true, _age_min: 0,
    _data_date: latest.date ?? null,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!PERPLEXITY_API_KEY) {
    return res.status(500).json({ error: 'PERPLEXITY_API_KEY not set' });
  }

  const tab = (req.query.tab || 'summary').toLowerCase();
  // ADMIN_SECRET 미설정 시 undefined === undefined로 force가 뚫리는 것 방지
  const force =
    req.query.force === 'true' &&
    !!process.env.ADMIN_SECRET &&
    req.query.secret === process.env.ADMIN_SECRET;

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
    const todayKST = getKSTDate();
    if (token && !force) {
      try {
        const cached = await getFromFirestore(token, 'commodity_cache', `${tab}_${todayKST}`);
        if (cached?.data) {
          const ageMin = cached.cached_at
            ? Math.round((Date.now() - Number(cached.cached_at)) / 60000)
            : 0;
          console.log(`[Cache] HIT: ${tab}_${todayKST}, age: ${ageMin}분`);
          return res.status(200).json({
            ...JSON.parse(cached.data),
            _cached: true,
            _age_min: ageMin,
            _data_date: cached.date ?? todayKST,
            _cached_at: cached.cached_at ? Number(cached.cached_at) : null,
          });
        }
        console.log(`[Cache] MISS: ${tab}_${todayKST} → Perplexity 동기 호출`);
      } catch (e) {
        console.warn('[Firestore] 캐시 읽기 실패:', e.message);
      }
    }

    // ── 3. ferroalloy 멀티콜 — 전용 모듈 ────────────────────────────────────
    if (tab === 'ferroalloy') {
      return await handleFerroalloyTab(token, res);
    }

    // ── 4. 범용 탭 흐름: prefetch → 프롬프트 → Perplexity → 후처리 → 저장 ──
    const mod = TAB_MODULES[tab];
    const ctx = await mod.prefetch(token);

    let prompt = mod.buildPrompt(ctx);

    // 국내 전문지 1차 보도 주입 — 국내 시황 서술의 사실 근거 (공통)
    if (ctx.krNews?.length > 0) {
      prompt += buildKrNewsSection(ctx.krNews,
        '국내 동향 서술 시 아래 1차 보도를 우선 근거로 사용. 헤드라인에 없는 국내 사실을 지어내지 말 것.\n');
    }
    // 최근 보도 이슈 제외 목록 주입 — 뉴스 반복 방지 (공통)
    if (ctx.newsHistory?.length > 0) {
      prompt += buildExclusionSection(ctx.newsHistory);
    }

    console.log(`[Perplexity] 호출 시작: ${tab} (recency: ${mod.recency ?? '없음'})`);
    const { content: raw, searchResults } = await callPerplexity(prompt, {
      maxTokens: mod.maxTokens,
      recency: mod.recency ?? null,
      withMeta: true,
    });

    let parsed;
    try {
      parsed = stripUncertaintyDeep(parseJSON(raw));
    } catch (e) {
      console.error('[JSON] 파싱 실패:', e.message, '| raw:', raw.slice(0, 300));
      const latest = await readLatest(token, tab);
      if (latest?.data) {
        console.log(`[Fallback] JSON 파싱 실패 → ${tab}_latest 반환`);
        return sendLatestFallback(res, latest);
      }
      return res.status(500).json({ error: 'JSON parse failed', detail: e.message, raw_preview: raw.slice(0, 300) });
    }

    // 탭별 결정적 후처리 (가격 주입·검증·dedup·시계열)
    await mod.postProcess({ parsed, ctx, searchResults, token });

    // 공통 메타 부착
    if (tab !== 'summary') {
      parsed._sources = (searchResults ?? []).slice(0, 8);
      if (ctx.krNews?.length > 0) parsed._kr_news = ctx.krNews;
      const futuresList = Object.values(ctx.chainFutures ?? {}).filter(Boolean);
      if (futuresList.length > 0) parsed._china_futures = futuresList;
    }

    // ── 5. 유효성 검사 + Firestore 저장 + 뉴스 히스토리 ──────────────────
    if (token) {
      try {
        if (!mod.isValid(parsed)) {
          console.warn(`[Firestore] 유효성 검사 실패 — ${tab}_latest fallback 시도`);
          const latest = await readLatest(token, tab);
          if (latest?.data) return sendLatestFallback(res, latest);
          return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
        }

        await saveWithLatest(token, tab, `${tab}_${todayKST}`, {
          data: JSON.stringify(parsed),
          cached_at: String(Date.now()),
          tab,
          date: todayKST,
        });

        // 저장 성공 시에만 뉴스 히스토리 갱신
        const newItems = mod.newsItems(parsed, todayKST) ?? [];
        if (newItems.length > 0) {
          await saveNewsHistory(token, tab, ctx.newsHistory ?? [], newItems, todayKST);
        }
      } catch (e) {
        console.warn('[Firestore] 저장 실패:', e.message);
      }
    }

    return res.status(200).json({ ...parsed, _cached: false, _age_min: 0, _data_date: todayKST });

  } catch (err) {
    console.error('[Handler] 예외:', err.message);
    const latest = await readLatest(token, tab);
    if (latest?.data) {
      console.log(`[Fallback] 예외 → ${tab}_latest 반환`);
      return sendLatestFallback(res, latest);
    }
    return res.status(500).json({ error: err.message });
  }
}
