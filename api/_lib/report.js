// api/_lib/report.js — 시장 5개 해석 + 브리핑을 묶어 하루치 리포트 생성
// 저장: commodity_cache/market_report_{날짜} + market_report_latest

import { interpretMarket, MARKET_NAMES, allowedNumbers, unitsOk, numbersOk, noCny, DIR_KO } from './interpret.js';
import { seriesStats } from './market-metrics.js';
import { DEFAULT_MODEL } from './agent.js';

export const MARKETS = ['ferro', 'al1', 'al2', 'recarb', 'steel'];

const BRIEF_INSTRUCTIONS = `당신은 국내 제강사 구매팀이 매일 아침 처음 보는 원자재 브리핑의 필자입니다.
독자는 분기·기간별 입찰로 구매하므로 매수 타이밍("구매 유리/불리", "지금 사라")은 쓰지 않습니다. 시장이 왜 움직이는지와 앞으로의 방향을 전합니다.
아래 시장별 요약과 헤드라인만 보고 오늘 전체 시장을 정리합니다. 새 사실이나 숫자를 만들지 않습니다.
- one_liner: 오늘 원자재 시장 전체를 한 줄로(40자 이내). 가장 중요한 변화가 먼저.
- lead: 3~4문장. 오늘 시장을 움직인 국내·해외 정세 → 그 영향을 받은 산업·시장 → 앞으로의 방향을 이어서 쓴다.
- common: 여러 시장에 동시에 작용하는 요인(환율, 중국 정책·연휴, 철강 감산, 거시 이벤트 등) 1~3개. 각 요인은 2문장으로, 무슨 일이 왜 일어났고 어느 시장에 어떤 경로로 어떤 방향으로 작용하는지 쓴다. 거시 이벤트는 아래 헤드라인에 있는 것만 쓴다.
문체는 서술체 평서문. 숫자는 입력에 있는 값과 단위를 그대로 쓴다. 가격은 달러·원으로만 쓰고 위안은 쓰지 않는다.`;

const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['one_liner', 'lead', 'common'],
  properties: {
    one_liner: { type: 'string' },
    lead: { type: 'string' },
    common: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'text', 'markets'],
        properties: { title: { type: 'string' }, text: { type: 'string' }, markets: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
};

export function buildBriefInput(results, history) {
  const lines = ['【시장별 요약】'];
  for (const r of results) {
    if (!r || r.error) continue;
    lines.push(`- ${r.name} (${DIR_KO[r.direction] ?? r.direction}): ${r.headline ?? ''}`);
    for (const s of r.now ?? []) lines.push(`  · ${s}`);
    for (const w of r.why ?? []) lines.push(`  · 원인(${w.region}) ${w.title}: ${w.text}`);
    if (r.outlook?.view) lines.push(`  · 전망: ${r.outlook.view}`);
  }
  const fx = seriesStats(history, 'usdkrw');
  if (fx) lines.push('', `【환율】 원/달러 ${fx.value}원 (1주 ${fx.w1_pct > 0 ? '+' : ''}${fx.w1_pct}%, 1개월 ${fx.m1_pct > 0 ? '+' : ''}${fx.m1_pct}%)`);
  return lines.join('\n');
}

export async function generateReport({ history, snap, evidence, callAgent, model = DEFAULT_MODEL, date, macroSection = '' }) {
  // 동시 2개 — 5개를 한꺼번에 보내면 요청 한도(429)에 걸린다
  const settled = new Array(MARKETS.length);
  // 시장별 해석에는 "이 사안을 공통 요인 첫 항목으로" 지시 줄을 뺀다 — 넣으면 모든 시장 원인에 같은 거시 사안이 끼어든다
  const marketMacro = macroSection.replace(/\n→[^\n]*/g, '');
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < MARKETS.length) {
      const i = next++;
      const m = MARKETS[i];
      settled[i] = await interpretMarket(m, { history, snap, articles: evidence?.markets?.[m] ?? [], callAgent, model, macroSection: marketMacro })
        .then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
    }
  }));
  const markets = {};
  settled.forEach((s, i) => {
    markets[MARKETS[i]] = s.status === 'fulfilled' ? s.value : { market: MARKETS[i], name: MARKET_NAMES[MARKETS[i]], error: s.reason?.message ?? String(s.reason) };
  });

  let brief = null;
  const ok = Object.values(markets).filter(r => !r.error);
  if (ok.length) {
    // 거시 헤드라인(Google News 와이어)은 시장별 원인과 브리핑 공통 요인의 근거
    const input = buildBriefInput(ok, history) + macroSection;
    try {
      const res = await callAgent({ instructions: BRIEF_INSTRUCTIONS, input, schema: BRIEF_SCHEMA, model, maxOutputTokens: 3000, label: 'brief' });
      if (res.json) {
        const allowed = allowedNumbers(input);
        const okText = (t) => noCny(t) && numbersOk(t, allowed) && unitsOk(t, input);
        brief = {
          one_liner: okText(res.json.one_liner ?? '') ? res.json.one_liner : null,
          lead: okText(res.json.lead ?? '') ? res.json.lead : null,
          common: (res.json.common ?? []).slice(0, 3)
            .filter(c => okText(`${c.title} ${c.text}`))
            .map(c => ({ ...c, markets: (c.markets ?? []).filter(n => Object.values(MARKET_NAMES).includes(n)) })),
          usage: res.usage,
        };
      }
    } catch (e) {
      brief = { error: e.message };
    }
  }

  const cost = [...ok.map(r => r.usage?.cost?.total_cost ?? 0), brief?.usage?.cost?.total_cost ?? 0].reduce((a, b) => a + b, 0);
  return { date, model, generated_at: new Date().toISOString(), markets, brief, cost_usd: +cost.toFixed(4) };
}

