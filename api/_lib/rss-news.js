// api/_lib/rss-news.js — RSS 파싱 공용 (국내 철강 전문지 ndsoft RSS, HTML 엔티티)
// 출처·날짜·URL 메타는 원본 그대로 쓴다(LLM 미경유).

const NAMED_ENTITIES = { rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', middot: '·', deg: '°', times: '×' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&([a-z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
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
