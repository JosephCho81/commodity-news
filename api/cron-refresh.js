// api/cron-refresh.js — 매일 KST 04:00 자동 갱신 (Vercel Cron)
// vercel.json의 cron: "0 19 * * *" (UTC 19:00 = KST 04:00)
// Firestore: commodity_cache/{tab} 문서를 덮어쓰기 (최신 1개 유지)

export const config = { maxDuration: 300 }; // 5분 — 스냅샷(~10s) + 탭 병렬(≤110s) + summary(≤110s) + 남은 시간에 실패 탭 재시도

import { FIREBASE_ENABLED, getFirestoreToken, saveToFirestore } from './_lib/firebase.js';
import { getKSTDate } from './_lib/cache-store.js';
import { refreshSnapshot } from './_lib/snapshot.js';

// summary는 4탭 캐시를 주입받으므로 4탭 완료 후 순차 호출 (병렬이면 어제 데이터 주입됨)
const TABS = ['steelmaker', 'aluminum', 'dross', 'ferroalloy', 'recarburizer'];
const FINAL_TAB = 'summary';
const BUDGET_MS = 285000;
const MIN_RETRY_MS = 60000;

export default async function handler(req, res) {
  // Vercel Cron 인증 헤더 검증
  const authHeader = req.headers['authorization'];
  // CRON_SECRET 미설정 시 'Bearer undefined'로 통과되는 것 방지
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[Cron] 인증 실패');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  console.log(`[Cron] 자동 갱신 시작: ${startedAt}`);

  const results = {};

  // VERCEL_URL(배포 생성 URL)은 Vercel Authentication으로 보호되어 self-fetch가
  // 로그인 HTML을 받고 json 파싱에 실패한다 — 반드시 공개 커스텀 도메인 사용
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'https://news.a1kor.com';

  const refreshTab = async (tab, timeoutMs = 110000) => {
    const started = Date.now();
    let outcome;
    try {
      console.log(`[Cron] 갱신 시작: ${tab}`);
      const url = `${baseUrl}/api/get-news?tab=${tab}&force=true&secret=${process.env.ADMIN_SECRET}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const json = await r.json();
      // 생성 실패 시 get-news는 전날 내용(_fallback)을 200으로 돌려준다 — 오늘 캐시가 안 생겼으므로 실패로 센다
      if (json.error) outcome = { ok: false, error: json.error };
      else if (json._fallback) outcome = { ok: false, error: `전날 내용 반환 (${json._fallback_reason ?? '사유 미상'})` };
      else outcome = { ok: true };
    } catch (e) {
      outcome = { ok: false, error: e.message };
    }
    outcome.sec = Math.round((Date.now() - started) / 1000);
    const attempts = (results[tab]?.attempts ?? 0) + 1;
    results[tab] = { ...outcome, attempts };
    if (outcome.ok) console.log(`[Cron] ${tab} 갱신 완료 (${outcome.sec}s)`);
    else console.error(`[Cron] ${tab} 실패 (${outcome.sec}s):`, outcome.error);
  };

  // 숫자 스냅샷을 먼저 수집 — 탭 생성 실패와 무관하게 오늘 숫자는 남긴다
  let token = null;
  if (FIREBASE_ENABLED) {
    try {
      token = await getFirestoreToken();
      const snap = await refreshSnapshot(token);
      results.snapshot = { ok: true, missing: snap.errors, sec: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      results.snapshot = { ok: false, error: e.message };
      console.error('[Cron] 스냅샷 실패:', e.message);
    }
  }

  await Promise.allSettled(TABS.map(t => refreshTab(t)));
  await refreshTab(FINAL_TAB); // 4탭의 오늘 캐시가 생성된 뒤에 summary 생성

  // 남은 시간 안에서 실패 탭 1회 재시도 (summary는 이미 생성됨 — 재시도분은 다음 날 브리핑부터 반영)
  const failed = TABS.filter(t => !results[t].ok);
  const remaining = BUDGET_MS - (Date.now() - t0);
  if (failed.length && remaining >= MIN_RETRY_MS) {
    console.log(`[Cron] 재시도: ${failed.join(', ')} (남은 ${Math.round(remaining / 1000)}s)`);
    await Promise.allSettled(failed.map(t => refreshTab(t, Math.min(110000, remaining - 5000))));
  }

  const totalTabs = TABS.length + 1;
  const successCount = [...TABS, FINAL_TAB].filter(t => results[t]?.ok).length;
  console.log(`[Cron] 완료: ${successCount}/${totalTabs} 성공`);

  // Vercel Hobby 로그는 1시간만 남는다 — 실패 원인 추적용으로 결과를 보관
  if (token) {
    try {
      await saveToFirestore(token, 'commodity_cache', `cron_log_${getKSTDate()}`, {
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: String(successCount),
        total: String(totalTabs),
        results,
      });
    } catch (e) {
      console.warn('[Cron] 결과 기록 실패:', e.message);
    }
  }

  return res.status(200).json({
    started_at: startedAt,
    results,
    success: successCount,
    total: totalTabs,
  });
}
