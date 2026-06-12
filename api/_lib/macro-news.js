// api/_lib/macro-news.js — 글로벌 매크로 이벤트 결정적 감지 (Google News RSS)
// 원칙: 발굴(결정적 RSS·키워드 스코어)과 해석(LLM)을 분리한다.
// sonar의 자체 검색에 이벤트 발굴을 맡기면 누락됨이 확인됐으므로(2026-06-12 미·이란 합의 미반영),
// 헤드라인은 여기서 수집해 프롬프트에 사실 근거로 주입하고 LLM은 품목 영향 번역만 맡는다.

import { decodeEntities } from './rss-news.js';

const GNEWS_BASE = 'https://news.google.com/rss/search';
const GNEWS_PARAMS = 'hl=en-US&gl=US&ceid=US:en';

// 고정 쿼리 — 특정 이벤트명을 하드코딩하지 않는다. when:1d = 최근 24시간.
export const MACRO_QUERIES = [
  'commodities metals market when:1d',
  'oil OR energy sanctions OR ceasefire OR tariff market when:1d',
  'aluminum OR steel OR coal supply disruption when:1d',
];

// 감시 엔티티(지정학·정책 주체) — 워치리스트이며 필요 시 추가
const ENTITIES = [
  'iran', 'israel', 'russia', 'ukraine', 'china', 'opec', 'hormuz', 'suez',
  'red sea', 'venezuela', 'taiwan', 'north korea', 'middle east', 'saudi',
  'fed', 'white house', 'trump', 'eu ',
];

// 국면(phase) 키워드 — 같은 엔티티라도 국면 조합이 바뀌면 새 이벤트로 본다 (갈등→합의 등)
// 'de-escalat'는 conflict 판정 전에 제거해 'escalat' 오집계를 막는다.
const PHASES = {
  deal:     { w: 3, kws: ['deal', 'agreement', 'truce', 'ceasefire', 'peace', 'accord', 'signs', 'signed', 'sanctions relief', 'lifts sanction', 'de-escalat'] },
  conflict: { w: 3, kws: ['war', 'strike', 'attack', 'escalat', 'invasion', 'bombing', 'missile', 'retaliat', 'collapse'] },
  sanctions:{ w: 2, kws: ['sanction', 'embargo', 'export ban', 'blacklist'] },
  trade:    { w: 2, kws: ['tariff', 'trade war', 'quota', 'import duty'] },
  supply:   { w: 2, kws: ['shortage', 'disruption', 'halt', 'outage', 'smelter', 'blockade', 'force majeure', 'strait'] },
};

// 트리거 임계치: 헤드라인 3건 × 가중치 3 = 9
export const MACRO_TRIGGER_SCORE = 9;
// 국면이 fingerprint에 들어가려면 서로 다른 헤드라인 3건 이상 — 단발 기사로 국면 선언 방지
const ACTIVE_PHASE_MIN = 3;
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

