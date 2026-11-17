// api/_lib/signals.js — 세계 동향 신호판: 합금철·알루미늄·가탄제·철강 수요·공급에 닿는 공식 통계를 코드로 받는다(LLM 없음, 무료·키 없음).
// 핵심 원칙 1 그대로 — 실패는 null + errors, 추정·상수로 채우지 않는다. 파서는 순수 함수(2026-11-17 실제 응답으로 작성).
// 소스 실측(2026-11-17): 되는 것만 넣었다. 안 되는 것과 이유는 docs/quality.md "세계 동향 검증".

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const ymKo = (ym) => `${ym.slice(0, 4)}년 ${+ym.slice(5, 7)}월`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// 세계철강협회 월간 조강 생산 보도자료 — 세계·중국·한국. 전년 같은 달 대비(%)만 발표에 있어 직전 값 대신 yoy를 쓴다
export function parseWorldsteel(html) {
  const t = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const w = /World crude steel production for the (\d+) countries reporting to [^.]*?was ([\d.]+) million tonnes \(Mt\) in (\w+) (\d{4}), an? ([\d.]+)% (increase|decrease)/i.exec(t);
  if (!w) return [];
  const mi = MONTHS.indexOf(w[3].toLowerCase());
  if (mi < 0) return [];
  const when = `${w[4]}년 ${mi + 1}월`;
  const sign = (word) => (/decrease|down/i.test(word) ? -1 : 1);
  const out = [{ key: 'steel_world', group: 'steel', label: '세계 조강 생산', value: Number(w[2]), unit: '백만 톤', yoy: sign(w[6]) * Number(w[5]), when, desc: `세계철강협회 · ${w[1]}개국 월간` }];
  const cn = /China produced ([\d.]+) Mt in \w+ \d{4}, (up|down) ([\d.]+)%/i.exec(t);
  if (cn) out.push({ key: 'steel_cn', group: 'steel', label: '중국 조강 생산', value: Number(cn[1]), unit: '백만 톤', yoy: sign(cn[2]) * Number(cn[3]), when, desc: '세계철강협회 월간' });
  const kr = /South Korea produced ([\d.]+) Mt,? (up|down) ([\d.]+)%/i.exec(t);
  if (kr) out.push({ key: 'steel_kr', group: 'steel', label: '한국 조강 생산', value: Number(kr[1]), unit: '백만 톤', yoy: sign(kr[2]) * Number(kr[3]), when, desc: '세계철강협회 월간' });
  return out;
}
// 세계철강협회 RSS → 가장 최근 월간 조강 생산 보도자료 주소
export function worldsteelLink(xml) {
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = /<title>([^<]*)<\/title>/.exec(m[1])?.[1] ?? '';
    const link = /<link>([^<]*)<\/link>/.exec(m[1])?.[1] ?? '';
    if (/crude steel production/i.test(title) && /^https:\/\/worldsteel\.org\//.test(link)) return link.trim();
  }
  return null;
}

