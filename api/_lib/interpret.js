// api/_lib/interpret.js — 시장별 해석 생성 (3단계)
// 입력: 결정적 지표(market-metrics) + 시장별 추가 숫자 + 근거 기사(evidence). 출력: 4칸(지금·왜·영향·전망).
// 방향·구매 신호는 코드가 정하고, LLM은 그 이유와 의미만 쓴다. 입력에 없는 숫자가 들어간 문장은 버린다.

import { marketMetrics } from './market-metrics.js';

export const MARKET_NAMES = { ferro: '합금철', al1: '알루미늄 1차', al2: '알루미늄 2차', recarb: '가탄제', steel: '철강 업황' };

const DIR_KO = { up: '강세', down: '약세', flat: '보합', mixed: '혼조' };

const FOCUS = {
  ferro: '페로실리콘(FeSi)·실리콘망간(SiMn)·페로망간. 국내 제강사가 탈산·합금용으로 수입하는 중국산 가격 흐름.',
  al1: '1차 알루미늄(LME·SHFE). 제강사 탈산제용 알루미늄 원가의 기준.',
  al2: '2차 알루미늄(주조합금·ADC12)과 알루미늄 스크랩·드로스. 탈산제 원료 가격.',
  recarb: '가탄제(무연탄 기반 탄소 첨가제). 무연탄 직접 시세가 드물어 원료탄·코크스 선물과 관세청 무연탄 수입단가로 흐름을 본다. 국내 수입 무연탄은 러시아산이 주력.',
  steel: '철강 업황. 제강사 가동·감산·제품가 흐름이 합금철·가탄제·탈산제 수요를 좌우한다.',
};

export const INSTRUCTIONS = `당신은 국내 제강사 구매팀이 매일 아침 10분 동안 읽는 원자재 시황의 필자입니다.
주어진 【숫자】와 【근거 기사】만 사용해 한 시장의 흐름을 4칸으로 씁니다.

칸별 역할
- headline: 오늘 이 시장에서 가장 중요한 변화와 그 의미를 한 줄로.
- now: 지금 무슨 일이 일어나고 있는지 2문장. 핵심 숫자는 문장당 1~2개만. 지표를 나열하지 말고 "무엇이 어떻게 움직였나"를 쓴다.
- why: 원인→결과 사슬. 각 단계는 사건이나 상태(예: "코크스 1차 인하", "원가 지지 약화")로 쓰고 숫자는 넣지 않는다.
- impact: 국내 제강사 구매팀 입장에서 어느 품목·계약·원가에 어떤 의미인지. 구매 판단(분할 구매, 계약 시점, 재고 운용)과 연결한다.
- outlook: 1~2주 전망, 지켜볼 변수(가능하면 기준선 숫자), 상방·하방 시나리오.

문체
- 짧은 서술체. 한 문장은 60자 안팎, 평서문("~했다", "~이다", "~할 전망이다").
- 구매팀이 바로 쓸 수 있게 구체적으로. "변동성이 확대될 수 있다", "추이를 지켜볼 필요" 같은 빈말 금지.
- 기사 본문이 중국어·영어여도 한국어로 쓴다. 매체명·리포트명은 한국어로 옮겨 쓴다.

사실 규칙
- 숫자는 입력에 적힌 값과 단위를 그대로 옮긴다. 반올림·환산·새 계산 금지. 중국 가격(元·CNY)은 "위안", 미국 가격(USD)은 "달러"로 쓴다. 입력과 숫자나 단위가 다르면 그 문장은 삭제된다.
- 휴일·행사 이름은 기사에 나온 대로 쓴다(중국 10월 연휴 = 국경절).
- 원인(why)은 근거 기사에 있는 내용만. 근거가 없으면 숫자에서 직접 보이는 것(원가·선물 동반 하락 등)만 짧게.
- 방향(강세·약세·보합)과 구매 신호는 입력에 정해져 있다. 이와 반대되는 결론을 쓰지 않는다.
- "(이전 보도)"로 표시된 기사는 배경으로만 쓰고 새 소식처럼 쓰지 않는다.
- 근거로 쓴 기사는 src에 번호를 넣는다.

출력은 JSON 스키마를 따른다.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'now', 'why', 'impact', 'outlook'],
  properties: {
    headline: { type: 'string', description: '오늘 이 시장을 한 줄로. 40자 이내' },
    now: { type: 'array', items: { type: 'string' }, description: '지금 어떻게 돌아가나 — 숫자와 함께' },
    why: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['chain', 'src'],
        properties: {
          chain: { type: 'array', items: { type: 'string' }, description: '원인→결과 단계, 각 15자 이내' },
          src: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    impact: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['area', 'text'],
        properties: { area: { type: 'string', description: '영향 받는 분야, 10자 이내' }, text: { type: 'string' } },
      },
    },
    outlook: {
      type: 'object', additionalProperties: false, required: ['view', 'watch', 'up', 'down'],
      properties: {
        view: { type: 'string', description: '1~2주 전망 한 문장' },
        watch: { type: 'array', items: { type: 'string' }, description: '지켜볼 변수(가능하면 기준선 포함)' },
        up: { type: 'string', description: '상방 시나리오 한 문장' },
        down: { type: 'string', description: '하방 시나리오 한 문장' },
      },
    },
  },
};

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pct = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v}%`);

