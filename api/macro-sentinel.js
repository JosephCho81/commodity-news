// api/macro-sentinel.js — 매크로 이벤트 감지 시 브리핑 즉시 재생성 (이벤트 드리븐)
// GitHub Actions가 매시간 호출 (.github/workflows/macro-sentinel.yml).
// 평시: RSS 수집 + 판정만 (LLM 비용 0). 새 이벤트 감지 시에만 summary 강제 갱신.

export const config = { maxDuration: 120 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore, saveToFirestore } from './_lib/firebase.js';
import { fetchGlobalMacroNews, isMacroTrigger } from './_lib/macro-news.js';
import { getKSTDate } from './_lib/cache-store.js';

const MAX_TRIGGERS_PER_DAY = 3;          // Perplexity 비용 상한 (이벤트일에만 소진)
const ACTIVE_KST_HOURS = [6, 23];        // 새벽 04:00 정기 cron이 있으므로 야간 트리거는 낭비

// 배포 URL(VERCEL_URL)은 Vercel Authentication으로 보호되어 self-fetch가 차단됨 — 공개 도메인 사용
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://news.a1kor.com';

export default async function handler(req, res) {
  // CRON_SECRET 미설정 시 'Bearer undefined'로 통과되는 것 방지
  if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const dryRun = req.query.dry === 'true';

  const { items, analysis } = await fetchGlobalMacroNews();

  let token = null;
  let state = null;
  if (FIREBASE_ENABLED) {
    try {
      token = await getFirestoreToken();
      state = await getFromFirestore(token, 'commodity_cache', 'macro_state').catch(() => null);
    } catch (e) {
      console.warn('[Sentinel] Firestore 접근 실패:', e.message);
    }
  }

  const todayKST = getKSTDate();
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  const triggersToday = state?.date === todayKST ? Number(state.triggers_today ?? 0) : 0;

  const wouldTrigger = isMacroTrigger(analysis, state?.fingerprint);
  const blocked =
    !wouldTrigger ? null
    : kstHour < ACTIVE_KST_HOURS[0] || kstHour >= ACTIVE_KST_HOURS[1] ? 'KST 야간'
    : triggersToday >= MAX_TRIGGERS_PER_DAY ? '일일 트리거 상한'
    : !token ? 'Firestore 토큰 없음'
    : null;

  let refreshed = false;
  if (wouldTrigger && !blocked && !dryRun) {
    console.log(`[Sentinel] 트리거: ${state?.fingerprint ?? '(없음)'} → ${analysis.fingerprint} (score ${analysis.score})`);
    try {
      const url = `${PUBLIC_BASE_URL}/api/get-news?tab=summary&force=true&secret=${process.env.ADMIN_SECRET}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(110000) });
      const json = await r.json();
      refreshed = !json.error;
      if (json.error) console.error('[Sentinel] summary 갱신 실패:', json.error);
    } catch (e) {
      console.error('[Sentinel] summary 갱신 예외:', e.message);
    }
    if (refreshed) {
      await saveToFirestore(token, 'commodity_cache', 'macro_state', {
        fingerprint: analysis.fingerprint,
        score: String(analysis.score),
        date: todayKST,
        triggers_today: String(triggersToday + 1),
        updated_at: String(Date.now()),
      }).catch(e => console.warn('[Sentinel] 상태 저장 실패:', e.message));
    }
  }

  return res.status(200).json({
    items: items.length,
    fingerprint: analysis.fingerprint,
    prev_fingerprint: state?.fingerprint ?? null,
    score: analysis.score,
    distinct_sources: analysis.distinctSources,
    would_trigger: wouldTrigger,
    blocked,
    dry_run: dryRun,
    refreshed,
  });
}