// LME 알루미늄 재고(westmetall 표: 날짜·재고·Cash·3개월) — 최신 값과 5거래일 전 값
export function parseLmeStock(html) {
  const rows = [];
  for (const m of String(html).matchAll(/<tr[^>]*>\s*<td[^>]*>(\d{1,2})\. (\w+) (\d{4})<\/td>\s*<td[^>]*>([\d,]+)<\/td>/g)) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi < 0) continue;
    const date = `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!rows.some(r => r.date === date)) rows.push({ date, v: Number(m[4].replace(/,/g, '')) });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length || !(rows[0].v > 0)) return null;
  const prev = rows[5];
  return { key: 'lme_al_stock', group: 'alu', label: 'LME 알루미늄 재고', value: rows[0].v, unit: '톤', prev: prev?.v ?? null, prev_label: prev ? `${md(prev.date)}` : '', when: md(rows[0].date), desc: '런던금속거래소 지정 창고 재고(웨스트메탈 집계)' };
}

// FRED CSV(키 없음) — 월간 지표의 최신 값과 직전 달 값
export function parseFred(csv, meta) {
  const rows = String(csv).trim().split('\n').slice(1).map(l => l.split(',')).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && v !== '.' && Number.isFinite(Number(v)));
  if (!rows.length) return null;
  const [d, v] = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  return { ...meta, value: meta.round(Number(v)), prev: prev ? meta.round(Number(prev[1])) : null, prev_label: '전월', when: ymKo(d.slice(0, 7)) };
}
const FRED = [
  { id: 'IPG3311A2S', key: 'us_steel_ip', group: 'steel', label: '미국 철강 생산지수', unit: '', round: r1, desc: '미국 연준 산업생산 · 철강(2017=100)' },
  { id: 'IPG3313S', key: 'us_alu_ip', group: 'alu', label: '미국 알루미늄 생산지수', unit: '', round: r1, desc: '미국 연준 산업생산 · 알루미나·알루미늄(2017=100)' },
  { id: 'HOUST', key: 'us_housing', group: 'demand', label: '미국 주택 착공', unit: '천 호', round: (v) => Math.round(v), desc: '미국 상무부 · 연율 환산(건설용 철강·알루미늄 수요)' },
  { id: 'TOTALSA', key: 'us_auto', group: 'demand', label: '미국 자동차 판매', unit: '백만 대', round: r1, desc: '미국 경제분석국 · 연율 환산(자동차용 알루미늄·강판 수요)' },
];

// Eurostat 산업생산(JSON-stat) — EU 월간 지수의 최신 값과 직전 달 값
export function parseEurostat(json, meta) {
  const idx = json?.dimension?.time?.category?.index;
  if (!idx) return null;
  const periods = Object.entries(idx).sort((a, b) => a[1] - b[1]).map(([p, i]) => ({ p, v: json.value?.[String(i)] })).filter(x => typeof x.v === 'number');
  if (!periods.length) return null;
  const cur = periods[periods.length - 1], prev = periods[periods.length - 2];
  return { ...meta, value: r1(cur.v), prev: prev ? r1(prev.v) : null, prev_label: '전월', when: ymKo(cur.p) };
}
const EUROSTAT = [
  { nace: 'C241', key: 'eu_steel_ip', group: 'steel', label: 'EU 철강 생산지수', unit: '', desc: 'Eurostat 산업생산 · 기초 철강(2021=100)' },
  { nace: 'C2442', key: 'eu_alu_ip', group: 'alu', label: 'EU 알루미늄 생산지수', unit: '', desc: 'Eurostat 산업생산 · 알루미늄(2021=100)' },
];

// 상하이항운거래소 지수 — 종합 줄(code)의 이번 값과 직전 값
export function parseSse(json, meta) {
  const d = json?.data;
  const line = (d?.lineDataList ?? []).find(l => l.dataItemTypeName === meta.code);
  if (!line || typeof line.currentContent !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(d.currentDate ?? '')) return null;
  const { code, ...rest } = meta;
  return { ...rest, value: r2(line.currentContent), prev: typeof line.lastContent === 'number' ? r2(line.lastContent) : null, prev_label: '직전', when: md(d.currentDate) };
}
const SSE = [
  { index: 'scfi', code: 'SCFI_T', key: 'scfi', group: 'freight', label: '컨테이너 운임지수', unit: '', desc: '상하이항운거래소 수출 컨테이너 운임 종합(합금철 수입은 주로 컨테이너)' },
  { index: 'cbcfi', code: 'CBCFI_T', key: 'cbcfi', group: 'freight', label: '중국 연안 석탄 운임지수', unit: '', desc: '상하이항운거래소 연안 석탄 운임 종합(중국 석탄·코크스 수급)' },
];

// 미국 연방관보 — 철강·알루미늄·합금철·석탄 관련 최근 공고(탐색 입력용, 화면에 내지 않는다). 전문 검색이 생선·올리브까지 걸어 제목으로 다시 거른다
const FR_TITLE = /steel|alumin|ferro|silico|mangan|coke|coal|section 232/i;
export function parseFedReg(json) {
  return (json?.results ?? []).map(r => ({ date: String(r.publication_date ?? ''), title: String(r.title ?? '').trim(), src: '미국 연방관보' }))
    .filter(n => n.title && FR_TITLE.test(n.title) && /^\d{4}-\d{2}-\d{2}$/.test(n.date)).slice(0, 8);
}
// 미국 무역대표부 보도 RSS — days일 이내 제목(탐색 입력용)
export function parseRssNotices(xml, today, src, days = 14) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(m[1])?.[1] ?? '').replace(/\s+/g, ' ').trim();
    const t = Date.parse(/<pubDate>([^<]*)<\/pubDate>/.exec(m[1])?.[1] ?? '');
    if (!title || !Number.isFinite(t)) continue;
    const date = new Date(t).toISOString().slice(0, 10);
    if ((Date.parse(today) - Date.parse(date)) / 86400000 <= days) out.push({ date, title, src });
  }
  return out.slice(0, 8);
}

// FRED는 브라우저 흉내 UA에 응답이 늦는 때가 있었다(2026-11-17 실측 20초 초과) — 기본 UA로 받는다
async function getRaw(url, { browser = true } = {}) {
  const res = await fetch(url, { headers: browser ? { 'User-Agent': UA, Accept: '*/*' } : { Accept: '*/*' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** @param {{ today: string, fetchRaw?: (url: string, o?: any) => Promise<string> }} o */
export async function collectSignals({ today, fetchRaw = getRaw }) {
  const from = new Date(Date.parse(today) - 14 * 86400000).toISOString().slice(0, 10);
  const fr = `https://www.federalregister.gov/api/v1/documents.json?per_page=40&order=newest&fields%5B%5D=title&fields%5B%5D=publication_date&conditions%5Bpublication_date%5D%5Bgte%5D=${from}&conditions%5Bterm%5D=${encodeURIComponent('aluminum | steel | ferrosilicon | silicomanganese | ferroalloy | coke')}`;
  /** @type {[string, () => Promise<any>][]} */
  const jobs = [
    ['worldsteel', async () => {
      const link = worldsteelLink(await fetchRaw('https://worldsteel.org/feed/'));
      if (!link) return null;
      const v = parseWorldsteel(await fetchRaw(link));
      return v.length ? v : null;
    }],
    ['lme_al_stock', async () => parseLmeStock(await fetchRaw('https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_stock'))],
    ...FRED.map(({ id, ...meta }) => /** @type {[string, () => Promise<any>]} */ ([meta.key, async () => parseFred(await fetchRaw(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { browser: false }), meta)])),
    ...EUROSTAT.map(({ nace, ...meta }) => /** @type {[string, () => Promise<any>]} */ ([meta.key, async () => parseEurostat(JSON.parse(await fetchRaw(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_inpr_m?geo=EU27_2020&nace_r2=${nace}&unit=I21&s_adj=SCA&indic_bt=PRD&lastTimePeriod=3`)), meta)])),
    ...SSE.map(({ index, ...meta }) => /** @type {[string, () => Promise<any>]} */ ([meta.key, async () => parseSse(JSON.parse(await fetchRaw(`https://en.sse.net.cn/currentIndex?indexName=${index}`)), meta)])),
    ['fedreg', async () => parseFedReg(JSON.parse(await fetchRaw(fr)))],
    ['ustr', async () => parseRssNotices(await fetchRaw('https://ustr.gov/rss.xml'), today, '미국 무역대표부')],
  ];
  const errors = [];
  const out = await Promise.all(jobs.map(async ([key, run]) => {
    try {
      const v = await run();
      if (!v) errors.push(`${key}: 값 없음`);
      return [key, v];
    } catch (e) {
      errors.push(`${key}: ${String(e.message).slice(0, 80)}`);
      return [key, null];
    }
  }));
  const by = Object.fromEntries(out);
  const order = ['worldsteel', 'eu_steel_ip', 'us_steel_ip', 'lme_al_stock', 'eu_alu_ip', 'us_alu_ip', 'us_housing', 'us_auto', 'scfi', 'cbcfi'];
  const signals = order.flatMap(k => (Array.isArray(by[k]) ? by[k] : by[k] ? [by[k]] : []));
  return { signals, notices: [...(by.fedreg ?? []), ...(by.ustr ?? [])], errors };
}

// 탐색 입력에 넣는 신호 줄 — 코드 숫자
export const signalLines = (signals) => signals.map(s => `- ${s.label} ${s.value.toLocaleString('en-US')}${s.unit ? ` ${s.unit}` : ''} (${s.when}${s.yoy != null ? `, 전년 같은 달 대비 ${s.yoy > 0 ? '+' : ''}${s.yoy}%` : s.prev != null ? `, ${s.prev_label} ${s.prev.toLocaleString('en-US')}` : ''}) — ${s.desc}`);