// 시장별 추가 숫자 줄 (순수 함수)
export function extraLines(market, snap) {
  const out = [];
  if (market === 'al2') {
    const kr = snap.scrap_kr;
    if (kr?.items?.length) {
      out.push(`국내 알루미늄 스크랩 매입가 (${kr.base_date} 고시, 기준 LME ${fmt(kr.base_lme)} USD/t · 환율 ${kr.base_fx}원):`);
      for (const it of kr.items) out.push(`  ${it.item}${it.grade !== '-' ? ' ' + it.grade : ''} ${fmt(it.price)}원/kg (전주 대비 ${it.change ? (it.change > 0 ? '+' : '') + it.change + '원' : '0원'})`);
    }
    for (const [code, name] of [['us', '미국'], ['ca', '캐나다']]) {
      const g = snap.scrap_overseas?.[code];
      if (g?.items?.length) out.push(`${name} 야드 매입가 (${g.date}): ${g.items.map(i => `${i.grade} ${fmt(i.usd_t)} USD/t`).join(', ')}`);
    }
    const al = snap.futures?.al?.settle, ad = snap.futures?.ad?.settle;
    if (al && ad) out.push(`SHFE 1차-2차 가격차: ${fmt(al - ad)} CNY/t`);
  }
  if (market === 'recarb') {
    const c = snap.anthracite_customs;
    for (const [cc, name] of [['CN', '중국'], ['RU', '러시아']]) {
      const rows = (c?.countries?.[cc] ?? []).filter(r => r.usd_per_t).slice(-4);
      if (rows.length) out.push(`관세청 무연탄 평균 수입단가 ${name}산 (CIF, 전 용도 평균): ${rows.map(r => `${r.ym} ${r.usd_per_t} USD/t`).join(', ')}`);
    }
  }
  return out;
}

