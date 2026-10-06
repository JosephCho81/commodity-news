// node api/_lib/interpret.test.mjs — 결정적 지표·해석 검증 계층 회귀 테스트 (npm test)
import assert from 'node:assert/strict';
import { seriesStats, direction, krwEffect, marketMetrics, withConverted, quarterChange } from './market-metrics.js';
import { allowedNumbers, numbersOk, unitsOk, sanitizeOutput, buildInput, extraLines, isComplete, noCny } from './interpret.js';

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
{
  // 위안 → 달러: 날짜별(없으면 직전) 환율. 환율 행과 가격 행 날짜가 달라도 직전 값을 쓴다
  const conv = withConverted([
    { d: '2026-09-01', sf: 6000 },                       // 이전 환율 없음 → 환산 안 함(추정 금지)
    { d: '2026-09-02', usdkrw: 1400, cnyusd: 0.14 },
    { d: '2026-09-03', sf: 6000, lme: 3000 },
    { d: '2026-09-04', cnyusd: 0.15, sf: 5000 },
  ]);
  assert.equal(conv[0].sf, undefined);
  assert.equal(conv[2].sf, 840);
  assert.equal(conv[2].krw_sf, 840 * 1400);
  assert.equal(conv[2].krw_lme, 3000 * 1400);
  assert.equal(conv[3].sf, 750);
}
{
  // 달러 -1%, 원/달러 -2% → 원화 -2.98%
  const h = [...Array(6)].map((_, i) => ({ d: `2026-09-0${i + 1}`, sf: i === 5 ? 693 : 700, usdkrw: i === 5 ? 1323 : 1350, cnyusd: 1 }));
  assert.deepEqual(krwEffect(withConverted(h), 'sf'), { price_pct: -1, fx_pct: -2, krw_pct: -2.98, basis: '주간' });
  assert.equal(krwEffect(withConverted([{ d: '2026-09-01', sf: 1 }]), 'sf'), null);
}
{
  // 분기 대비: 전 분기 마지막 거래일이 기준. 분기 시작 전 데이터가 없으면 null
  const h = withConverted([
    { d: '2026-09-29', lme: 3000, usdkrw: 1400 },
    { d: '2026-09-30', lme: 3100, usdkrw: 1400 },
    { d: '2026-10-02', lme: 3162, usdkrw: 1428 },
  ]);
  assert.deepEqual(quarterChange(h, 'lme'), { quarter: '2026 4분기', base_date: '2026-09-30', base: 3100, usd_pct: 2, krw_pct: 4.04 });
  assert.equal(quarterChange(h.slice(2), 'lme'), null);
  // 중국 연휴: 가격은 9/30에 멈췄지만 오늘(10/2)은 4분기 → 달러 0%, 원화는 최신 환율 반영
  const holiday = withConverted([{ d: '2026-09-30', sf: 1000, cnyusd: 1, usdkrw: 1400 }, { d: '2026-10-02', usdkrw: 1428 }]);
  assert.deepEqual(quarterChange(holiday, 'sf', '2026-10-02'), { quarter: '2026 4분기', base_date: '2026-09-30', base: 1000, usd_pct: 0, krw_pct: 2 });
}
{
  const m = marketMetrics('ferro', hist);
  assert.equal(m.series[0].unit, 'USD/톤');                    // 중국 선물도 달러 표시(위안 금지)
  assert.equal(m.series[0].label, 'FeSi 선물(ZCE, 달러 환산)');
  assert.equal(marketMetrics('al1', [{ d: '2026-09-01', al: 20000, cnyusd: 0.14 }]).series[0].label, 'SHFE 1차 알루미늄 (달러 환산)');
  assert.equal(m.series[0].value, Math.round(5710 * 0.14));
  assert.equal(m.direction, 'flat');
  assert.equal('signal' in m, false);                         // 구매 신호 없음 — 기간별 입찰 구매라 매수 타이밍 신호는 쓰지 않는다
}

