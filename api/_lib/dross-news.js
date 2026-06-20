// api/_lib/dross-news.js — 알루미늄 드로스·2차 알루미늄·탈산제 전용 뉴스 수집 (Google News RSS)
// 원칙: 발굴은 결정적(타깃 쿼리 + 키워드 필터), 해석만 LLM.
// 니치 토픽이라 raw 쿼리는 노이즈(화재·종목·학술논문)가 많아 코드로 배제한다.

import { parseGoogleNewsItems } from './macro-news.js';

const GNEWS_BASE = 'https://news.google.com/rss/search';
const UA = 'Mozilla/5.0 (compatible; A1KOR-dashboard/1.0)';

const KR = 'hl=ko&gl=KR&ceid=KR:ko';
const US = 'hl=en-US&gl=US&ceid=US:en';
const CN = 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans';
const JP = 'hl=ja&gl=JP&ceid=JP:ja';

// [쿼리, 로케일, 권역('KR'|'GLOBAL'|'CN'|'JP')]
export const DROSS_QUERIES = [
  ['알루미늄 드로스 OR 알루미늄 탈산제 when:45d', KR, 'KR'],
  ['알루미늄 스크랩 OR "2차 알루미늄" OR 폐알루미늄 재활용 when:30d', KR, 'KR'],
  ['aluminium dross OR secondary aluminum recycling when:30d', US, 'GLOBAL'],
  ['aluminum scrap price OR aluminum tariff OR scrap export ban when:30d', US, 'GLOBAL'],
  ['ADC12 OR 铸造铝 OR 废铝 价格 when:30d', CN, 'CN'],
  ['アルミ ドロス OR アルミ スクラップ OR 二次アルミ when:30d', JP, 'JP'],
];

// 학술·노이즈 배제 — Google News의 source(매체명) 기준
const EXCLUDE_SOURCES = /nature|sciencedirect|researchgate|mdpi|springer|wiley|frontiers|preprint|arxiv|scholar|semanticscholar|x-mol/i;
const EXCLUDE_TITLE = /(화재|표창|수상|부고|인사발령|동정|\[특징주\]|상한가|급등주|급락주|주가|종목|코스닥|코스피|증시|배당|투자의견|목표주가)/;

// 국면 태그 — 결정적 키워드 분류 (앞선 항목 우선)
const CATEGORY = [
  ['규제', /(지정폐기물|폐기물|규제|환경|단속|수출.?규제|관세|tariff|export ban|landfill|regulation|hazardous|배출|인허가)/i],
  ['공급', /(스크랩|폐알루미늄|재활용|생산|용해|다이캐스팅|제련|가동|공급|scrap|smelter|supply|recycl|capacity|废铝)/i],
  ['수요', /(조강|제강|철강|수요|자동차|전기차|건설|demand|steel|automotive)/i],
  ['가격', /(가격|시세|최고가|최저가|급등|급락|상승|하락|price|jumps|falls|surge|价格|期价)/i],
];

export function categorize(title) {
  for (const [cat, re] of CATEGORY) if (re.test(title)) return cat;
  return '기타';
}

const normKey = (t) => String(t ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// ─── 필터·분류 (순수 함수 — 테스트 대상) ────────────────────────────────────
export function curateDrossItems(raw) {
  const clean = raw.filter(it =>
    it?.title &&
    !(it.source && EXCLUDE_SOURCES.test(it.source)) &&
    !EXCLUDE_TITLE.test(it.title)
  );
  const seen = new Set();
  const dedup = [];
  for (const it of clean) {
    const key = normKey(it.title);
    if (key.length < 4 || seen.has(key) || seen.has(it.url)) continue;
    seen.add(key);
    seen.add(it.url);
    dedup.push({ ...it, category: categorize(it.title) });
  }
  dedup.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return {
    domestic:   dedup.filter(it => it.scope === 'KR').slice(0, 12),
    overseas:   dedup.filter(it => it.scope !== 'KR').slice(0, 14),
    regulation: dedup.filter(it => it.category === '규제').slice(0, 6),
  };
}

// ─── 수집 (네트워크) ─────────────────────────────────────────────────────────
export async function fetchDrossNews(perQuery = 8) {
  const settled = await Promise.allSettled(DROSS_QUERIES.map(async ([q, loc, scope]) => {
    const url = `${GNEWS_BASE}?q=${encodeURIComponent(q)}&${loc}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GNews HTTP ${res.status}`);
    return parseGoogleNewsItems(await res.text()).slice(0, perQuery).map(it => ({ ...it, scope }));
  }));
  for (const s of settled) {
    if (s.status === 'rejected') console.warn('[DrossNews] 쿼리 실패:', s.reason?.message);
  }
  const raw = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
  const out = curateDrossItems(raw);
  console.log(`[DrossNews] 국내 ${out.domestic.length} · 해외 ${out.overseas.length} · 규제 ${out.regulation.length}`);
  return out;
}

// ─── 프롬프트 주입 섹션 ──────────────────────────────────────────────────────
export function buildDrossNewsSection(news) {
  if (!news || (news.domestic.length === 0 && news.overseas.length === 0)) return '';
  const fmt = (arr) => arr
    .map(it => `- [${it.category}] (${it.date ?? '날짜미상'}${it.source ? `, ${it.source}` : ''}) ${it.title}`)
    .join('\n');
  let s = '\n\n【드로스·2차알루미늄·탈산제 헤드라인 (Google News 수집) — supply/demand/regulation 작성의 1차 사실 근거】\n';
  if (news.domestic.length) s += `\n[국내]\n${fmt(news.domestic)}\n`;
  if (news.overseas.length) s += `\n[해외 (중·일·미EU)]\n${fmt(news.overseas)}\n`;
  s += '\n위 헤드라인에 근거해 서술. 헤드라인에 없는 사실·수치를 지어내지 말 것.\n';
  return s;
}