// LLM 입력 텍스트. 숫자 검증 때 같은 텍스트를 허용 목록으로 쓴다.
export function buildInput(market, metrics, snap, articles) {
  const lines = [`【오늘】 ${snap.date ?? ''} (한국 시간). 기사 날짜와 비교해 지난 일·진행 중인 일·예정된 일을 구분한다.`, `【시장】 ${MARKET_NAMES[market]} — ${FOCUS[market]}`, ''];
  lines.push(`【판정(코드 계산, 변경 금지)】 방향: ${DIR_KO[metrics.direction]} / 신호: ${metrics.signal}`, '', '【숫자】');
  for (const s of metrics.series) {
    lines.push(`${s.label}: ${fmt(s.value)} ${s.unit} (${s.date}) | 1일 ${pct(s.d1_pct)} · 1주 ${pct(s.w1_pct)} · 1개월 ${pct(s.m1_pct)} | 1년 범위 ${fmt(s.y_low)}~${fmt(s.y_high)} ${s.unit}, 현재 위치 ${s.y_pos}% (0=최저, 100=최고)`);
  }
  if (metrics.krw) lines.push(`원화 환산 주간 변동: 현지 가격 ${pct(metrics.krw.price_pct)}, 환율 ${pct(metrics.krw.fx_pct)} → 원화 기준 ${pct(metrics.krw.krw_pct)}`);
  if (snap.fx?.usd_krw?.rate) lines.push(`원/달러 환율: ${snap.fx.usd_krw.rate}원`);
  lines.push(...extraLines(market, snap));
  lines.push('', '【근거 기사】');
  if (!articles.length) lines.push('(오늘 이 시장의 신뢰 매체 기사 없음 — 숫자만으로 쓴다)');
  articles.forEach((a, i) => {
    lines.push(`[${i + 1}] ${a.source} · ${a.published.slice(0, 10)}${a.repeat ? ' (이전 보도)' : ''} — ${a.title}`);
    if (a.body) lines.push(a.body);
    lines.push('');
  });
  return lines.join('\n');
}

