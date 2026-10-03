// api/_lib/interpret.js — 시장별 해석 생성 (3단계)
// 입력: 결정적 지표(market-metrics) + 시장별 추가 숫자 + 근거 기사(evidence) + 거시 헤드라인. 출력: 4칸(지금·왜·영향·전망).
// 방향은 코드가 정하고, LLM은 그 이유와 의미만 쓴다. 입력에 없는 숫자·위안 표기가 들어간 문장은 버린다.

import { marketMetrics } from './market-metrics.js';

export const MARKET_NAMES = { ferro: '합금철', al1: '알루미늄 1차', al2: '알루미늄 2차', recarb: '가탄제', steel: '철강 업황' };

export const DIR_KO = { up: '강세', down: '약세', flat: '보합', mixed: '혼조' };

const FOCUS = {
  ferro: '페로실리콘(FeSi)·실리콘망간(SiMn)·페로망간. 국내 제강사가 탈산·합금용으로 수입하는 중국산 가격 흐름.',
  al1: '1차 알루미늄(LME·SHFE). 제강사 탈산제용 알루미늄 원가의 기준.',
  al2: '2차 알루미늄(주조합금·ADC12)과 알루미늄 스크랩·드로스. 탈산제 원료 가격.',
  recarb: '가탄제(무연탄 기반 탄소 첨가제). 무연탄 직접 시세가 드물어 원료탄·코크스 선물과 관세청 무연탄 수입단가로 흐름을 본다. 국내 수입 무연탄은 러시아산이 주력.',
  steel: '철강 업황. 제강사 가동·감산·제품가 흐름이 합금철·가탄제·탈산제 수요를 좌우한다.',
};

