// api/_lib/zce-futures.js — 중국 상품선물 정산가 수집 (결정적 소스)
// 1순위: 신랑재경 hq.sinajs.cn (실시간/최근 거래일, GBK)
// 2순위: czce 공식 일일 정적파일 (czce-daily.js — 합금철 SF/SM만 해당)
// 검증: 2026-06-10 SF 정산 5,874 / SM 6,012 — 양 소스 완전 일치 확인됨.

import { parseCzceText, fetchCzceDaily } from './czce-daily.js';
export { backfillZceHistory } from './czce-daily.js';

// 심볼 정의 — sina nf_ 코드 / 거래소 / 표시명 / hard bound
export const ZCE_SYMBOLS = {
  sf: { sina: 'SF0', exch: 'ZCE',  label: '페로실리콘', en: 'FeSi',  bounds: [3000, 12000] },
  sm: { sina: 'SM0', exch: 'ZCE',  label: '실리코망간', en: 'SiMn',  bounds: [3000, 12000] },
  rb: { sina: 'RB0', exch: 'SHFE', label: '철근',       en: 'Rebar', bounds: [1500, 7000]  },
  hc: { sina: 'HC0', exch: 'SHFE', label: '열연',       en: 'HRC',   bounds: [1500, 7000]  },
  i:  { sina: 'I0',  exch: 'DCE',  label: '철광석',     en: 'IronOre', bounds: [200, 1800] },
  jm: { sina: 'JM0', exch: 'DCE',  label: '원료탄',     en: 'CokingCoal', bounds: [400, 4000] },
  j:  { sina: 'J0',  exch: 'DCE',  label: '코크스',     en: 'Coke',  bounds: [800, 5000]  },
  al: { sina: 'AL0', exch: 'SHFE', label: '1차 알루미늄', en: 'PrimaryAl',   bounds: [12000, 35000] },
  ad: { sina: 'AD0', exch: 'SHFE', label: '2차 알루미늄', en: 'CastAlAlloy', bounds: [12000, 35000] },
};

// ─── sina 한 줄 파싱 (순수 함수 — 테스트 대상) ──────────────────────────────
// 필드: 0=품목명 1=시각 2=시가 3=고가 4=저가 5=? 6=bid 7=ask 8=현재가
//       9=금일정산(미정산 시 0) 10=전일정산 13=미결제 14=거래량 17=날짜
// 야간 세션 중에는 9(정산)가 0 — 그 경우 8(현재가) 사용.
export function parseSinaLine(line) {
  const m = line.match(/hq_str_nf_([A-Z]+0)="([^"]*)"/);
  if (!m) return null;
  const f = m[2].split(',');
  if (f.length < 18) return null;
  const num = (s) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const settle = num(f[9]) ?? num(f[8]) ?? num(f[6]);
  const prev = num(f[10]);
  if (settle === null) return null;
  return {
    sinaSymbol: m[1],
    settle,
    prev_settle: prev,
    change: prev !== null ? +(settle - prev).toFixed(2) : null,
    open_interest: num(f[13]),
    volume: num(f[14]),
    date: /^\d{4}-\d{2}-\d{2}$/.test(f[17]) ? f[17] : null,
  };
}

function withMeta(key, raw, date, source) {
  if (!raw) return null;
  const def = ZCE_SYMBOLS[key];
  // hard bound 검증 — 범위 밖이면 파싱 오류로 간주하고 버림 (NULL 원칙)
  if (raw.settle < def.bounds[0] || raw.settle > def.bounds[1]) {
    console.warn(`[ZCE] ${key} bound 위반으로 폐기: ${raw.settle}`);
    return null;
  }
  const changePct = (raw.change !== null && raw.prev_settle)
    ? `${raw.change >= 0 ? '+' : ''}${((raw.change / raw.prev_settle) * 100).toFixed(2)}%`
    : null;
  return {
    product: def.en,
    label: def.label,
    exchange: def.exch,
    contract: raw.contract ?? '주력',
    settle: raw.settle,
    prev_settle: raw.prev_settle ?? null,
    change: raw.change,
    change_pct: changePct,
    volume: raw.volume ?? null,
    open_interest: raw.open_interest ?? null,
    date: raw.date ?? date ?? null,
    source,
  };
}

// ─── 1순위: sina ────────────────────────────────────────────────────────────
async function fetchFromSina(keys) {
  const list = keys.map(k => `nf_${ZCE_SYMBOLS[k].sina}`).join(',');
  const res = await fetch(`https://hq.sinajs.cn/list=${list}`, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`sina HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  let text;
  try { text = new TextDecoder('gbk').decode(buf); }
  catch { text = new TextDecoder('latin1').decode(buf); }
  const out = {};
  for (const key of keys) {
    const line = text.split(';').find(l => l.includes(`hq_str_nf_${ZCE_SYMBOLS[key].sina}=`));
    const parsed = line ? parseSinaLine(line) : null;
    out[key] = withMeta(key, parsed, null, 'sina');
  }
  return out;
}

// ─── 2순위: czce 공식 정적파일 (ZCE 상장 품목 SF/SM만) ──────────────────────
const CZCE_PREFIX = { sf: 'SF', sm: 'SM' };

async function fetchFromCzce(keys) {
  // 오늘(KST)부터 5일 역순으로 가장 최근 거래일 파일 탐색
  const out = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(Date.now() + 9 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    try {
      const text = await fetchCzceDaily(d);
      for (const key of keys) {
        if (!CZCE_PREFIX[key]) continue;
        out[key] = withMeta(key, parseCzceText(text, CZCE_PREFIX[key]), d, 'czce');
      }
      if (Object.values(out).some(Boolean)) return out;
    } catch { /* 휴장일 등 — 전일 시도 */ }
  }
  return out;
}

/**
 * 선물 정산가 일괄 수집. 실패한 심볼은 null (호출부가 표시 생략으로 degrade).
 * @param {string[]} keys - ZCE_SYMBOLS 키 배열 (예: ['sf','sm'])
 * @returns {Promise<Record<string, object|null>>}
 */
export async function fetchZceFutures(keys) {
  try {
    const sina = await fetchFromSina(keys);
    const missing = keys.filter(k => !sina[k] && CZCE_PREFIX[k]);
    if (missing.length === 0) {
      console.log(`[ZCE] sina 성공: ${keys.filter(k => sina[k]).map(k => `${k}=${sina[k].settle}`).join(' ')}`);
      return sina;
    }
    console.warn(`[ZCE] sina 일부 누락(${missing.join(',')}) — czce 보충 시도`);
    const czce = await fetchFromCzce(missing).catch(() => ({}));
    return { ...czce, ...Object.fromEntries(Object.entries(sina).filter(([, v]) => v)) };
  } catch (e) {
    console.warn('[ZCE] sina 실패 — czce fallback:', e.message);
    const czceKeys = keys.filter(k => CZCE_PREFIX[k]);
    if (czceKeys.length === 0) return {};
    return fetchFromCzce(czceKeys).catch(() => ({}));
  }
}