// ─── 숫자 검증 ───────────────────────────────────────────────────────────────
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const norm = (s) => s.replace(/,/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');

export function allowedNumbers(inputText) {
  return new Set((String(inputText).match(NUM_RE) ?? []).map(norm));
}

// 1~2자리 정수(월·일·분기·개수)는 허용, 그 밖의 숫자는 입력에 있어야 한다
export function numbersOk(text, allowed) {
  return (String(text).match(NUM_RE) ?? []).map(norm).every(n => (/^\d{1,2}$/.test(n)) || allowed.has(n));
}

// 통화 단위 대조 — 숫자는 입력에 있어도 단위를 바꿔 쓰는 오류(코크스 인하 "100~110元"을 "100~110원"으로)를 잡는다.
// 출력의 "숫자+통화"마다, 입력에서 같은 숫자 뒤에 처음 나오는 단위가 같은 통화여야 한다.
const UNIT_OUT = /(\d[\d,]*(?:\.\d+)?)\s*(원|달러|위안|엔)/g;
const UNIT_ALIAS = { 원: /^(원|KRW)/, 달러: /^(달러|USD|\$)/, 위안: /^(위안|CNY|元)/, 엔: /^(엔|JPY|円)/ };
const UNIT_ANY = /(원|KRW|달러|USD|\$|위안|CNY|元|엔|JPY|円|%|톤|吨|kg|t\b)/;
export function unitsOk(text, inputText) {
  const input = String(inputText);
  for (const m of String(text).matchAll(UNIT_OUT)) {
    const digits = norm(m[1]);
    if (/^\d{1,2}$/.test(digits)) continue;
    const body = digits.split('').map(c => (c === '.' ? '\\.' : c)).join(',?');
    const numRe = new RegExp(`(^|[^\\d.,])${body}(?![\\d])`, 'g');
    let ok = false;
    for (const hit of input.matchAll(numRe)) {
      // 기사 표기 "$280/t", "US$ 1,200" — 기호가 숫자 앞에 오는 달러
      const before = input.slice(Math.max(0, hit.index - 4), hit.index + hit[1].length);
      if (m[2] === '달러' && /\$\s*$/.test(before)) { ok = true; break; }
      const after = input.slice(hit.index + hit[0].length, hit.index + hit[0].length + 16);
      const u = UNIT_ANY.exec(after);
      if (u && UNIT_ALIAS[m[2]].test(after.slice(u.index))) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

// LLM 출력에서 입력에 없는 숫자가 든 항목을 제거. 제거 내역은 dropped로 돌려준다 (순수 함수 — 테스트 대상)
export function sanitizeOutput(out, allowed, articleCount, inputText = '') {
  const dropped = [];
  const keep = (t, where) => {
    if (numbersOk(t, allowed) && (!inputText || unitsOk(t, inputText))) return true;
    dropped.push(`${where}: ${t}`);
    return false;
  };
  // 스키마 개수 제약을 API가 받지 않아 여기서 자른다(지금 3·왜 2·영향 3·변수 3)
  const r = {
    headline: keep(out.headline ?? '', 'headline') ? out.headline : null,
    now: (out.now ?? []).slice(0, 3).filter(t => keep(t, 'now')),
    why: (out.why ?? []).slice(0, 2)
      .filter(w => Array.isArray(w.chain) && w.chain.every(s => keep(s, 'why')))
      .map(w => ({ chain: w.chain, src: (w.src ?? []).filter(n => Number.isInteger(n) && n >= 1 && n <= articleCount) })),
    impact: (out.impact ?? []).slice(0, 3).filter(i => keep(`${i.area} ${i.text}`, 'impact')),
    outlook: {
      view: keep(out.outlook?.view ?? '', 'outlook.view') ? out.outlook.view : null,
      watch: (out.outlook?.watch ?? []).slice(0, 3).filter(t => keep(t, 'outlook.watch')),
      up: keep(out.outlook?.up ?? '', 'outlook.up') ? out.outlook.up : null,
      down: keep(out.outlook?.down ?? '', 'outlook.down') ? out.outlook.down : null,
    },
  };
  return { result: r, dropped };
}

// 화면에 보일 최소 구성: 한 줄, 지금 1개 이상, 영향 1개 이상, 전망 문장
export function isComplete(r) {
  return !!(r?.headline && r.now?.length && r.impact?.length && r.outlook?.view);
}

// 한 시장 해석 생성. callAgent를 주입받아 모델 비교·테스트에 쓴다.
export async function interpretMarket(market, { history, snap, articles, callAgent, model }) {
  const metrics = marketMetrics(market, history);
  const input = buildInput(market, metrics, snap, articles);
  const allowed = allowedNumbers(input);
  const ask = (text, label) => callAgent({ instructions: INSTRUCTIONS, input: text, schema: SCHEMA, model, maxOutputTokens: 4500, label });
  let res = await ask(input, `interpret-${market}`);
  if (!res.json) throw new Error(`${market} JSON 파싱 실패: ${res.text.slice(0, 200)}`);
  let { result, dropped } = sanitizeOutput(res.json, allowed, articles.length, input);
  const usages = [res.usage];

  // 입력에 없는 숫자로 문장이 지워졌거나 핵심 칸이 비었으면(2026-10-03 Opus가 빈 JSON 반환) 한 번만 다시 쓰게 한다.
  if (!isComplete(result)) dropped.push('필수 칸 비어 있음(지금·영향·전망)');
  if (dropped.length) {
    console.warn(`[Interpret] ${market} 숫자 불일치 ${dropped.length}건 — 재작성: ${dropped.join(' | ').slice(0, 300)}`);
    const retry = await ask(`${input}\n\n【수정 요청】 아래 문장은 입력에 없는 숫자나 다른 단위를 써서 삭제됐다. 입력에 있는 숫자·단위만 써서 JSON 전체를 다시 작성하라. 기준선이 필요하면 입력의 1년 범위·현재가를 쓴다.\n${dropped.map(d => `- ${d}`).join('\n')}`, `interpret-${market}-retry`).catch(() => null);
    usages.push(retry?.usage);
    if (retry?.json) {
      const second = sanitizeOutput(retry.json, allowed, articles.length, input);
      const better = isComplete(second.result) && (!isComplete(result) || second.dropped.length < dropped.length);
      if (better) ({ result, dropped } = second);
    }
  }
  if (!isComplete(result)) throw new Error(`${market} 해석이 비어 있음(재작성 후에도)`);
  const usage = { cost: { total_cost: +usages.reduce((a, u) => a + (u?.cost?.total_cost ?? 0), 0).toFixed(5) } };
  return {
    market,
    name: MARKET_NAMES[market],
    direction: metrics.direction,
    signal: metrics.signal,
    metrics,
    ...result,
    sources: articles.map((a, i) => ({ id: i + 1, source: a.source, title: a.title, url: a.url, published: a.published, repeat: !!a.repeat })),
    dropped,
    usage,
    model: res.model,
  };
}