export const INSTRUCTIONS = `당신은 국내 제강사 구매팀이 매일 아침 10분 동안 읽는 원자재 시황의 필자입니다.
독자는 이 글을 보고 당장 사고팔지 않습니다. 분기·기간별 입찰로 구매하므로, 시장이 왜 이렇게 움직이는지와 앞으로 어떻게 될지를 이해해 다음 입찰 단가 협상과 예산에 참고합니다.
주어진 【숫자】·【근거 기사】·【글로벌 와이어 헤드라인】만 사용해 한 시장의 흐름을 4칸으로 씁니다.

칸별 역할
- headline: 오늘 이 시장에서 가장 중요한 변화와 그 이유를 한 줄로.
- now: 2~3문장. 무엇이 어떻게 움직였는지와 그 배경이 된 국내·해외 상황(수급, 정책, 생산, 재고, 계절 요인)을 함께 쓴다. 숫자는 문장당 1개 이내. 지표를 나열하지 않는다.
- why: 원인 1~3개. 각 원인은 "어떤 국내·해외 정세나 사건이 → 어떤 산업·수급에 어떤 영향을 주었고 → 그래서 이 가격이 어떻게 됐는지"를 2~3문장으로 이어서 쓴다. 단어만 나열하지 않는다. region은 국내·중국·해외 중 하나.
- impact: 국내 제강사 입장에서 어느 품목의 원가·공급·다음 입찰 단가에 어떤 의미인지. 매수·매도 타이밍 조언("지금 사라", "분할 구매", "구매 유리")은 쓰지 않는다.
- outlook.view: 1~2주 전망 2~3문장. "어떤 이유로 → 어떻게 될 전망"을 근거와 함께 쓴다.
- outlook.watch: 지켜볼 변수(가능하면 기준선 숫자). outlook.up/down: 각각 어떤 일이 생기면 어느 쪽으로 가는지 한 문장.

문체
- 서술체 평서문("~했다", "~이다", "~할 전망이다"). 한 문장은 70자 안팎.
- "변동성이 확대될 수 있다", "추이를 지켜볼 필요" 같은 빈말 금지. 구체적인 주체(어느 나라·어느 산업·어느 기업군)를 쓴다.
- 기사 본문이 중국어·영어여도 한국어로 쓴다. 매체명·리포트명은 한국어로 옮겨 쓴다.

사실 규칙
- 가격은 달러 또는 원으로만 쓴다. "위안"·"元"·"CNY"는 쓰지 않는다. 기사에 위안 금액만 있으면 금액 없이 "인하", "인상" 같은 방향으로만 쓴다. 위안이 들어간 문장은 삭제된다.
- 숫자는 입력에 적힌 값과 단위를 그대로 옮긴다. 반올림·환산·새 계산 금지. USD는 "달러"로 쓴다. 입력과 숫자나 단위가 다르면 그 문장은 삭제된다.
- 휴일·행사 이름은 기사에 나온 대로 쓴다(중국 10월 연휴 = 국경절).
- 글로벌 와이어 헤드라인의 거시 사안(전쟁·휴전·유가·관세 등)은 근거 기사나 숫자에서 이 시장 가격으로 이어지는 경로가 확인될 때만 원인으로 쓴다. "직접 반영된 흔적이 없다", "영향은 제한적"인 사안은 원인 칸에 넣지 않는다.
- 원인(why)은 근거 기사·글로벌 와이어 헤드라인에 있는 내용만 쓰고, 근거로 쓴 번호를 src에 반드시 넣는다(헤드라인이 근거면 0). 근거 번호가 없는 원인은 삭제된다. 기사가 하나도 없으면 숫자에서 직접 보이는 것(원가·선물 동반 하락 등)만 쓰고 src는 빈 배열로 둔다.
- 방향(강세·약세·보합)은 입력에 정해져 있다. 이와 반대되는 결론을 쓰지 않는다.
- "(이전 보도)"로 표시된 기사는 배경으로만 쓰고 새 소식처럼 쓰지 않는다.

출력은 JSON 스키마를 따른다.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'now', 'why', 'impact', 'outlook'],
  properties: {
    headline: { type: 'string', description: '오늘 이 시장을 한 줄로. 45자 이내' },
    now: { type: 'array', items: { type: 'string' }, description: '지금 어떻게 돌아가나 — 움직임과 국내외 배경, 2~3문장' },
    why: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['region', 'title', 'text', 'src'],
        properties: {
          region: { type: 'string', enum: ['국내', '중국', '해외'] },
          title: { type: 'string', description: '원인 요약, 20자 이내' },
          text: { type: 'string', description: '정세·사건 → 영향받은 산업·수급 → 가격 결과, 2~3문장' },
          src: { type: 'array', items: { type: 'integer' }, description: '근거 번호. 기사는 1부터, 거시 헤드라인은 0' },
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
        view: { type: 'string', description: '1~2주 전망 2~3문장, 이유 포함' },
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
    const al = snap.futures?.al?.settle, ad = snap.futures?.ad?.settle, cnyusd = snap.fx?.cny_usd?.rate;
    if (al && ad && cnyusd) out.push(`SHFE 1차-2차 가격차: ${fmt(Math.round((al - ad) * cnyusd))} USD/t (달러 환산)`);
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
export function buildInput(market, metrics, snap, articles, macroSection = '') {
  const lines = [`【오늘】 ${snap.date ?? ''} (한국 시간). 기사 날짜와 비교해 지난 일·진행 중인 일·예정된 일을 구분한다.`, `【시장】 ${MARKET_NAMES[market]} — ${FOCUS[market]}`, ''];
  lines.push(`【판정(코드 계산, 변경 금지)】 방향: ${DIR_KO[metrics.direction]}`, '', '【숫자】 (중국 선물은 날짜별 환율로 달러 환산한 값)');
  for (const s of metrics.series) {
    lines.push(`${s.label}: ${fmt(s.value)} ${s.unit} (${s.date}) | 1일 ${pct(s.d1_pct)} · 1주 ${pct(s.w1_pct)} · 1개월 ${pct(s.m1_pct)} | 1년 범위 ${fmt(s.y_low)}~${fmt(s.y_high)} ${s.unit}, 현재 위치 ${s.y_pos}% (0=최저, 100=최고)`);
  }
  const q = metrics.quarter;
  if (q?.usd_pct != null) lines.push(`${q.quarter} 시작 전(${q.base_date}) 대비: 달러 기준 ${pct(q.usd_pct)}, 원화 기준 ${pct(q.krw_pct)}`);
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
  return lines.join('\n') + macroSection;
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

// 위안 표기는 어떤 형태로도 화면에 내지 않는다 (2026-10-03 사용자 지시)
const CNY_RE = /위안|元|CNY|人民币/;
export const noCny = (t) => !CNY_RE.test(String(t));

// 통화 단위 대조 — 숫자는 입력에 있어도 단위를 바꿔 쓰는 오류(코크스 인하 "100~110元"을 "100~110원"으로)를 잡는다.
// 출력의 "숫자+통화"마다, 입력에서 같은 숫자 뒤에 처음 나오는 단위가 같은 통화여야 한다.
const UNIT_OUT = /(\d[\d,]*(?:\.\d+)?)\s*(원|달러|위안|엔)/g;
const UNIT_ALIAS = { 원: /^(원|KRW)/, 달러: /^(달러|USD|\$)/, 위안: /^(위안|CNY|元|yuan|RMB)/i, 엔: /^(엔|JPY|円)/ };
const UNIT_ANY = /(원|KRW|달러|USD|\$|위안|CNY|元|yuan|RMB|엔|JPY|円|%|톤|吨|kg|t\b)/;
export function unitsOk(text, inputText) {
  const input = String(inputText);
  for (const m of String(text).matchAll(UNIT_OUT)) {
    const digits = norm(m[1]);
    if (/^\d{1,2}$/.test(digits)) continue;
    const body = digits.split('').map(c => (c === '.' ? '\\.' : c)).join(',?');
    const numRe = new RegExp(`(^|[^\\d.,])${body}(?![\\d])`, 'g');
    let ok = false;
    for (const hit of input.matchAll(numRe)) {
      // 기사 표기 "$280/t", "US$ 1,200", "USD 310 per tonne" — 통화가 숫자 앞에 오는 달러
      const before = input.slice(Math.max(0, hit.index - 5), hit.index + hit[1].length);
      if (m[2] === '달러' && /(\$|USD)\s*$/.test(before)) { ok = true; break; }
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
    if (noCny(t) && numbersOk(t, allowed) && (!inputText || unitsOk(t, inputText))) return true;
    dropped.push(`${where}: ${t}`);
    return false;
  };
  // 근거 번호: 0 = 거시 헤드라인, 1~N = 기사. 기사가 있는 날 근거 없는 원인은 지어낸 것으로 보고 버린다.
  const validSrc = (src) => (src ?? []).filter(n => Number.isInteger(n) && n >= 0 && n <= articleCount);
  // 스키마 개수 제약을 API가 받지 않아 여기서 자른다(지금 3·왜 3·영향 3·변수 3)
  const r = {
    headline: keep(out.headline ?? '', 'headline') ? out.headline : null,
    now: (out.now ?? []).slice(0, 3).filter(t => keep(t, 'now')),
    why: (out.why ?? []).slice(0, 3)
      .map(w => ({ region: ['국내', '중국', '해외'].includes(w.region) ? w.region : '해외', title: w.title ?? '', text: w.text ?? '', src: validSrc(w.src) }))
      .filter(w => {
        if (!w.text || !keep(`${w.title} ${w.text}`, 'why')) return false;
        if (articleCount > 0 && !w.src.length) { dropped.push(`why(근거 번호 없음): ${w.title}`); return false; }
        return true;
      }),
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
export async function interpretMarket(market, { history, snap, articles, callAgent, model, macroSection = '' }) {
  const metrics = marketMetrics(market, history);
  const input = buildInput(market, metrics, snap, articles, macroSection);
  const allowed = allowedNumbers(input);
  const ask = (text, label) => callAgent({ instructions: INSTRUCTIONS, input: text, schema: SCHEMA, model, maxOutputTokens: 6000, label });
  let res = await ask(input, `interpret-${market}`);
  if (!res.json) throw new Error(`${market} JSON 파싱 실패: ${res.text.slice(0, 200)}`);
  let { result, dropped } = sanitizeOutput(res.json, allowed, articles.length, input);
  const usages = [res.usage];

  // 입력에 없는 숫자로 문장이 지워졌거나 핵심 칸이 비었으면(2026-10-03 Opus가 빈 JSON 반환) 한 번만 다시 쓰게 한다.
  if (!isComplete(result)) dropped.push('필수 칸 비어 있음(지금·영향·전망)');
  if (dropped.length) {
    console.warn(`[Interpret] ${market} 숫자 불일치 ${dropped.length}건 — 재작성: ${dropped.join(' | ').slice(0, 300)}`);
    const retry = await ask(`${input}\n\n【수정 요청】 아래 문장은 입력에 없는 숫자·다른 단위·위안 표기를 쓰거나 근거 번호가 없어 삭제됐다. 입력에 있는 숫자·단위만, 가격은 달러·원으로만 쓰고 원인마다 근거 번호를 달아 JSON 전체를 다시 작성하라. 기준선이 필요하면 입력의 1년 범위·현재가를 쓴다.\n${dropped.map(d => `- ${d}`).join('\n')}`, `interpret-${market}-retry`).catch(() => null);
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
    metrics,
    ...result,
    sources: articles.map((a, i) => ({ id: i + 1, source: a.source, title: a.title, url: a.url, published: a.published, repeat: !!a.repeat })),
    dropped,
    usage,
    model: res.model,
  };
}
