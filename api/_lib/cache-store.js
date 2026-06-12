// api/_lib/cache-store.js — Firestore 캐시·히스토리 공용 헬퍼
// (뉴스 히스토리 / 가격 시계열 / _latest fallback / 일자 캐시 저장)

import { saveToFirestore, getFromFirestore } from './firebase.js';

export const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// 최근 1~3일 내 가장 가까운 일자 캐시 (전일 비교 컨텍스트용)
export async function fetchPrevDayData(token, tab) {
  if (!token) return null;
  try {
    const days = [1, 2, 3].map(i =>
      new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10)
    );
    const docs = await Promise.all(
      days.map(d => getFromFirestore(token, 'commodity_cache', `${tab}_${d}`).catch(() => null))
    );
    const idx = docs.findIndex(doc => doc?.data);
    if (idx === -1) return null;
    console.log(`[PrevDay] ${tab} 전일 데이터 로드: ${days[idx]}`);
    return { date: days[idx], data: JSON.parse(docs[idx].data) };
  } catch (e) {
    console.warn('[PrevDay] 전일 데이터 로드 실패:', e.message);
  }
  return null;
}

// ─── 뉴스 히스토리 (최근 7일 보도 이슈 — 중복 제거용) ───────────────────────
const NEWS_HISTORY_DAYS = 7;

export async function readNewsHistory(token, tab) {
  if (!token) return [];
  try {
    const doc = await getFromFirestore(token, 'commodity_cache', `news_history_${tab}`).catch(() => null);
    if (doc?.items) {
      const items = JSON.parse(doc.items);
      if (Array.isArray(items)) return items;
    }
  } catch (e) {
    console.warn('[NewsHistory] 읽기 실패:', e.message);
  }
  return [];
}

export function buildExclusionSection(historyItems, productKey = null) {
  const items = productKey ? historyItems.filter(h => h.k === productKey) : historyItems;
  if (items.length === 0) return '';
  let s = '\n\n【최근 보도한 이슈 — 제외】\n아래는 최근 7일 내 이미 보도한 이슈 목록. 실질적으로 같은 이슈는 다시 선정하지 말 것. 단, 같은 사안이라도 국면이 전환된 경우(예: 갈등→합의, 협상→결렬, 검토→시행)는 반복이 아니라 신규 이슈로 취급해 반드시 선정. 가격·수치에 새로운 변화가 보도된 경우도 새 수치 중심으로 작성 가능:\n';
  for (const h of items) s += `- (${h.d}) ${h.t}\n`;
  return s;
}

export async function saveNewsHistory(token, tab, historyItems, newItems, todayKST) {
  if (!token || newItems.length === 0) return;
  try {
    const cutoff = new Date(new Date(todayKST + 'T00:00:00Z').getTime() - NEWS_HISTORY_DAYS * 86400000)
      .toISOString().slice(0, 10);
    const merged = [...historyItems, ...newItems].filter(h => h?.d && h.d >= cutoff);
    await saveToFirestore(token, 'commodity_cache', `news_history_${tab}`, {
      items: JSON.stringify(merged),
      updated_at: String(Date.now()),
    });
    console.log(`[NewsHistory] ${tab} 저장: 신규 ${newItems.length}건, 총 ${merged.length}건`);
  } catch (e) {
    console.warn('[NewsHistory] 저장 실패:', e.message);
  }
}

// key_issues 배열에서 히스토리 항목 생성
export function issuesToHistory(issues, todayKST, productKey = null) {
  return (Array.isArray(issues) ? issues : [])
    .filter(i => i?.title)
    .map(i => ({ t: i.title, d: todayKST, u: i.url ?? null, k: productKey }));
}

// ─── 가격 시계열 (스파크라인·입찰 기준점용 — 결정적 수치만 적립) ─────────────
const PRICE_HISTORY_DAYS = 90;

export async function readPriceHistory(token, tab) {
  if (!token) return [];
  try {
    const doc = await getFromFirestore(token, 'commodity_cache', `price_history_${tab}`).catch(() => null);
    if (doc?.items) {
      const items = JSON.parse(doc.items);
      if (Array.isArray(items)) return items;
    }
  } catch (e) {
    console.warn('[PriceHistory] 읽기 실패:', e.message);
  }
  return [];
}

// entry = { d: 'YYYY-MM-DD', ...수치 } — 같은 날짜는 덮어쓰고 90일 초과분 제거
export async function savePriceHistory(token, tab, history, entry) {
  if (!token || !entry?.d) return history;
  try {
    const merged = [...history.filter(h => h?.d && h.d !== entry.d), entry]
      .sort((a, b) => a.d.localeCompare(b.d))
      .slice(-PRICE_HISTORY_DAYS);
    await saveToFirestore(token, 'commodity_cache', `price_history_${tab}`, {
      items: JSON.stringify(merged),
      updated_at: String(Date.now()),
    });
    return merged;
  } catch (e) {
    console.warn('[PriceHistory] 저장 실패:', e.message);
    return history;
  }
}

// ─── _latest fallback + 일자 캐시 저장 ──────────────────────────────────────
export async function readLatest(token, tab) {
  if (!token) return null;
  try {
    const doc = await getFromFirestore(token, 'commodity_cache', `${tab}_latest`).catch(() => null);
    if (doc?.data) return doc;
  } catch (e) { /* silent */ }
  return null;
}

export async function saveWithLatest(token, tab, docId, saveData) {
  await Promise.all([
    saveToFirestore(token, 'commodity_cache', docId, saveData),
    saveToFirestore(token, 'commodity_cache', `${tab}_latest`, saveData),
  ]);
  console.log(`[Firestore] ✅ 저장: commodity_cache/${docId} + ${tab}_latest`);
}