// ─── Google News RSS 파싱 (순수 함수 — 테스트 대상) ─────────────────────────
export function parseGoogleNewsItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 60) {
    const block = m[1];
    const pick = (tag) => {
      const r = block.match(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`));
      return r ? decodeEntities((r[1] ?? r[2] ?? '').trim()) : null;
    };
    let title = pick('title');
    const link = pick('link');
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const source = pick('source');
    // Google News는 제목 끝에 " - 매체명"을 붙인다 — 중복이므로 제거
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const pub = pick('pubDate');
    const ts = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      url: link,
      source: source ?? null,
      date: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : null,
      ts: Number.isFinite(ts) ? ts : null,
    });
  }
  return items;
}

const norm = (t) => String(t ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// 쿼리 간 중복 헤드라인 제거 (정규화 제목 일치 또는 동일 URL)
export function dedupMacroItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = norm(it.title);
    if (key.length < 4 || seen.has(key) || seen.has(it.url)) continue;
    seen.add(key);
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

// ─── 충격 판정 (순수 함수 — 테스트 대상) ────────────────────────────────────
// 엔티티별로 국면(phase) 헤드라인 수를 세고, 최다 엔티티의 "활성 국면 조합"을 fingerprint로 만든다.
// 단일 top 국면 방식은 전쟁 보도 물량에 새 국면(합의)이 묻히므로 조합 방식 사용:
//   어제 'iran:conflict' → 오늘 'iran:conflict+deal' → fingerprint 변경 → 트리거.
export function analyzeMacroShock(items, nowMs = Date.now()) {
  const byEntity = new Map(); // entity → phase → { count, sources:Set, evidence:[] }
  for (const it of items) {
    if (it.ts !== null && nowMs - it.ts > MAX_AGE_MS) continue;
    const t = ` ${String(it.title).toLowerCase()} `;
    const entity = ENTITIES.map(e => e.trim()).find(e => t.includes(e));
    if (!entity) continue;
    for (const [phase, { kws }] of Object.entries(PHASES)) {
      // conflict 판정 시 'de-escalat'를 먼저 제거 — 'escalat' 부분일치 오집계 방지
      const hay = phase === 'conflict' ? t.replace(/de-?escalat/g, '') : t;
      if (!kws.some(k => hay.includes(k))) continue;
      const phases = byEntity.get(entity) ?? new Map();
      const b = phases.get(phase) ?? { count: 0, sources: new Set(), evidence: [] };
      b.count++;
      if (it.source) b.sources.add(it.source);
      b.evidence.push(it);
      phases.set(phase, b);
      byEntity.set(entity, phases);
    }
  }

  // 엔티티 총점 = Σ(국면 헤드라인 수 × 가중치) — 최고 엔티티 선택
  let topEntity = null, topPhases = null, topTotal = 0;
  for (const [entity, phases] of byEntity) {
    let total = 0;
    for (const [phase, b] of phases) total += b.count * PHASES[phase].w;
    if (total > topTotal) { topEntity = entity; topPhases = phases; topTotal = total; }
  }
  if (!topEntity) return { score: 0, fingerprint: null, entity: null, phases: [], evidence: [], distinctSources: 0 };

  // 활성 국면: 헤드라인 ACTIVE_PHASE_MIN건 이상. 하나도 없으면 최다 국면 1개로 fallback
  let active = [...topPhases.entries()].filter(([, b]) => b.count >= ACTIVE_PHASE_MIN);
  if (active.length === 0) {
    active = [[...topPhases.entries()].sort((a, b) => b[1].count - a[1].count)[0]];
  }
  active.sort((a, b) => a[0].localeCompare(b[0]));

  const score = active.reduce((s, [phase, b]) => s + b.count * PHASES[phase].w, 0);
  const sources = new Set(active.flatMap(([, b]) => [...b.sources]));
  // 증거 헤드라인: 국면별 최신순 3건씩 — 새 국면의 근거가 반드시 포함되게 한다
  const seen = new Set();
  const evidence = active.flatMap(([, b]) =>
    [...b.evidence].sort((x, y) => (y.ts ?? 0) - (x.ts ?? 0)).slice(0, 3)
  ).filter(it => !seen.has(it.url) && seen.add(it.url));

  return {
    score,
    fingerprint: `${topEntity}:${active.map(([p]) => p).join('+')}`,
    entity: topEntity,
    phases: active.map(([p]) => p),
    evidence,
    distinctSources: sources.size,
  };
}

export function isMacroTrigger(analysis, prevFingerprint) {
  return analysis.score >= MACRO_TRIGGER_SCORE
    && analysis.distinctSources >= 2
    && analysis.fingerprint !== (prevFingerprint ?? null);
}

// ─── 수집 (네트워크) ─────────────────────────────────────────────────────────
export async function fetchGlobalMacroNews() {
  const settled = await Promise.allSettled(MACRO_QUERIES.map(async (q) => {
    const url = `${GNEWS_BASE}?q=${encodeURIComponent(q)}&${GNEWS_PARAMS}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; A1KOR-dashboard/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GNews HTTP ${res.status}`);
    return parseGoogleNewsItems(await res.text());
  }));
  for (const s of settled) {
    if (s.status === 'rejected') console.warn('[MacroNews] 쿼리 실패:', s.reason?.message);
  }
  const items = dedupMacroItems(settled.flatMap(s => (s.status === 'fulfilled' ? s.value : [])));
  const analysis = analyzeMacroShock(items);
  console.log(`[MacroNews] ${items.length}건 수집, top=${analysis.fingerprint ?? '없음'} score=${analysis.score}`);
  return { items, analysis };
}

// ─── 프롬프트 주입 섹션 ──────────────────────────────────────────────────────
// 이벤트 증거 헤드라인을 앞에, 나머지 최신순 — LLM이 이벤트를 놓칠 수 없게 한다.
export function buildMacroSection(macro, limit = 14) {
  if (!macro || macro.items.length === 0) return '';
  const { items, analysis } = macro;
  const evidenceUrls = new Set(analysis.evidence.map(e => e.url));
  const rest = items.filter(it => !evidenceUrls.has(it.url))
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const picked = [...analysis.evidence, ...rest].slice(0, limit);

  let s = '\n\n【글로벌 와이어 헤드라인 (최근 24시간, Google News 수집) — 매크로 이벤트 판단의 사실 근거】\n';
  s += '아래 헤드라인이 오늘 시장을 움직인 매크로 이벤트 판단의 1차 근거. 헤드라인에 없는 이벤트를 지어내지 말 것.\n';
  for (const it of picked) s += `- (${it.date ?? '날짜미상'}${it.source ? `, ${it.source}` : ''}) ${it.title}\n`;
  if (analysis.score >= MACRO_TRIGGER_SCORE) {
    s += `→ 위 헤드라인 다수가 동일 사안을 보도 중. 이 사안이 비철금속·합금철·석탄 수급과 원가(에너지·운임 경로 포함)에 미치는 영향을 macro_event로 반드시 작성할 것.\n`;
  }
  return s;
}
