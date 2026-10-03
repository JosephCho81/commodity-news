// node api/_lib/parsers.test.mjs — 원자료 파서 회귀 테스트 (중국 선물 정산가·국내 RSS) (npm test)
import assert from 'node:assert/strict';
import { parseSinaLine } from './zce-futures.js';
import { parseCzceText } from './czce-daily.js';
import { parseRssItems } from './rss-news.js';

// ─── ZCE sina 파서 (2026-06-10 실측 라인 — czce 공식과 일치 검증된 값) ──────
const sinaLine = 'var hq_str_nf_SF0="硅铁连续,150000,5840.000,5904.000,5826.000,5880.000,5880.000,5882.000,5880.000,5874.000,5804.000,1,1062,168336.000,145817,郑,硅铁,2026-06-10,1,,,,,,,,,5874.000,0.000,0"';
const sf = parseSinaLine(sinaLine);
assert.equal(sf.settle, 5874);        // 금일 정산가
assert.equal(sf.prev_settle, 5804);   // 전일 정산가
assert.equal(sf.change, 70);
assert.equal(sf.date, '2026-06-10');
// 야간 세션(정산 0) — 현재가(idx8)로 degrade
const nightLine = 'var hq_str_nf_RB0="螺纹钢连续,230000,3175.000,3182.000,3171.000,0.000,3172.000,3173.000,3172.000,0.000,3166.000,1426,192,1662440.000,205827,沪,螺纹钢,2026-06-10,1"';
const rb = parseSinaLine(nightLine);
assert.equal(rb.settle, 3172);
assert.equal(rb.prev_settle, 3166);

// ─── ZCE czce 공식 파일 파서 — 미결제약정 최대 월물(주력) 선택 ──────────────
const czceText = [
  'SF607 |5,880.00  |5,922.00  |5,996.00  |5,910.00  |5,954.00  |5,960.00  |74.00 |80.00 |163,179 |121,701 |-12,256 |486,189.34 |',
  'SF609 |5,804.00  |5,840.00  |5,904.00  |5,826.00  |5,880.00  |5,874.00  |76.00 |70.00 |145,817 |168,336 |22,596  |428,289.16 |',
  'SM609 |5,964.00  |5,988.00  |6,040.00  |5,970.00  |6,016.00  |6,012.00  |52.00 |48.00 |161,723 |332,447 |-6,042  |486,055.56 |',
].join('\n');
const czSf = parseCzceText(czceText, 'SF');
assert.equal(czSf.contract, 'SF609'); // OI 168,336 > 121,701
assert.equal(czSf.settle, 5874);
assert.equal(czSf.prev_settle, 5804);
assert.equal(parseCzceText(czceText, 'SM').settle, 6012);
assert.equal(parseCzceText(czceText, 'AP'), null);

// ─── RSS 파서 ───────────────────────────────────────────────────────────────
const rssXml = `<rss><channel>
<item><title><![CDATA[세아베스틸, 철스크랩 매입 가격 인상]]></title><link>https://www.ferrotimes.com/news/articleView.html?idxno=1</link><pubDate>2026-06-11 09:10:00</pubDate></item>
<item><title>동부메탈 &quot;가동 중단&quot; 여파</title><link>https://www.snmnews.com/news/2</link><pubDate>2026-06-10 08:00:00</pubDate></item>
<item><title>링크 없는 항목</title><link>not-a-url</link></item>
</channel></rss>`;
const rssItems = parseRssItems(rssXml, '페로타임즈');
assert.equal(rssItems.length, 2);
assert.equal(rssItems[0].title, '세아베스틸, 철스크랩 매입 가격 인상');
assert.equal(rssItems[0].date, '2026-06-11');
assert.equal(rssItems[1].title, '동부메탈 "가동 중단" 여파'); // 엔티티 디코딩

console.log('parsers tests passed');
