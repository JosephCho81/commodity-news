// node api/_lib/evidence.test.mjs — 근거 수집 필터 회귀 테스트 (npm test)
// 2026-10-03 실제로 걸렸던 오류를 고정: 철스크랩 기사의 알루미늄 스크랩 오분류, 유료 시황 제목의 타 품목 유입,
// 옆 칸 기사를 본문으로 잡는 오인식, 광고 문단 혼입, 연휴로 인한 근거 0건.
import assert from 'node:assert/strict';
import {
  parseGnRss, parseGnDecodeResponse, extractBody, focusBody, bodyMatchesTitle,
  titleSimilarity, selectCandidates, finalizeArticle, MARKETS,
} from './evidence.js';
import { decodeEntities } from './rss-news.js';

const NOW = Date.parse('2026-10-03T05:00:00Z');
const h = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();

// ─── Google News RSS ────────────────────────────────────────────────────────
{
  const xml = `<rss><channel><item><title>光大期货：9月30日矿钢煤焦日报 - 新浪财经</title><link>https://news.google.com/rss/articles/CBMiabc?oc=5</link><pubDate>Wed, 30 Sep 2026 19:50:49 GMT</pubDate><source url="https://finance.sina.com.cn">新浪财经</source></item></channel></rss>`;
  assert.deepEqual(parseGnRss(xml), [{
    title: '光大期货：9月30日矿钢煤焦日报', gnLink: 'https://news.google.com/rss/articles/CBMiabc?oc=5',
    publisher: '新浪财经', published: '2026-09-30T19:50:49.000Z',
  }]);
  const resp = ')]}\'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://finance.sina.cn/a.d.html?vt\\\\u003d4\\\\u0026cid\\\\u003d1\\",1]",null]]';
  assert.equal(parseGnDecodeResponse(resp), 'https://finance.sina.cn/a.d.html?vt=4&cid=1');
  assert.equal(parseGnDecodeResponse('nothing'), null);
}

// ─── 본문 추출 ──────────────────────────────────────────────────────────────
{
  const html = `<nav><p>MetrixAnnouncementsAbout UsCareersDownload AppSign InENMarkets News and Reports</p></nav>
    <div id="artibody"><p>This week, the aluminium scrap market price centre moved slightly lower along with primary aluminium.</p>
    <p>Explore: The most comprehensive industry report on aluminium recycling is now available.</p>
    <p>Secondary alloy plants cut operating rates by 4 percentage points ahead of the holiday break.</p>
    <p>免责声明：本文仅供参考，不构成投资建议，转载需授权，请勿用于商业目的。</p></div>`;
  const body = extractBody(html, /id="artibody"/);
  assert.match(body, /^This week, the aluminium scrap/);
  assert.match(body, /Secondary alloy plants/);
  assert.doesNotMatch(body, /Explore:|Metrix|免责声明/);
  // 선택자가 없으면 가장 긴 연속 문단 묶음 — 멀리 떨어진 추천기사 묶음은 제외
  const far = `<p>${'관련 없는 추천 기사 제목입니다 '.repeat(2)}</p>${' '.repeat(5000)}<p>${'본문 첫 문단 내용입니다 '.repeat(4)}</p><p>${'본문 둘째 문단 내용입니다 '.repeat(4)}</p>`;
  assert.match(extractBody(far), /^본문 첫 문단/);
  assert.equal(decodeEntities('India&rsquo;s &#8220;circular&#8221; &amp; more'), 'India’s “circular” & more');
}

// ─── 종합 리포트: 해당 품목 문단만 ─────────────────────────────────────────────
{
  const body = ['螺纹钢震荡偏弱，钢厂利润收缩。', '锰硅期价震荡走弱，主力合约报收5798元/吨。', '锰矿港口价格持稳，成本支撑仍在。', '铁矿石跌至阶段低位。', '硅铁跟随双焦走弱。'].join('\n');
  assert.equal(focusBody(body, MARKETS.ferro.body), ['锰硅期价震荡走弱，主力合约报收5798元/吨。', '锰矿港口价格持稳，成本支撑仍在。', '铁矿石跌至阶段低位。', '硅铁跟随双焦走弱。'].join('\n'));
}

