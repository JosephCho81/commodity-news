// node api/_lib/kr-scrap.test.mjs — 국내 스크랩 고시 판정 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { buildRecord, resolveMonthDay, toNum, toFixed2, alreadyArchived } from './kr-scrap.js';

const NOW = new Date('2026-10-16T03:00:00Z');

// 2026-10-15 고시(16행 양식) 원본 이미지 실제 판독값
const D50 = { digits: '50', sign: -1 }, NONE = { digits: '', sign: 0 };
const RAW = {
  width: 917, height: 1690,
  prices: ['3,700', '3,500', '3,150', '2,700', '3,600', '3,000', '2,800', '3,000', '2,700', '3,850', '3,850', '2,000', '3,200', '2,400', '3,650', '3,200'],
  changes: [D50, D50, D50, D50, D50, D50, D50, D50, D50, { digits: '300', sign: -1 }, { digits: '300', sign: -1 }, NONE, NONE, NONE, NONE, NONE],
  base_lme: '3,010.00', base_fx: '1,340.50', base_lme_date: '10/14', base_fx_date: '10/155', period_end: '~10/17',
};

// ─── 날짜·숫자 ───────────────────────────────────────────────────────────────
assert.equal(resolveMonthDay('10/155', NOW), '2026-10-15');      // OCR 꼬리 잡음 무시
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
  assert.equal(record.base_date, '2026-10-15');
  assert.equal(record.base_lme_date, '2026-10-14');
  assert.equal(record.period_end, '2026-10-17');
  assert.equal(record.base_lme, 3010);
  assert.equal(record.base_fx, 1340.5);
  assert.equal(record.items.length, 16);
  assert.deepEqual(record.items[0], { item: '기계철', grade: '신재', price: 3700, change: -50 });
  assert.deepEqual(record.items[9], { item: '작업 휠', grade: '-', price: 3850, change: -300 });
  assert.deepEqual(record.items[15], { item: '발판', grade: '미작업', price: 3200, change: 0 });
}

// ─── 치명 오류: 저장은 하되 정상값으로 쓰지 않는다 ─────────────────────────────
assert.equal(buildRecord({ ...RAW, prices: RAW.prices.slice(0, 12) }, null, NOW).fatal, true);  // 이전 12행 양식 등 행 수 불일치
assert.equal(buildRecord({ ...RAW, prices: ['3,760', ...RAW.prices.slice(1)] }, null, NOW).fatal, true); // 50원 단위 아님
assert.equal(buildRecord({ ...RAW, prices: ['37,000', ...RAW.prices.slice(1)] }, null, NOW).fatal, true); // 자릿수 오독
assert.equal(buildRecord({ ...RAW, base_fx: '134.05' }, null, NOW).fatal, true);                 // 환율 오독
assert.equal(buildRecord({ ...RAW, base_fx_date: '' }, null, NOW).fatal, true);                  // 기준일 없음
{
  const changes = RAW.changes.map((c, i) => (i === 4 ? { digits: '50', sign: 0 } : c));
  assert.equal(buildRecord({ ...RAW, changes }, null, NOW).fatal, true);                          // 화살표 색 판독 실패
}
{
  // 썸네일에서 실제로 나온 오독: ▼50 을 '0'으로 읽음 → 변동 0으로 조용히 넘어가면 안 된다
  const changes = RAW.changes.map((c, i) => (i === 0 ? { digits: '0', sign: -1 } : c));
  assert.equal(buildRecord({ ...RAW, changes }, null, NOW).fatal, true);
  const empty = RAW.changes.map((c, i) => (i === 2 ? { digits: '', sign: -1 } : c));
  assert.equal(buildRecord({ ...RAW, changes: empty }, null, NOW).fatal, true);
}

