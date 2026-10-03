// api/kr-scrap-archive.js — 국내 알루미늄 스크랩 주간 고시 보관
// 고시는 같은 게시글을 매주 덮어써서 과거분이 사라진다 → 새 이미지가 보이면 원본과 판독값을 함께 보관.
// GitHub Actions(.github/workflows/kr-scrap-archive.yml)가 OCR 후 POST 한다.

export const config = { maxDuration: 30 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore, saveToFirestore } from './_lib/firebase.js';
import { buildRecord } from './_lib/kr-scrap.js';

const COLLECTION = 'kr_scrap_weekly';

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!FIREBASE_ENABLED) return res.status(500).json({ error: 'Firestore 비활성' });

  const { raw, image_b64, image_sha256, source_url } = req.body ?? {};
  if (!raw || typeof image_b64 !== 'string' || !/^[0-9a-f]{64}$/.test(image_sha256 ?? '')) {
    return res.status(400).json({ error: 'raw·image_b64·image_sha256 필요' });
  }

  const token = await getFirestoreToken();
  const latest = await getFromFirestore(token, COLLECTION, '_latest');
  if (latest?.image_sha256 === image_sha256) {
    return res.status(200).json({ status: 'unchanged', base_date: latest.base_date ?? null });
  }

  let prev = null;
  try { prev = latest?.record ? JSON.parse(latest.record) : null; } catch { prev = null; }

  const { record, issues, fatal } = buildRecord(raw, prev);
  const status = fatal ? 'failed' : issues.length ? 'review' : 'ok';
  const docId = !fatal && record.base_date ? record.base_date : `failed-${image_sha256.slice(0, 12)}`;

  await saveToFirestore(token, COLLECTION, docId, {
    status,
    record: record,
    raw: raw,
    issues: issues,
    image_b64,
    image_sha256,
    source_url: String(source_url ?? ''),
    fetched_at: new Date().toISOString(),
  });

  // 판독 실패여도 같은 이미지를 매번 다시 처리하지 않도록 해시는 갱신하되, 대조 기준(record)은 마지막 정상값 유지
  await saveToFirestore(token, COLLECTION, '_latest', {
    image_sha256,
    base_date: fatal ? (latest?.base_date ?? '') : record.base_date,
    record: fatal ? (prev ?? {}) : record,
    last_status: status,
    updated_at: new Date().toISOString(),
  });

  console.log(`[KrScrap] ${docId} ${status}${issues.length ? ' — ' + issues.join(' / ') : ''}`);
  return res.status(fatal ? 422 : 200).json({ status, doc: docId, issues });
}
