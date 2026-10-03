// node api/_lib/kr-scrap.test.mjs — 국내 스크랩 고시 판정 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { buildRecord, resolveMonthDay, toNum } from './kr-scrap.js';

const NOW = new Date('2026-10-03T03:00:00Z');

// 2026-10-02 고시 실제 판독값
const RAW = {
  width: 731, height: 1332,
  prices: ['3,750', '3,550', '3,200', '2,750', '3,650', '3,050', '2,850', '3,050', '2,750', '4,150', '4,150', '2,000'],
  changes: [{}, {}, {}, {}, { digits: '50', sign: -1 }, {}, {}, {}, {}, { digits: '150', sign: -1 }, { digits: '100', sign: -1 }, {}],
  base_lme: '3,120.00', base_fx: '1,359.60', base_lme_date: '10/01', base_fx_date: '10/023', period_end: '~10/10',
};

// ─── 날짜·숫자 ───────────────────────────────────────────────────────────────
assert.equal(resolveMonthDay('10/023', NOW), '2026-10-02');      // OCR 꼬리 잡음 무시
assert.equal(resolveMonthDay('12/30', new Date('2027-01-02T00:00:00Z')), '2026-12-30'); // 연초에 읽은 연말 고시
assert.equal(resolveMonthDay('13/01', NOW), null);
assert.equal(resolveMonthDay('2/30', NOW), null);
assert.equal(toNum('1,359.60'), 1359.6);
assert.equal(toNum('3,75O'), null);                              // 숫자 아닌 문자 섞이면 거부

// ─── 정상 판독 ───────────────────────────────────────────────────────────────
{
  const { record, issues, fatal } = buildRecord(RAW, null, NOW);
  assert.equal(fatal, false);
  assert.deepEqual(issues, []);
  assert.equal(record.base_date, '2026-10-02');
  assert.equal(record.period_end, '2026-10-10');
  assert.equal(record.base_lme, 3120);
  assert.equal(record.base_fx, 1359.6);
  assert.deepEqual(record.items[4], { item: 'SAS', grade: 'A', price: 3650, change: -50 });
  assert.deepEqual(record.items[11], { item: '드로스', grade: '-', price: 2000, change: 0 });
}

// ─── 치명 오류: 저장은 하되 정상값으로 쓰지 않는다 ─────────────────────────────
assert.equal(buildRecord({ ...RAW, width: 800 }, null, NOW).fatal, true);                       // 레이아웃 변경
assert.equal(buildRecord({ ...RAW, prices: RAW.prices.slice(0, 11) }, null, NOW).fatal, true);  // 행 누락
assert.equal(buildRecord({ ...RAW, prices: ['3,760', ...RAW.prices.slice(1)] }, null, NOW).fatal, true); // 50원 단위 아님
assert.equal(buildRecord({ ...RAW, prices: ['37,500', ...RAW.prices.slice(1)] }, null, NOW).fatal, true); // 자릿수 오독
assert.equal(buildRecord({ ...RAW, base_fx: '135.96' }, null, NOW).fatal, true);                 // 환율 오독
assert.equal(buildRecord({ ...RAW, base_fx_date: '' }, null, NOW).fatal, true);                  // 기준일 없음
{
  const changes = RAW.changes.map((c, i) => (i === 4 ? { digits: '50', sign: 0 } : c));
  assert.equal(buildRecord({ ...RAW, changes }, null, NOW).fatal, true);                          // 화살표 색 판독 실패
}

// ─── 지난주 대조 ─────────────────────────────────────────────────────────────
{
  const prev = buildRecord({ ...RAW, base_fx_date: '09/25' }, null, NOW).record;
  prev.items[4].price = 3700; prev.items[9].price = 4300; prev.items[10].price = 4250;
  const ok = buildRecord(RAW, prev, NOW);
  assert.deepEqual(ok.issues, []);

  prev.items[0].price = 3800; // 이번 주 대비 0인데 지난주와 다름 → 검토 대상
  const bad = buildRecord(RAW, prev, NOW);
  assert.equal(bad.fatal, false);
  assert.equal(bad.issues.length, 1);
  assert.match(bad.issues[0], /기계철 신재 지난주 대조 불일치/);

  // 같은 주 재게시는 대조하지 않는다
  assert.deepEqual(buildRecord(RAW, { ...prev, base_date: '2026-10-02' }, NOW).issues, []);
}

console.log('kr-scrap tests passed');
