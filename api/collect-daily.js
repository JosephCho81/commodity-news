// api/collect-daily.js — 매일 KST 03:30 수집 (Vercel Cron "30 18 * * *")
// 1) 시장 숫자 스냅샷  2) 시장별 근거 묶음(신뢰 소스 기사 본문)  3) 시장별 해석 + 브리핑(LLM 6~11회).
// 04:00 cron-refresh(생성)보다 먼저 돌아 생성 단계가 같은 숫자·같은 근거를 쓰게 한다.

export const config = { maxDuration: 300 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore, saveToFirestore } from './_lib/firebase.js';
import { getKSTDate } from './_lib/cache-store.js';
import { refreshSnapshot } from './_lib/snapshot.js';
import { collectEvidence } from './_lib/evidence.js';
import { generateReport } from './_lib/report.js';
import { callAgent } from './_lib/agent.js';
import { setBudgetToken } from './_lib/budget.js';

const SEEN_DAYS = 5;

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!FIREBASE_ENABLED) return res.status(500).json({ error: 'Firestore 비활성' });

  const t0 = Date.now();
  const date = getKSTDate();
  const token = await getFirestoreToken();
  const result = { date };

  try {
    const snap = await refreshSnapshot(token);
    result.snapshot = { ok: true, missing: snap.errors };
  } catch (e) {
    result.snapshot = { ok: false, error: e.message };
  }

  try {
    const seenDoc = await getFromFirestore(token, 'commodity_cache', 'evidence_seen').catch(() => null);
    let seenItems = [];
    try { seenItems = JSON.parse(seenDoc?.items ?? '[]'); } catch { seenItems = []; }
    const cutoff = new Date(Date.now() - SEEN_DAYS * 86400000).toISOString().slice(0, 10);
    seenItems = seenItems.filter(s => s.d >= cutoff && s.d !== date);

    const { markets, stats } = await collectEvidence({ seen: new Set(seenItems.map(s => s.u)) });
    const payload = { data: JSON.stringify({ date, markets }), date, collected_at: new Date().toISOString() };
    await Promise.all([
      saveToFirestore(token, 'commodity_cache', `evidence_${date}`, payload),
      saveToFirestore(token, 'commodity_cache', 'evidence_latest', payload),
    ]);
    const used = Object.values(markets).flat().map(a => a.url);
    await saveToFirestore(token, 'commodity_cache', 'evidence_seen', {
      items: JSON.stringify([...seenItems, ...[...new Set(used)].map(u => ({ u, d: date }))]),
      updated_at: String(Date.now()),
    });
    result.evidence = { ok: true, stats };
  } catch (e) {
    result.evidence = { ok: false, error: e.message };
  }

  // 3) 시장별 해석 + 브리핑 (LLM, 검색 없음). 숫자·근거가 오늘 것으로 저장된 뒤에만.
  if (result.snapshot.ok && result.evidence?.ok && process.env.PERPLEXITY_API_KEY) {
    try {
      setBudgetToken(token);
      const [hist, snapDoc, evDoc] = await Promise.all([
        getFromFirestore(token, 'commodity_cache', 'price_history_market'),
        getFromFirestore(token, 'commodity_cache', 'market_snapshot_latest'),
        getFromFirestore(token, 'commodity_cache', 'evidence_latest'),
      ]);
      const report = await generateReport({
        history: JSON.parse(hist.items), snap: JSON.parse(snapDoc.data), evidence: JSON.parse(evDoc.data),
        callAgent, date,
      });
      const payload = { data: JSON.stringify(report), date, generated_at: report.generated_at };
      await Promise.all([
        saveToFirestore(token, 'commodity_cache', `market_report_${date}`, payload),
        saveToFirestore(token, 'commodity_cache', 'market_report_latest', payload),
      ]);
      const failed = Object.values(report.markets).filter(m => m.error).map(m => `${m.market}: ${m.error}`);
      result.report = { ok: !failed.length && !report.brief?.error, failed, cost_usd: report.cost_usd, model: report.model };
    } catch (e) {
      result.report = { ok: false, error: e.message };
    }
  }

  result.sec = Math.round((Date.now() - t0) / 1000);
  await saveToFirestore(token, 'commodity_cache', `collect_log_${date}`, { result }).catch(() => {});
  console.log(`[Collect] ${JSON.stringify(result)}`);
  return res.status(result.snapshot.ok && result.evidence.ok ? 200 : 500).json(result);
}
