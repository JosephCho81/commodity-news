// api/_lib/pageDate.js — 기사 페이지 자체가 밝힌 발행일(evidence.js가 Google News 날짜를 바로잡는 데 쓴다). 순수 함수.

// 기사 페이지가 밝힌 발행일(메타·JSON-LD). Google News 날짜는 재게시·갱신일일 수 있어
// 몇 달 전 실적 기사가 "최근 기사"로 들어올 수 있다(2026-10-26 점검). 못 찾으면 null (순수 함수)
const DATE_KEYS = 'article:published_time|og:published_time|pubdate|publishdate|publish-date|parsely-pub-date|datePublished|DC\\.date\\.issued';
const PAGE_DATE_RES = [
  new RegExp(`<meta[^>]+(?:property|name|itemprop)=["'](?:${DATE_KEYS})["'][^>]*content=["']([^"']+)["']`, 'gi'),
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:${DATE_KEYS})["']`, 'gi'),
  /"datePublished"\s*:\s*"([^"]+)"/g,
  /itemprop=["']datePublished["'][^>]*datetime=["']([^"']+)["']/gi,
];
// 우선순위: 페이지 메타 → JSON-LD 첫 값 → itemprop. JSON-LD·목록에는 관련 기사의 옛 날짜도 섞여 있어 최솟값을 쓰지 않는다
export function pageDate(html, now = Date.now()) {
  const ok = (t) => Number.isFinite(t) && t > Date.UTC(2015, 0, 1) && t < now + 86400000;
  for (const re of PAGE_DATE_RES) {
    for (const m of String(html).matchAll(re)) {
      const t = Date.parse(m[1].trim().replace(' ', 'T'));
      if (ok(t)) return new Date(t).toISOString();
    }
  }
  return null;
}
// 페이지 발행일이 Google News 날짜보다 2일 넘게 이르면 페이지 날짜를 쓴다 (순수 함수)
export const truePublished = (gnPublished, html, now = Date.now()) => {
  const pd = pageDate(html, now);
  return pd && Date.parse(pd) < Date.parse(gnPublished) - 2 * 86400000 ? pd : gnPublished;
};
