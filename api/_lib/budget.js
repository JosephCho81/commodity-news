// api/_lib/budget.js — Perplexity 일일 호출 상한(서킷 브레이커)
//
// 2026-07-25~26 glove-news 프롬프트 작업 중 3일간 $21.49(평시의 16배)가 소진됐다.
// 원인은 단가가 아니라 "상한이 없다"는 것 — 어떤 최적화를 해도 상한이 없으면 재발한다.
// 모든 Perplexity 호출은 reserveCall()을 통과해야 하며, 상한 초과 시 호출 자체가 막히고
// 호출부는 캐시 fallback으로 떨어진다(장애가 아니라 의도된 저하).

import { getFromFirestore, saveToFirestore } from './firebase.js';
import { getKSTDate } from './cache-store.js';

const COLLECTION = 'commodity_cache';
const CAP = Number(process.env.PPLX_DAILY_CALL_CAP ?? 40);

// 정상 운영 실측: 6탭 = 10콜/일. 기본 40은 재시도·on-demand 여유를 포함한 4배 헤드룸.
// 상한을 올리기 전에 왜 40을 넘는지부터 확인할 것.

export class BudgetExceededError extends Error {
  constructor(used, cap) {
    super(`Perplexity 일일 상한 초과 (${used}/${cap}) — 호출 차단`);
    this.name = 'BudgetExceededError';
    this.used = used;
    this.cap = cap;
  }
}

// Firestore를 못 쓸 때의 최후 방어. Fluid Compute는 인스턴스를 재사용하므로
// 같은 인스턴스에 몰린 폭주는 이것만으로도 막힌다.
let _local = { date: null, calls: 0 };

let _token = null;
export function setBudgetToken(token) { _token = token; }

function bumpLocal(date, n) {
  if (_local.date !== date) _local = { date, calls: 0 };
  _local.calls += n;
  return _local.calls;
}

/**
 * 호출 1건을 예약한다. 상한을 넘으면 BudgetExceededError를 던진다.
 * @param {string} label 로그용 호출 식별자
 */
export async function reserveCall(label = '') {
  const date = getKSTDate();

  if (!_token) {
    const used = bumpLocal(date, 1);
    if (used > CAP) throw new BudgetExceededError(used, CAP);
    console.log(`[Budget] ${label} — 로컬 카운터 ${used}/${CAP} (Firestore 토큰 없음)`);
    return { used, cap: CAP };
  }

  const docId = `pplx_budget_${date}`;
  let used = 0;
  try {
    const cur = await getFromFirestore(_token, COLLECTION, docId);
    used = Number(cur?.calls ?? 0);
  } catch (e) {
    // 읽기 실패 시 로컬 카운터로 강등 — 상한 자체를 포기하지는 않는다
    const localUsed = bumpLocal(date, 1);
    if (localUsed > CAP) throw new BudgetExceededError(localUsed, CAP);
    console.warn(`[Budget] 카운터 읽기 실패(${e.message}) — 로컬 ${localUsed}/${CAP}`);
    return { used: localUsed, cap: CAP };
  }

  const next = used + 1;
  if (next > CAP) {
    console.error(`[Budget] 🛑 ${label} 차단 — ${next}/${CAP} 초과`);
    throw new BudgetExceededError(next, CAP);
  }

  // 읽고-쓰기 사이의 경합으로 몇 건 과소집계될 수 있으나, 이건 회계가 아니라
  // 폭주 차단 장치다. 상한 근처에서는 어차피 다음 호출이 막힌다.
  try {
    await saveToFirestore(_token, COLLECTION, docId, {
      calls: next,
      date,
      updated_at: String(Date.now()),
    });
  } catch (e) {
    console.warn('[Budget] 카운터 저장 실패:', e.message);
  }
  bumpLocal(date, 1);
  console.log(`[Budget] ${label} — ${next}/${CAP}`);
  return { used: next, cap: CAP };
}
