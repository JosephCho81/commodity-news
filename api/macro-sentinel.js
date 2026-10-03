// api/macro-sentinel.js — 매크로 이벤트 감지 (GitHub Actions가 매시간 호출)
// 평시: Google News 와이어 수집 + 판정만 (LLM 비용 0).
// 새 이벤트 감지 시 regenerate:true를 돌려주고, 워크플로가 /api/collect-daily를 호출해 리포트를 다시 만든다.
// (이 함수가 직접 재생성하면 120초 제한에 걸린다 — 재생성은 300초짜리 collect-daily가 맡는다)

export const config = { maxDuration: 60 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore, saveToFirestore } from './_lib/firebase.js';
import { fetchGlobalMacroNews, isMacroTrigger } from './_lib/macro-news.js';
import { getKSTDate } from './_lib/cache-store.js';

const MAX_TRIGGERS_PER_DAY = 1;          // 재생성 비용 상한 (사용자 지시 2026-10-03)
const ACTIVE_KST_HOURS = [6, 23];        // 새벽 03:30 정기 수집이 있으므로 야간 트리거는 낭비

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

  const regenerate = wouldTrigger && !blocked && !dryRun;
  if (regenerate) {
    console.log(`[Sentinel] 트리거: ${state?.fingerprint ?? '(없음)'} → ${analysis.fingerprint} (score ${analysis.score})`);
    await saveToFirestore(token, 'commodity_cache', 'macro_state', {
      fingerprint: analysis.fingerprint,
      score: String(analysis.score),
      date: todayKST,
      triggers_today: String(triggersToday + 1),
      updated_at: String(Date.now()),
    }).catch(e => console.warn('[Sentinel] 상태 저장 실패:', e.message));
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
    regenerate,
  });
}
