// api/cron-refresh.js — 매일 KST 04:00 자동 갱신 (Vercel Cron)
// vercel.json의 cron: "0 19 * * *" (UTC 19:00 = KST 04:00)
// Firestore: commodity_cache/{tab} 문서를 덮어쓰기 (최신 1개 유지)

export const config = { maxDuration: 300 }; // 5분 (4개 탭 순차 호출)

// summary는 4탭 캐시를 주입받으므로 4탭 완료 후 순차 호출 (병렬이면 어제 데이터 주입됨)
const TABS = ['steelmaker', 'aluminum', 'ferroalloy', 'recarburizer'];
const FINAL_TAB = 'summary';

export default async function handler(req, res) {
  // Vercel Cron 인증 헤더 검증
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[Cron] 인증 실패');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = new Date().toISOString();
  console.log(`[Cron] 자동 갱신 시작: ${startedAt}`);

  const results = {};

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://commodity-news-topaz.vercel.app';

  const refreshTab = async (tab) => {
    try {
      console.log(`[Cron] 갱신 시작: ${tab}`);
      const url = `${baseUrl}/api/get-news?tab=${tab}&force=true&secret=${process.env.ADMIN_SECRET}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(110000) });
      const json = await r.json();
      if (json.error) {
        console.error(`[Cron] ${tab} 실패:`, json.error);
        results[tab] = { ok: false, error: json.error };
      } else {
        console.log(`[Cron] ${tab} 갱신 완료`);
        results[tab] = { ok: true };
      }
    } catch (e) {
      console.error(`[Cron] ${tab} 예외:`, e.message);
      results[tab] = { ok: false, error: e.message };
    }
  };

  await Promise.allSettled(TABS.map(refreshTab));
  await refreshTab(FINAL_TAB); // 4탭의 오늘 캐시가 생성된 뒤에 summary 생성

  const totalTabs = TABS.length + 1;
  const successCount = Object.values(results).filter(r => r.ok).length;
  console.log(`[Cron] 완료: ${successCount}/${totalTabs} 성공`);

  return res.status(200).json({
    started_at: startedAt,
    results,
    success: successCount,
    total: totalTabs,
  });
}
