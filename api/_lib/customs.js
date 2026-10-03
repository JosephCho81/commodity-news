// api/_lib/customs.js — 관세청 품목별 국가별 수출입실적 (공공데이터포털 nitemtrade, 월 1회 갱신)
// 무연탄(HS 2701.11) 국가별 월간 수입 금액(CIF, 달러)·순중량(kg) → 톤당 평균 수입단가.
// 전 용도 평균이라 가탄제 고품위 단가와는 다를 수 있다. 소량 월은 단가가 튀어 표시하지 않는다.

const ENDPOINT = 'https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList';
export const ANTHRACITE_HS = '270111';
export const ANTHRACITE_COUNTRIES = { CN: '중국', RU: '러시아' };
const MIN_TONS = 1000;

const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// XML 응답 → [{ym:'2026-08', tons, usd, usd_per_t|null, thin}] 오래된 순 (순수 함수 — 테스트 대상)
export function parseNitemtrade(xml) {
  const code = /<resultCode>([^<]*)<\/resultCode>/.exec(xml)?.[1];
  if (code !== '00') {
    const msg = /<resultMsg>([^<]*)<\/resultMsg>/.exec(xml)?.[1] ?? /<returnAuthMsg>([^<]*)</.exec(xml)?.[1] ?? '응답 형식 오류';
    throw new Error(`관세청 API ${code ?? '-'}: ${msg}`);
  }
  const rows = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const f = Object.fromEntries([...m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(a => [a[1], a[2]]));
    const ymMatch = /^(\d{4})\.(\d{2})$/.exec(f.year ?? '');
    if (!ymMatch) continue; // "총계" 행 제외
    const kg = Number(f.impWgt), usd = Number(f.impDlr);
    if (!Number.isFinite(kg) || !Number.isFinite(usd)) continue;
    const tons = kg / 1000;
    const thin = tons < MIN_TONS;
    rows.push({
      ym: `${ymMatch[1]}-${ymMatch[2]}`,
      tons: Math.round(tons),
      usd,
      usd_per_t: !thin && tons > 0 ? Math.round(usd / tons) : null,
      thin,
    });
  }
  return rows.sort((a, b) => a.ym.localeCompare(b.ym));
}

// 최근 12개월(조회 한도 1년) 국가별 무연탄 수입 실적. 키가 없으면 null.
export async function fetchAnthraciteImports(now = new Date()) {
  const key = process.env.CUSTOMS_API_KEY;
  if (!key) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const out = {};
  await Promise.all(Object.keys(ANTHRACITE_COUNTRIES).map(async (cc) => {
    const url = `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}&strtYymm=${ym(start)}&endYymm=${ym(end)}&hsSgn=${ANTHRACITE_HS}&cntyCd=${cc}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`관세청 HTTP ${res.status}`);
    out[cc] = parseNitemtrade(await res.text());
  }));
  const latest = Object.values(out).flat().map(r => r.ym).sort().at(-1) ?? null;
  console.log(`[Customs] 무연탄 수입 ${Object.entries(out).map(([k, v]) => `${k}=${v.length}개월`).join(' ')} (최신 ${latest})`);
  return { hs: ANTHRACITE_HS, latest_ym: latest, countries: out };
}
