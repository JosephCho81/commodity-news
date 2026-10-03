// node api/_lib/snapshot.test.mjs — 숫자 스냅샷·해외 스크랩·가탄제 범위 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { parseScrapListing, decodeDataPage } from './recycleinme.js';
import { toHistoryEntry } from './snapshot.js';
import { dropUnsourcedRange } from './tab-recarburizer.js';

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

// ─── 스냅샷 → 시계열 행: 실패 항목은 키 자체가 없어야 한다(0이나 추정값 금지) ───────
{
  const e = toHistoryEntry({
    date: '2026-10-03',
    lme_al: { price: '3109.5' },
    futures: { sf: { settle: 5982 }, sm: null, jm: { settle: 0 } },
    fx: { usd_krw: { rate: 1348.28 } },
    scrap_overseas: { us: { items: [{ grade: 'AL Extrusion', usd_t: 2315 }] } },
  });
  assert.deepEqual(e, { d: '2026-10-03', lme: 3109.5, sf: 5982, usdkrw: 1348.28, scrap: { 'us:AL Extrusion': 2315 } });
  assert.deepEqual(toHistoryEntry({ date: '2026-10-04', futures: {}, fx: {}, scrap_overseas: {} }), { d: '2026-10-04' });
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

console.log('snapshot tests passed');
