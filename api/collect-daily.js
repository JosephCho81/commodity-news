// api/collect-daily.js — 매일 KST 03:30 수집 (Vercel Cron "30 18 * * *")
// 1) 시장 숫자 스냅샷  2) 시장별 근거 묶음(신뢰 소스 기사 본문). LLM 호출 없음.
// 04:00 cron-refresh(생성)보다 먼저 돌아 생성 단계가 같은 숫자·같은 근거를 쓰게 한다.

export const config = { maxDuration: 120 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore, saveToFirestore } from './_lib/firebase.js';
import { getKSTDate } from './_lib/cache-store.js';
import { refreshSnapshot } from './_lib/snapshot.js';
import { collectEvidence } from './_lib/evidence.js';

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

  result.sec = Math.round((Date.now() - t0) / 1000);
  await saveToFirestore(token, 'commodity_cache', `collect_log_${date}`, { result }).catch(() => {});
  console.log(`[Collect] ${JSON.stringify(result)}`);
  return res.status(result.snapshot.ok && result.evidence.ok ? 200 : 500).json(result);
}
