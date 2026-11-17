// api/explore.js — 세계 동향 탐색 (Vercel Cron "0 20 * * *" = KST 05시대, 리포트 생성 06시대보다 먼저)
// 공식 신호(무료) + 관점 5개 웹 검색 → 원문 대조 → 사안 작성·검증 → commodity_cache/world_{날짜}·world_latest 저장.
// 리포트(market_report_latest)는 건드리지 않는다 — 화면은 get-report가 두 문서를 함께 읽는다. 방문자 요청으로는 돌지 않는다.
// 수동 실행: curl -H "Authorization: Bearer $CRON_SECRET" https://news.a1kor.com/api/explore (LLM 호출 6회)

export const config = { maxDuration: 300 };

import { FIREBASE_ENABLED, getFirestoreToken, getFromFirestore, saveToFirestore } from './_lib/firebase.js';
import { getKSTDate } from './_lib/cache-store.js';
import { setBudgetToken } from './_lib/budget.js';
import { callAgent } from './_lib/agent.js';
import { getText } from './_lib/evidence.js';
import { auditContext } from './_lib/quality.js';
import { runExplore } from './_lib/explore.js';

const COL = 'commodity_cache';
const parse = (doc) => { try { return doc?.data ? JSON.parse(doc.data) : null; } catch { return null; } };

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!FIREBASE_ENABLED) return res.status(500).json({ error: 'Firestore 비활성' });
  if (!process.env.PERPLEXITY_API_KEY) return res.status(500).json({ error: 'PERPLEXITY_API_KEY 없음' });
  const t0 = Date.now();
  const date = getKSTDate();
  const token = await getFirestoreToken();
  setBudgetToken(token);
  const [prevDoc, repDoc] = await Promise.all([
    getFromFirestore(token, COL, 'world_latest').catch(() => null),
    getFromFirestore(token, COL, 'market_report_latest').catch(() => null),
  ]);
  const previous = parse(prevDoc), report = parse(repDoc);
  // 게시 게이트 문맥 — 원/달러 방향·고시 기준일·휴장은 직전 리포트 것으로, 날짜는 오늘
  const ctx = auditContext({ ...(report ?? {}), date });
  let world;
  try {
    world = await runExplore({ date, callAgent, fetchText: getText, previous, ctx, budgetMs: 270000 - (Date.now() - t0) });
  } catch (e) {
    console.error(`[Explore] ${date} 실패: ${e.message}`);
    return res.status(500).json({ date, error: e.message });
  }
  const payload = { data: JSON.stringify(world), date, generated_at: world.generated_at };
  await Promise.all([saveToFirestore(token, COL, `world_${date}`, payload), saveToFirestore(token, COL, 'world_latest', payload)]);
  console.log(`[Explore] ${date} ${world.log.seconds}초 $${world.log.cost_usd} 사안 ${world.issues.length} 신호 ${world.signals.length} — ${JSON.stringify(world.log).slice(0, 600)}`);
  return res.status(world.issues_date === date ? 200 : 207).json({ date, issues: world.issues.map(i => i.title), signals: world.signals.map(s => s.key), log: world.log });
}
