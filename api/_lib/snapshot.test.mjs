// node api/_lib/snapshot.test.mjs — 숫자 스냅샷·해외 스크랩·가탄제 범위 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { parseScrapListing, decodeDataPage } from './recycleinme.js';
import { toHistoryEntries } from './snapshot.js';
import { dropUnsourcedRange } from './tab-recarburizer.js';
import { parseNitemtrade } from './customs.js';

// ─── recycleinme 목록 파싱 ──────────────────────────────────────────────────
const row = (Category, Subcat, OpenPrice, ClosePrice, Units, Dat = '2026-10-01 00:00:00.000') =>
  ({ Category, Subcat, OpenPrice: String(OpenPrice), ClosePrice: String(ClosePrice), Units, Dat, Currency: 'US$', PriceTerm: 'Yard Buying Price' });
const page = { props: { latestPricesForCategories: {
  a: [row('US Scrap Prices', 'AL Extrusion', 1.05, 1.05, 'Pound', '2026-09-30 00:00:00.000')],
  b: [row('US Scrap Prices', 'Copper No.1', 5.6, 5.63, 'Pound')],                 // 알루미늄 아님 → 제외
  c: [row('UK Scrap Prices', 'Clean UBCs', 1.3, 1.3, 'Lbs')],                       // "Canada" 페이지의 lb 행 → 캐나다
  d: [row('UK Scrap Prices', 'Aluminum Zorba 95/5 Scrap', 2740, 2690, 'Tons')],     // 톤 행 → 영국
  e: [row('UK Scrap Prices', 'Aluminum Copper Radiators', 4.0, 4.04, 'Lbs')],       // 구리 혼합 ≈ 8,900달러도 허용
  f: [row('US Scrap Prices', 'AL Sheet', 0, 0, 'Pound')],                           // 0원 → 제외
  g: [row('US Scrap Prices', 'Cast Alum', 73, 73, 'Pound')],                        // 자릿수 오류(톤당 16만 달러) → 제외
  h: [row('India Scrap Prices', 'Aluminium Tense', 1, 1, 'Kg')],                    // 모르는 국가·단위 → 제외
} } };
const parsed = parseScrapListing(page);
assert.deepEqual(Object.keys(parsed).sort(), ['ca', 'uk', 'us']);
assert.equal(parsed.us.items.length, 1);
assert.deepEqual(parsed.us.items[0], {
  grade: 'AL Extrusion', usd_lb: 1.05, usd_t: 2315, change_pct: 0, date: '2026-09-30', currency: 'US$', term: 'Yard Buying Price',
});
assert.deepEqual(parsed.ca.items.map(i => i.grade), ['Clean UBCs', 'Aluminum Copper Radiators']);
assert.equal(parsed.ca.items[1].usd_t, 8907);
assert.equal(parsed.uk.items[0].usd_t, 2690);
assert.equal(parsed.uk.items[0].usd_lb, null);
assert.equal(parsed.uk.items[0].change_pct, -1.82);
assert.deepEqual(parseScrapListing(null), {});
assert.equal(decodeDataPage('<div data-page="{&quot;a&quot;:&quot;x&amp;y&quot;}"></div>').a, 'x&y');

// ─── 스냅샷 → 시계열 행: 값마다 실제 거래일 날짜, 실패 항목은 키 없음, 주말 환율 제외 ───────
{
  const rows = toHistoryEntries({
    date: '2026-10-03',
    lme_al: { price: '3109.5', date: '2026-10-02' },
    futures: { sf: { settle: 5982, date: '2026-09-30' }, sm: null, jm: { settle: 0, date: '2026-09-30' } },
    fx: { usd_krw: { rate: 1348.28, date: '2026-10-03' }, cny_usd: { rate: 0.149, date: '2026-10-03' } }, // 토요일
    scrap_overseas: { us: { items: [{ grade: 'AL Extrusion', usd_t: 2315, date: '2026-09-30' }] } },
  });
  assert.deepEqual(rows, [
    { d: '2026-09-30', sf: 5982, scrap: { 'us:AL Extrusion': 2315 } },
    { d: '2026-10-02', lme: 3109.5 },
  ]);
  const weekday = toHistoryEntries({ fx: { usd_krw: { rate: 1350, date: '2026-10-05' }, cny_usd: { rate: 0.149, date: '2026-10-05' } } });
  assert.deepEqual(weekday, [{ d: '2026-10-05', usdkrw: 1350, cnyusd: 0.149 }]);
}