// ─── 숫자·단위 검증 ──────────────────────────────────────────────────────────
const INPUT = '코크스 首轮提降落地，幅度100-110元 | FeSi 선물(ZCE): 5,982 CNY/t | 1주 -0.37% | 프로파일 4,150원/kg | 8월 152 USD/t | 원/달러 환율: 1348.28원';
const allowed = allowedNumbers(INPUT);
assert.equal(numbersOk('FeSi 선물은 5,982위안, 1주 -0.37%다.', allowed), true);
assert.equal(noCny('코크스 1차 인하 폭은 100~110위안이다.'), false);                // 2026-10-03 사용자 지시: 위안 표기 금지
assert.equal(noCny('原价 5982元'), false);
assert.equal(noCny('LME는 3,109.5달러다.'), true);
assert.equal(numbersOk('FeSi 선물은 6,000위안 부근이다.', allowed), false);          // 입력에 없는 숫자(반올림)
assert.equal(numbersOk('10월 3일 기준 2개 품목', allowed), true);                    // 1~2자리 정수 허용
assert.equal(unitsOk('코크스 1차 인하 폭은 100~110위안이다.', INPUT), true);
assert.equal(unitsOk('코크스 1차 인하 폭은 100~110원이다.', INPUT), false);          // 2026-10-03 Haiku 실제 오류
assert.equal(unitsOk('FeSi 5,982원', INPUT), false);
assert.equal(unitsOk('8월 러시아산은 152달러였다.', INPUT), true);
assert.equal(unitsOk('프로파일은 4,150원이다.', INPUT), true);
assert.equal(unitsOk('MJP는 280달러로 내렸다.', 'Rio Tinto cut its Q4 MJP offer to $280/t'), true);   // 기호가 앞에 오는 달러
assert.equal(unitsOk('제시가를 310달러/t에서 280달러/t으로 낮췄다.', 'from the previous level of USD 310 per tonne to USD 280 per tonne'), true); // 2026-10-03 AL Circle 표기
assert.equal(unitsOk('제시가는 310달러다.', 'premium 310 yuan, USD 280'), false);
assert.equal(unitsOk('LME 1년 저점 2,986달러', 'LME 알루미늄: 3,109.5 USD/t | 1년 범위 2,986~3,855 USD/t, 현재 위치 14%'), true); // 범위 앞쪽 숫자
{
  const out = {
    headline: '합금철 보합, 5,982위안',
    now: ['FeSi 선물은 1348.28원 환율 아래 보합이다.', 'FeSi는 6,100달러까지 올랐다.', '셋째', '넷째는 잘린다'],
    why: [
      { region: '중국', title: '코크스 인하', text: '중국 제철소가 코크스 1차 인하를 관철했다. 원가 지지가 약해졌다.', src: [1, 9] },
      { region: '해외', title: '수요', text: '수요 7,777톤 감소로 약세다.', src: [1] },        // 입력에 없는 숫자
      { region: '국내', title: '감산', text: '국내 전기로 감산이 이어졌다.', src: [] },         // 근거 번호 없음 → 지어낸 원인으로 보고 삭제
      { region: '중국', title: '넷째', text: '잘린다', src: [1] },
    ],
    impact: [{ area: '원가', text: '코크스 인하 100~110원 반영' }, { area: '입찰', text: '다음 분기 입찰 단가 인하 여지' }],
    outlook: { view: '보합', watch: ['5,982 유지 여부'], up: '반등', down: '하락' },
  };
  const { result, dropped } = sanitizeOutput(out, allowed, 2, INPUT);
  assert.deepEqual(result.now, ['FeSi 선물은 1348.28원 환율 아래 보합이다.', '셋째']);   // 3개로 자른 뒤 위반 삭제
  assert.deepEqual(result.why, [{ region: '중국', title: '코크스 인하', text: '중국 제철소가 코크스 1차 인하를 관철했다. 원가 지지가 약해졌다.', src: [1] }]); // 없는 근거 번호 제거
  assert.deepEqual(result.impact.map(i => i.area), ['입찰']);
  assert.equal(result.headline, null);                                              // 위안 표기 삭제
  assert.equal(dropped.length, 5);
  // 기사가 없는 날은 근거 번호 없이 숫자에서 보이는 원인만 허용
  const none = sanitizeOutput({ ...out, why: [{ region: '중국', title: '원가', text: '원료탄과 코크스가 함께 내렸다.', src: [] }] }, allowed, 0, INPUT);
  assert.equal(none.result.why.length, 1);
  // 0 = 글로벌 와이어 헤드라인 근거
  assert.deepEqual(sanitizeOutput({ ...out, why: [{ region: '해외', title: '관세', text: '미국 관세 발표.', src: [0] }] }, allowed, 2, INPUT).result.why[0].src, [0]);
}

// ─── 입력 조립 ──────────────────────────────────────────────────────────────
{
  const snap = {
    scrap_kr: { base_date: '2026-10-02', base_lme: 3120, base_fx: 1359.6, items: [{ item: '드로스', grade: '-', price: 2000, change: 0 }, { item: 'SAS', grade: 'A', price: 3650, change: -50 }] },
    scrap_overseas: { us: { date: '2026-09-30', items: [{ grade: 'AL Extrusion', usd_t: 2315 }] } },
    futures: { al: { settle: 23900 }, ad: { settle: 23590 } },
    fx: { usd_krw: { rate: 1348.28 }, cny_usd: { rate: 0.14 } },
    anthracite_customs: { countries: { CN: [{ ym: '2026-05', usd_per_t: null }, { ym: '2026-08', usd_per_t: 178 }] } },
  };
  const al2 = extraLines('al2', snap).join('\n');
  assert.match(al2, /드로스 2,000원\/kg \(전주 대비 0원\)/);
  assert.match(al2, /SAS A 3,650원\/kg \(전주 대비 -50원\)/);
  assert.match(al2, /AL Extrusion 2,315 USD\/t/);
  assert.match(al2, /1차-2차 가격차: 43 USD\/t \(달러 환산\)/);   // 310위안 × 0.14
  assert.doesNotMatch(al2, /CNY|위안/);
  assert.equal(extraLines('recarb', snap)[0], '관세청 무연탄 평균 수입단가 중국산 (CIF, 전 용도 평균): 2026-08 178 USD/t'); // 소량 월 제외
  const input = buildInput('ferro', marketMetrics('ferro', hist), snap, [
    { source: '신랑재경', published: '2026-09-30T00:00:00Z', title: '光大期货日报', body: '锰硅…', repeat: true },
  ]);
  assert.match(input, /방향: 보합\n/);
  assert.doesNotMatch(input, /CNY|신호/);
  assert.match(buildInput('ferro', marketMetrics('ferro', hist), snap, [], '\n【글로벌 와이어 헤드라인】 x'), /【글로벌 와이어 헤드라인】 x$/);
  assert.match(input, /\[1\] 신랑재경 · 2026-09-30 \(이전 보도\) — 光大期货日报/);
  assert.match(buildInput('ferro', marketMetrics('ferro', hist), snap, []), /기사 없음/);
}

// 형식은 맞지만 내용이 빈 응답(2026-10-03 Opus 철강 업황) — 완성으로 보지 않는다
assert.equal(isComplete({ headline: '철강 정체', now: [], why: [], impact: [], outlook: { view: '', watch: [], up: '', down: '' } }), false);
assert.equal(isComplete({ headline: 'h', now: ['a'], impact: [{ area: 'x', text: 'y' }], outlook: { view: 'v' } }), true);

console.log('interpret tests passed');
