// api/get-report.js — 새 화면(v3)용 하루치 리포트 + 숫자 (읽기 전용, 생성 없음)
// 생성은 03:30 collect-daily만 한다. 방문자 요청으로 LLM을 부르지 않는다.
// 하루 1회 바뀌는 데이터라 CDN에 캐시(10분, 이후 1시간은 백그라운드 갱신하며 이전 값 제공).

export const config = { maxDuration: 15 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore } from './_lib/firebase.js';

const parse = (doc, field = 'data') => { try { return doc?.[field] ? JSON.parse(doc[field]) : null; } catch { return null; } };

// 직전 리포트(어제 대비 신호 변화용) — 최대 4일 전까지
async function previousReport(token, date) {
  for (let i = 1; i <= 4; i++) {
    const d = new Date(Date.parse(`${date}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10);
    const rep = parse(await getFromFirestore(token, 'commodity_cache', `market_report_${d}`).catch(() => null));
    if (rep) return rep;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!FIREBASE_ENABLED) return res.status(500).json({ error: 'Firestore 비활성' });

  const token = await getFirestoreToken();
  const [repDoc, snapDoc] = await Promise.all([
    getFromFirestore(token, 'commodity_cache', 'market_report_latest'),
    getFromFirestore(token, 'commodity_cache', 'market_snapshot_latest'),
  ]);
  const report = parse(repDoc);
  const snap = parse(snapDoc);
  if (!report) return res.status(503).json({ error: '리포트 준비 중' });

  const prev = await previousReport(token, report.date);
  const markets = {};
  for (const [k, m] of Object.entries(report.markets ?? {})) {
    const { usage, dropped, model, ...rest } = m; // 내부 진단 필드는 화면에 보내지 않는다
    markets[k] = { ...rest, prev_signal: prev?.markets?.[k]?.signal ?? null };
  }
  const brief = report.brief ? { one_liner: report.brief.one_liner, lead: report.brief.lead, common: report.brief.common ?? [] } : null;

  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json({
    date: report.date,
    generated_at: report.generated_at,
    brief,
    markets,
    numbers: snap ? {
      date: snap.date,
      fx: snap.fx,
      lme_al: snap.lme_al,
      scrap_kr: snap.scrap_kr,
      scrap_overseas: snap.scrap_overseas,
      anthracite_customs: snap.anthracite_customs,
    } : null,
  });
}