// ─── 가탄제: 출처 없는 범위는 가격으로 쓰지 않는다 ────────────────────────────
{
  const p = { price_range_text: '100~180 USD/MT', price_range_source: '전일 제시 범위 및 중국 무연탄 통상 범위' };
  dropUnsourcedRange(p);
  assert.equal(p.price_range_text, null);
  const q = { price_range_text: '190~210 USD/MT', price_range_source: null };
  dropUnsourcedRange(q);
  assert.equal(q.price_range_text, null);
  const r = { price_range_text: '200~215 USD/MT', price_range_source: 'sxcoal 2026-09-30' };
  dropUnsourcedRange(r);
  assert.equal(r.price_range_text, '200~215 USD/MT');
}

// ─── 관세청 무연탄 수입단가 ──────────────────────────────────────────────────
{
  const item = (year, kg, usd) => `<item><impDlr>${usd}</impDlr><impWgt>${kg}</impWgt><year>${year}</year></item>`;
  const xml = `<response><header><resultCode>00</resultCode><resultMsg>정상서비스.</resultMsg></header><body><items>${
    item('총계', 99000000, 9900000)}${item('2026.08', 38639000, 6877742)}${item('2026.05', 48000, 20064)}${item('2026.06', 0, 0)
  }</items></body></response>`;
  const rows = parseNitemtrade(xml);
  assert.deepEqual(rows.map(r => r.ym), ['2026-05', '2026-06', '2026-08']);   // 총계 제외, 오래된 순
  assert.deepEqual(rows[2], { ym: '2026-08', tons: 38639, usd: 6877742, usd_per_t: 178, thin: false });
  assert.equal(rows[0].usd_per_t, null);  // 48톤 소량 월 — 단가 418달러로 튀므로 표시 안 함
  assert.equal(rows[0].thin, true);
  assert.equal(rows[1].usd_per_t, null);  // 수입 0
  assert.throws(() => parseNitemtrade('<response><header><resultCode>03</resultCode><resultMsg>인증에 실패하였습니다.</resultMsg></header></response>'), /03: 인증에 실패/);
  assert.throws(() => parseNitemtrade('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'), /SERVICE_KEY_IS_NOT_REGISTERED/);
}

console.log('snapshot tests passed');

// ─── 시계열 백필 병합 ────────────────────────────────────────────────────────
{
  const { mergeHistory, parseSinaDaily } = await import('./history-backfill.js');
  const existing = [{ d: '2026-10-02', lme: 3109.5, scrap: { 'us:AL Sheet': 1984 } }];
  const incoming = [
    { d: '2026-10-01', lme: 3120, sf: 5950 },
    { d: '2026-10-02', lme: 9999, sf: 5982, scrap: { 'us:AL Sheet': 1, 'us:Cast Alum': 1609 } },
  ];
  assert.deepEqual(mergeHistory(existing, incoming, 400), [
    { d: '2026-10-01', lme: 3120, sf: 5950 },
    { d: '2026-10-02', lme: 3109.5, sf: 5982, scrap: { 'us:AL Sheet': 1984, 'us:Cast Alum': 1609 } }, // 실측 우선, 빈 칸만 백필
  ]);
  assert.equal(mergeHistory(existing, incoming, 1).length, 1);

  const sina = 'var x=([{"d":"2026-09-29","c":"5900.000","s":"5950.000"},{"d":"2026-09-30","c":"5982.000","s":"0"},{"d":"2026-09-30x","c":"1","s":"1"},{"d":"2026-10-01","c":"99999","s":"0"}]);';
  assert.deepEqual(parseSinaDaily(sina, [3000, 12000]), [{ d: '2026-09-29', v: 5950 }, { d: '2026-09-30', v: 5982 }]);
  assert.deepEqual(parseSinaDaily('<html>', [0, 1]), []);
  console.log('history backfill tests passed');
}
