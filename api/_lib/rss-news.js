// api/_lib/rss-news.js — 국내 철강 전문지 RSS 수집 (1차 보도 — 제목·URL·날짜 원본 유지)
// 페로타임즈·철강금속신문 모두 ndsoft CMS — /rss/allArticle.xml 패턴.
// LLM에는 요약만 맡기고 출처 메타는 절대 LLM을 거치지 않는다.

const FEEDS = [
  { name: '페로타임즈',   url: 'https://www.ferrotimes.com/rss/allArticle.xml' },
  { name: '철강금속신문', url: 'https://www.snmnews.com/rss/allArticle.xml' },
];

// 탭별 헤드라인 필터 키워드 (제목 부분일치)
export const NEWS_KEYWORDS = {
  ferroalloy:   ['합금철', '페로망간', '페로실리콘', '실리코망간', '망간', '실리콘철', '규소철', '동부메탈', '심팩', 'FeSi', 'FeMn', 'SiMn'],
  steelmaker:   ['제강', '철강', '현대제철', '동국제강', '포스코', '세아', '한국철강', '대한제강', '와이케이', 'KG스틸', '전기로', '고로', '철근', '형강', '철스크랩', '후판'],
  recarburizer: ['가탄', '무연탄', '코크스', '원료탄', '전극봉', '흑연'],
  aluminum:     ['알루미늄', '알미늄', 'LME', '비철'],
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// ─── RSS XML 파싱 (순수 함수 — 테스트 대상, 의존성 없음) ────────────────────
export function parseRssItems(xml, sourceName) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 60) {
    const block = m[1];
    const pick = (tag) => {
      const r = block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`));
      return r ? decodeEntities((r[1] ?? r[2] ?? '').trim()) : null;
    };
    const title = pick('title');
    const link = pick('link');
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const pub = pick('pubDate');
    const dateMatch = pub ? pub.match(/\d{4}-\d{2}-\d{2}/) : null;
    items.push({
      title,
      url: link,
      date: dateMatch ? dateMatch[0] : null,
      source: sourceName,
    });
  }
  return items;
}

// 제목 키워드 필터 (순수 함수)
export function filterNewsByKeywords(items, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return items;
  return items.filter(it => keywords.some(kw => it.title.includes(kw)));
}

/**
 * 국내 철강 전문지 헤드라인 수집 + 탭 키워드 필터.
 * @param {string|null} tab - NEWS_KEYWORDS 키. null이면 전체 반환.
 * @param {number} limit
 * @returns {Promise<Array<{title, url, date, source}>>} 날짜 내림차순
 */
export async function fetchKoreanSteelNews(tab = null, limit = 10) {
  const settled = await Promise.allSettled(FEEDS.map(async (feed) => {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; A1KOR-dashboard/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
    return parseRssItems(await res.text(), feed.name);
  }));
  const all = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
  for (const s of settled) {
    if (s.status === 'rejected') console.warn('[RSS] 피드 실패:', s.reason?.message);
  }
  const filtered = tab ? filterNewsByKeywords(all, NEWS_KEYWORDS[tab]) : all;
  // 시황지표류 정기물(선물지표/거래현황)·다이제스트는 헤드라인 가치가 낮아 제외
  const cleaned = filtered.filter(it => !/^[\[(](LME|中 선물거래)|손바닥뉴스/.test(it.title));
  cleaned.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  console.log(`[RSS] ${tab ?? 'all'}: ${cleaned.length}건 (전체 ${all.length}건 수집)`);
  return cleaned.slice(0, limit);
}

// 프롬프트 주입용 섹션 문자열
export function buildKrNewsSection(items, note = '') {
  if (!Array.isArray(items) || items.length === 0) return '';
  let s = `\n\n【국내 철강 전문지 오늘자 1차 보도 헤드라인 — 사실 근거로 활용】\n${note}`;
  for (const it of items) s += `- (${it.date ?? '날짜미상'}, ${it.source}) ${it.title}\n`;
  return s;
}
