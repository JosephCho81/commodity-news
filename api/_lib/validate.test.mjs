// node api/_lib/validate.test.mjs — 서버 결정적 계층 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { toNumber, validatePrice, stripUncertainty, stripUncertaintyDeep, isDuplicateNews } from './validate.js';
import { parseSinaLine } from './zce-futures.js';
import { parseCzceText } from './czce-daily.js';
import { parseRssItems, filterNewsByKeywords } from './rss-news.js';
import { findBidBaseline } from './market-config.js';

// ─── stripUncertainty: 검색 내레이션·불확실 문구 제거 ───────────────────────
// 연결절 제거 — 나머지 내용은 보존
assert.equal(
  stripUncertainty('동부메탈 동향은 이번 검색 결과에 확인되지 않으며, 국내 수급은 구조적으로 타이트한 수준.'),
  '국내 수급은 구조적으로 타이트한 수준.'
);
// 문장 전체가 내레이션이면 null
assert.equal(stripUncertainty('카자흐스탄 생산 차질은 검색 결과에서 포착되지 않음.'), null);
// 정상 문장 + 불확실 문장 혼합 — 불확실 문장만 제거
assert.equal(
  stripUncertainty('망간광석 CIF 가격이 USD 4.2/dmtu로 전월比 3% 상승. 남아공 수출은 확인 불가.'),
  '망간광석 CIF 가격이 USD 4.2/dmtu로 전월比 3% 상승.'
);
// 정상 텍스트는 그대로 통과
assert.equal(
  stripUncertainty('닝샤 지역 감산으로 공급 축소세. FeSi 내수가 CNY 6,200/MT 수준.'),
  '닝샤 지역 감산으로 공급 축소세. FeSi 내수가 CNY 6,200/MT 수준.'
);
// "발표 없음" 등 정상 표현은 오탐 금지
assert.equal(stripUncertainty('최근 3일 내 주요 발표 없음'), '최근 3일 내 주요 발표 없음');
// 비문자열은 손대지 않음
assert.equal(stripUncertainty(null), null);
assert.equal(stripUncertainty(7200), 7200);

// ─── stripUncertaintyDeep: 중첩 객체·배열 재귀 + 숫자 보존 ──────────────────
const deep = stripUncertaintyDeep({
  price_cny: 7200,
  context: '시장 동향은 이번 검색 결과에 확인되지 않음.',
  non_china_producers: [{ issue: '생산량 12,000톤으로 전년比 5% 증가.', cause: '관련 보도가 검색 결과에서 확인되지 않음.' }],
});
assert.equal(deep.price_cny, 7200);
assert.equal(deep.context, null);
assert.equal(deep.non_china_producers[0].issue, '생산량 12,000톤으로 전년比 5% 증가.');
assert.equal(deep.non_china_producers[0].cause, null);

// ─── toNumber / validatePrice 기본 동작 (기존 NULL 원칙 회귀 방지) ──────────
assert.equal(toNumber('5,950'), 5950);
assert.equal(toNumber('약 6000'), null);
assert.equal(toNumber(0), null);
assert.equal(validatePrice('7200', 'femn_cny').value, 7200);
assert.equal(validatePrice('99999', 'femn_cny').value, null);   // bound 위반
assert.equal(validatePrice('8000', 'femn_cny', 7000).value, null); // 전일 대비 ±10% 초과

// ─── isDuplicateNews ────────────────────────────────────────────────────────
assert.equal(isDuplicateNews('중국 FeSi 감산 확대', null, [{ t: '중국 FeSi 감산 확대 발표', u: null }]), true);
assert.equal(isDuplicateNews('가봉 망간광석 수출 차질', null, [{ t: '중국 FeSi 감산 확대', u: null }]), false);

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
assert.equal(filterNewsByKeywords(rssItems, ['동부메탈']).length, 1);
// 매체명 "페로타임즈"가 '페로' 키워드에 오탐되지 않도록 키워드는 품목명 전체 사용
assert.equal(filterNewsByKeywords([{ title: '페로타임즈 손바닥뉴스 6월 11일' }], ['페로망간', '합금철']).length, 0);

// ─── 입찰 기준점 ────────────────────────────────────────────────────────────
const hist = [
  { d: '2026-03-04', sf: 6000 }, { d: '2026-03-05', sf: 6050 }, { d: '2026-06-10', sf: 5874 },
];
const base = findBidBaseline(hist, [3, 9], 'sf');
assert.equal(base.baseline, 6000);     // 입찰 월(3월) 첫 데이터
assert.equal(base.date, '2026-03-04');
assert.equal(findBidBaseline(hist, [], 'sf'), null);     // 입찰 월 미설정 → 숨김
assert.equal(findBidBaseline([], [3], 'sf'), null);

console.log('✅ validate.test.mjs 전체 통과');
