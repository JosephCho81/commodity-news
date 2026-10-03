// node api/_lib/interpret.test.mjs — 결정적 지표·해석 검증 계층 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { seriesStats, direction, buySignal, krwEffect, marketMetrics } from './market-metrics.js';
import { allowedNumbers, numbersOk, unitsOk, sanitizeOutput, buildInput, extraLines } from './interpret.js';

// ─── 지표 ────────────────────────────────────────────────────────────────────
const hist = Array.from({ length: 30 }, (_, i) => ({
  d: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
  sf: 6000 - i * 10,
  usdkrw: 1350, cnyusd: 0.14,
}));
{
  const s = seriesStats(hist, 'sf');
  assert.equal(s.value, 5710);
  assert.equal(s.d1_pct, -0.17);
  assert.equal(s.w1_pct, -0.87);      // 5개 행 전 5760 대비
  assert.equal(s.y_low, 5710);
  assert.equal(s.y_pos, 0);
  assert.equal(seriesStats(hist, 'nope'), null);
}
assert.equal(direction({ w1_pct: -2, m1_pct: -3 }), 'down');
assert.equal(direction({ w1_pct: 2, m1_pct: -5 }), 'mixed');   // 주간 반등, 월간 급락
assert.equal(direction({ w1_pct: 0.5, m1_pct: 4 }), 'flat');
assert.equal(direction(null), 'flat');
assert.equal(buySignal('down'), '구매 유리');
assert.equal(buySignal('up'), '구매 불리');
assert.equal(buySignal('down', 'demand'), '수요 약함');
{
  // 현지 -1%, 환율(CNY→KRW) -2% → 원화 -2.98%
  const h = [...Array(6)].map((_, i) => ({ d: `2026-09-0${i + 1}`, sf: i === 5 ? 99 : 100, usdkrw: i === 5 ? 1323 : 1350, cnyusd: 0.14 }));
  assert.deepEqual(krwEffect(h, 'sf', 'CNY'), { price_pct: -1, fx_pct: -2, krw_pct: -2.98, basis: '주간' });
  assert.equal(krwEffect([{ d: '2026-09-01', sf: 1 }], 'sf', 'CNY'), null);
}
assert.equal(marketMetrics('ferro', hist).signal, '관망');     // 주간 -0.87% → 보합

// ─── 숫자·단위 검증 ──────────────────────────────────────────────────────────
const INPUT = '코크스 首轮提降落地，幅度100-110元 | FeSi 선물(ZCE): 5,982 CNY/t | 1주 -0.37% | 프로파일 4,150원/kg | 8월 152 USD/t | 원/달러 환율: 1348.28원';
const allowed = allowedNumbers(INPUT);
assert.equal(numbersOk('FeSi 선물은 5,982위안, 1주 -0.37%다.', allowed), true);
assert.equal(numbersOk('FeSi 선물은 6,000위안 부근이다.', allowed), false);          // 입력에 없는 숫자(반올림)
assert.equal(numbersOk('10월 3일 기준 2개 품목', allowed), true);                    // 1~2자리 정수 허용
assert.equal(unitsOk('코크스 1차 인하 폭은 100~110위안이다.', INPUT), true);
assert.equal(unitsOk('코크스 1차 인하 폭은 100~110원이다.', INPUT), false);          // 2026-10-03 Haiku 실제 오류
assert.equal(unitsOk('FeSi 5,982원', INPUT), false);
assert.equal(unitsOk('8월 러시아산은 152달러였다.', INPUT), true);
assert.equal(unitsOk('프로파일은 4,150원이다.', INPUT), true);
assert.equal(unitsOk('MJP는 280달러로 내렸다.', 'Rio Tinto cut its Q4 MJP offer to $280/t'), true);   // 기호가 앞에 오는 달러
assert.equal(unitsOk('LME 1년 저점 2,986달러', 'LME 알루미늄: 3,109.5 USD/t | 1년 범위 2,986~3,855 USD/t, 현재 위치 14%'), true); // 범위 앞쪽 숫자
{
  const out = {
    headline: '합금철 보합, 5,982위안',
    now: ['FeSi 선물은 5,982위안이다.', 'FeSi는 6,100위안까지 올랐다.', '셋째', '넷째는 잘린다'],
    why: [{ chain: ['코크스 인하', '원가 약화'], src: [1, 9] }, { chain: ['수요 7,777톤', '약세'], src: [1] }],
    impact: [{ area: '원가', text: '코크스 인하 100~110원 반영' }, { area: '구매', text: '분할 구매' }],
    outlook: { view: '보합', watch: ['5,982 유지 여부'], up: '반등', down: '하락' },
  };
  const { result, dropped } = sanitizeOutput(out, allowed, 2, INPUT);
  assert.deepEqual(result.now, ['FeSi 선물은 5,982위안이다.', '셋째']);              // 3개로 자른 뒤 위반 삭제
  assert.deepEqual(result.why, [{ chain: ['코크스 인하', '원가 약화'], src: [1] }]);   // 없는 근거 번호 제거
  assert.deepEqual(result.impact.map(i => i.area), ['구매']);
  assert.equal(result.headline, '합금철 보합, 5,982위안');
  assert.equal(dropped.length, 3);
}

// ─── 입력 조립 ──────────────────────────────────────────────────────────────
{
  const snap = {
    fx: { usd_krw: { rate: 1348.28 } },
    scrap_kr: { base_date: '2026-10-02', base_lme: 3120, base_fx: 1359.6, items: [{ item: '드로스', grade: '-', price: 2000, change: 0 }, { item: 'SAS', grade: 'A', price: 3650, change: -50 }] },
    scrap_overseas: { us: { date: '2026-09-30', items: [{ grade: 'AL Extrusion', usd_t: 2315 }] } },
    futures: { al: { settle: 23900 }, ad: { settle: 23590 } },
    anthracite_customs: { countries: { CN: [{ ym: '2026-05', usd_per_t: null }, { ym: '2026-08', usd_per_t: 178 }] } },
  };
  const al2 = extraLines('al2', snap).join('\n');
  assert.match(al2, /드로스 2,000원\/kg \(전주 대비 0원\)/);
  assert.match(al2, /SAS A 3,650원\/kg \(전주 대비 -50원\)/);
  assert.match(al2, /AL Extrusion 2,315 USD\/t/);
  assert.match(al2, /1차-2차 가격차: 310 CNY\/t/);
  assert.equal(extraLines('recarb', snap)[0], '관세청 무연탄 평균 수입단가 중국산 (CIF, 전 용도 평균): 2026-08 178 USD/t'); // 소량 월 제외
  const input = buildInput('ferro', marketMetrics('ferro', hist), snap, [
    { source: '신랑재경', published: '2026-09-30T00:00:00Z', title: '光大期货日报', body: '锰硅…', repeat: true },
  ]);
  assert.match(input, /방향: 보합 \/ 신호: 관망/);
  assert.match(input, /\[1\] 신랑재경 · 2026-09-30 \(이전 보도\) — 光大期货日报/);
  assert.match(buildInput('ferro', marketMetrics('ferro', hist), snap, []), /기사 없음/);
}

console.log('interpret tests passed');
