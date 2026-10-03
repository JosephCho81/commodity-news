// api/_lib/cache-store.js — Firestore 공용 헬퍼 (KST 날짜, 가격 시계열 읽기)

import { getFromFirestore } from './firebase.js';

export const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