// ─── 지난주 대조 ─────────────────────────────────────────────────────────────
{
  const prev = buildRecord({ ...RAW, base_fx_date: '10/08' }, null, NOW).record;
  prev.items.forEach((it, i) => { it.price = it.price - RAW.changes[i].sign * (Number(RAW.changes[i].digits) || 0); });
  const ok = buildRecord(RAW, prev, NOW);
  assert.deepEqual(ok.issues, []);

  // 품목은 순서가 아니라 이름으로 맞춘다 (행 추가·순서 변경에도 엉뚱한 품목과 대조하지 않음)
  assert.deepEqual(buildRecord(RAW, { ...prev, items: [...prev.items].reverse() }, NOW).issues, []);

  prev.items[12].price = 3300; // 폐차장 기계철: 이번 주 대비 0인데 지난주와 다름 → 검토 대상
  const bad = buildRecord(RAW, prev, NOW);
  assert.equal(bad.fatal, false);
  assert.equal(bad.issues.length, 1);
  assert.match(bad.issues[0], /폐차장 기계철 - 지난주 대조 불일치/);

  // 같은 주 재게시, 놓친 주가 낀 경우(2주 전 기록)는 대조하지 않는다
  assert.deepEqual(buildRecord(RAW, { ...prev, base_date: '2026-10-15' }, NOW).issues, []);
  assert.deepEqual(buildRecord(RAW, { ...prev, base_date: '2026-10-01' }, NOW).issues, []);
}

// ─── 2026-10-16·23 고시: 이미지 폭 920px에서 테두리가 칸에 들어와 기준환율 "1.32460"으로 판독 → 2주 누락 ───────
assert.equal(toFixed2('1.32460'), 1324.6);                       // 쉼표를 마침표로 읽어도 소수 둘째 자리 고정
assert.equal(toFixed2('1,348.50'), 1348.5);
assert.equal(toFixed2('3,033.00'), 3033);
assert.equal(toFixed2('3.03300'), 3033);
assert.equal(toFixed2('134.05'), 134.05);                        // 자리 수가 모자라면 범위 검사가 거른다
assert.equal(toFixed2('1,3a4.60'), null);
assert.equal(toFixed2(''), null);
{
  const P = ['3,600', '3,400', '3,050', '2,600', '3,500', '2,900', '2,700', '2,900', '2,600', '3,850', '3,850', '1,900', '3,100', '2,200', '3,550', '3,100'];
  const D100 = { digits: '100', sign: -1 };
  // 10/16 고시 원본을 고친 OCR로 다시 읽은 값(Firestore failed-a77192a97530 보관 이미지)
  const oct16 = {
    width: 920, height: 1710, prices: P,
    changes: [D100, D100, D100, D100, D100, D100, D100, D100, D100, NONE, NONE, { digits: '100', sign: -1 }, { digits: '100', sign: -1 }, { digits: '200', sign: -1 }, D100, D100],
    base_lme: '2,999.00', base_fx: '1,348.50', base_lme_date: '(10/155)', base_fx_date: '(10/163)', period_end: '~10/24',
  };
  const r16 = buildRecord(oct16, null, new Date('2026-10-16T05:00:00Z'));
  assert.equal(r16.fatal, false);
  assert.equal(r16.record.base_date, '2026-10-16');
  assert.equal(r16.record.base_fx, 1348.5);
  // 옛 판독값("1.34850")도 이제 같은 값으로 읽힌다
  assert.equal(buildRecord({ ...oct16, base_fx: '1.34850' }, null, new Date('2026-10-16T05:00:00Z')).record.base_fx, 1348.5);
  // 10/23 고시: 전주(10/16) 단가 − 전주 대비 = 지난주 단가 대조까지 통과
  const oct23 = {
    ...oct16, prices: P.map((p, i) => (i === 13 ? '2,300' : p)),
    changes: P.map((_, i) => (i === 13 ? { digits: '100', sign: 1 } : NONE)),
    base_lme: '3,033.00', base_fx: '1,324.60', base_lme_date: '(10/225)', base_fx_date: '(10/235', period_end: '10/31',
  };
  const r23 = buildRecord(oct23, r16.record, new Date('2026-10-23T05:00:00Z'));
  assert.equal(r23.fatal, false);
  assert.deepEqual(r23.issues, []);
  assert.equal(r23.record.base_date, '2026-10-23');
  assert.equal(r23.record.period_end, '2026-10-31');
  assert.deepEqual(r23.record.items[13], { item: '알루미늄 캔 압축', grade: '-', price: 2300, change: 100 });
}
// 실패한 이미지는 같은 해시여도 다시 처리한다
assert.equal(alreadyArchived({ image_sha256: 'a', last_status: 'ok' }, 'a'), true);
assert.equal(alreadyArchived({ image_sha256: 'a', last_status: 'review' }, 'a'), true);
assert.equal(alreadyArchived({ image_sha256: 'a', last_status: 'failed' }, 'a'), false);
assert.equal(alreadyArchived({ image_sha256: 'a', last_status: 'ok' }, 'b'), false);
assert.equal(alreadyArchived(null, 'a'), false);

console.log('kr-scrap tests passed');