// ─── 제목-본문 일치 ─────────────────────────────────────────────────────────
assert.equal(bodyMatchesTitle('South China A00 aluminium ingot premium expected to ease from highs after national day holiday',
  'Global aluminium industry gears up for ALUMINIUM 2026 in Düsseldorf with focus on recycling, innovation and decarbonisation.'), false);
assert.equal(bodyMatchesTitle('Domestic aluminium ingot accumulation after National Day Holiday expected to be moderate',
  'Ahead of the National Day holiday, domestic aluminium ingot inventories continued to set fresh lows; accumulation is expected to be moderate.'), true);
assert.ok(titleSimilarity('현대제철, 13일 철 스크랩 인하', '현대제철, 철스크랩價 10월도 내려…13일 인하') > 0.3);

// ─── 후보 선별 ──────────────────────────────────────────────────────────────
{
  const c = (title, url, hoursAgo, extra = {}) => ({ title, url, published: h(hoursAgo), lang: 'ko', ...extra });
  const cands = [
    c('세아베스틸 철 스크랩 인하 발표', 'https://www.steeldaily.co.kr/news/articleView.html?idxno=1', 26),          // 철스크랩 → al2 아님
    c('Operating rate declines; ADC12 prices fall', 'https://www.alcircle.com/news/a', 5),
    c('Hydro urges aluminium scrap safeguards', 'https://www.alcircle.com/news/b', 40),
    c('Aluminium scrap prices fall', 'https://unknown-blog.example.com/x', 2),                                       // 화이트리스트 밖
    c('Aluminium scrap market weekly', 'https://www.alcircle.com/news/old', 200),                                     // 7일 초과
    c('Hydro urges aluminium scrap safeguards again', 'https://aluminiumtoday.com/news/c', 30),                       // 중복 보도
  ];
  const picked = selectCandidates(cands, 'al2', { now: NOW });
  // b와 c는 같은 사건 — 더 최신인 c만 남긴다
  assert.deepEqual(picked.map(p => p.url), ['https://www.alcircle.com/news/a', 'https://aluminiumtoday.com/news/c']);

  // 이미 쓴 기사는 빼지 않고 후순위 + repeat
  const seen = new Set(['https://www.alcircle.com/news/a']);
  const again = selectCandidates(cands, 'al2', { now: NOW, seen });
  assert.deepEqual(again.map(p => [p.url, p.repeat]), [['https://aluminiumtoday.com/news/c', false], ['https://www.alcircle.com/news/a', true]]);

  // 연휴: 72시간 안에 없으면 호출부가 168시간으로 넓힌다
  const holiday = [c('光大期货：9月30日矿钢煤焦日报', 'https://finance.sina.cn/x.d.html', 92)];
  assert.equal(selectCandidates(holiday, 'ferro', { now: NOW }).length, 0);
  assert.equal(selectCandidates(holiday, 'ferro', { now: NOW, maxAgeH: 168 }).length, 1);
}

// ─── 본문 판정 ──────────────────────────────────────────────────────────────
{
  const base = { title: '光大期货：9月30日矿钢煤焦日报', url: 'u', source: '신랑재경', lang: 'zh', published: h(92) };
  const steelOnly = '螺纹钢震荡偏弱，钢厂利润收缩，库存去化放缓，节前补库完成。'.repeat(8);
  assert.equal(finalizeArticle(base, steelOnly, 'ferro'), null);   // 종합 리포트인데 합금철 언급 없음
  const withFerro = ['螺纹钢震荡偏弱。', '锰硅期价震荡走弱，主力合约报收5798元/吨，持仓减少。锰硅开工率30.33%。', '硅铁跟随走弱，硅铁库存同比偏高，硅铁利润收缩至亏损边缘，后市承压。'].join('\n');
  const art = finalizeArticle(base, withFerro, 'ferro');
  assert.ok(art && !art.body.includes('螺纹钢'));
}

console.log('evidence tests passed');
