// api/audit.js — 품질 점검(읽기 전용, 내부용). 기준: docs/quality.md. Bearer CRON_SECRET.
// ?date=YYYY-MM-DD (없으면 최신): 그날 결함(지금 코드로 다시 집계) + 시장별 근거 기사(제목·매체·발행일)·탈락 문장 + 수집 로그
// ?days=N (최대 14): 최근 N일의 날짜별 결함 개수 — 리포트 N건(+옛 리포트는 스냅샷 N건)과 시계열 1건만 읽는다(Firestore 무료 한도)

export const config = { maxDuration: 15 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore } from './_lib/firebase.js';
import { auditReport, noticeFacts } from './_lib/quality.js';
import { seriesStats } from './_lib/market-metrics.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parse = (doc, field = 'data') => { try { return doc?.[field] ? JSON.parse(doc[field]) : null; } catch { return null; } };

// 오늘(KST)부터 거꾸로 n일 (순수 함수) — 리포트는 주말에도 만든다
export function recentDays(n, now = Date.now()) {
  return Array.from({ length: n }, (_, i) => new Date(now + 9 * 3600e3 - i * 86400e3).toISOString().slice(0, 10));
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!FIREBASE_ENABLED) return res.status(500).json({ error: 'Firestore 비활성' });
  res.setHeader('Cache-Control', 'no-store');
  const token = await getFirestoreToken();
  const read = (id) => getFromFirestore(token, 'commodity_cache', id).catch(() => null);
  // 품질 장치 이전 리포트에는 fx·notices가 없다 — 시계열·그날 스냅샷으로 채워 같은 기준으로 센다
  let history = null;
  const audit = async (r) => {
    let fx = r.fx;
    if (!fx) {
      history ??= parse(await read('price_history_market'), 'items') ?? [];
      fx = seriesStats(history.filter(x => x.d <= r.date), 'usdkrw');
    }
    if (!r.notices) r.notices = noticeFacts(parse(await read(`market_snapshot_${r.date}`)));
    return auditReport(r, fx);
  };

  const days = Math.min(Math.max(Number(req.query?.days) || 0, 0), 14);
  if (days) {
    const rows = [];
    for (const date of recentDays(days)) {
      const r = parse(await read(`market_report_${date}`));
      if (!r) { rows.push({ date, missing: true }); continue; }
      const q = await audit(r);
      rows.push({ date, counts: q.counts, by_id: q.by_id, removed: q.removed, cite_dropped: q.cite_dropped, stored: r.quality?.counts ?? null });
    }
    return res.status(200).json({ days: rows });
  }

  const date = req.query?.date;
  if (date && !DATE_RE.test(date)) return res.status(400).json({ error: 'date는 YYYY-MM-DD' });
  const r = parse(await read(date ? `market_report_${date}` : 'market_report_latest'));
  if (!r) return res.status(404).json({ error: '리포트 없음' });
  const markets = Object.fromEntries(Object.entries(r.markets ?? {}).map(([k, m]) => [k, {
    sources: (m.sources ?? []).map(s => ({ id: s.id, source: s.source, published: s.published, repeat: s.repeat, title: s.title, url: s.url })),
    why_src: (m.why ?? []).map(w => ({ title: w.title, src: w.src })),
    dropped: m.dropped ?? [], error: m.error ?? null,
  }]));
  const log = await read(`collect_log_${r.date}`);
  return res.status(200).json({
    date: r.date, generated_at: r.generated_at, quality: await audit(r), stored_quality: r.quality?.counts ?? null,
    markets, checks: r.checks ?? null, collect_log: log?.result ?? null,
  });
}
