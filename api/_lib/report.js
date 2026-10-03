// api/_lib/report.js — 시장 5개 해석 + 브리핑을 묶어 하루치 리포트 생성
// 저장: commodity_cache/market_report_{날짜} + market_report_latest

import { interpretMarket, MARKET_NAMES, allowedNumbers, unitsOk, numbersOk } from './interpret.js';
import { seriesStats } from './market-metrics.js';

export const MARKETS = ['ferro', 'al1', 'al2', 'recarb', 'steel'];

const BRIEF_INSTRUCTIONS = `당신은 국내 제강사 구매팀이 매일 아침 처음 보는 원자재 브리핑의 필자입니다.
아래 시장별 요약만 보고 오늘 전체 시장을 정리합니다. 새 사실이나 숫자를 만들지 않습니다.
- one_liner: 오늘 원자재 시장 전체를 한 줄로(40자 이내). 가장 중요한 변화가 먼저.
- lead: 2~3문장. 어떤 시장이 구매에 유리하고 어떤 시장이 불리한지, 왜 그런지.
- common: 여러 시장에 동시에 작용하는 요인(환율, 중국 정책·연휴, 철강 감산 등) 1~3개. 각 요인이 어느 시장에 어떤 방향으로 작용하는지.
문체는 짧은 서술체 평서문. 숫자는 입력에 있는 값과 단위를 그대로 쓴다.`;

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
    lines.push(`- ${r.name} (${r.signal}): ${r.headline ?? ''}`);
    for (const s of r.now ?? []) lines.push(`  · ${s}`);
  }
  const fx = seriesStats(history, 'usdkrw');
  if (fx) lines.push('', `【환율】 원/달러 ${fx.value}원 (1주 ${fx.w1_pct > 0 ? '+' : ''}${fx.w1_pct}%, 1개월 ${fx.m1_pct > 0 ? '+' : ''}${fx.m1_pct}%)`);
  return lines.join('\n');
}

export async function generateReport({ history, snap, evidence, callAgent, model, date }) {
  // 동시 2개 — 5개를 한꺼번에 보내면 요청 한도(429)에 걸린다
  const settled = new Array(MARKETS.length);
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < MARKETS.length) {
      const i = next++;
      const m = MARKETS[i];
      settled[i] = await interpretMarket(m, { history, snap, articles: evidence?.markets?.[m] ?? [], callAgent, model })
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
    const input = buildBriefInput(ok, history);
    try {
      const res = await callAgent({ instructions: BRIEF_INSTRUCTIONS, input, schema: BRIEF_SCHEMA, model, maxOutputTokens: 2000, label: 'brief' });
      if (res.json) {
        const allowed = allowedNumbers(input);
        const okText = (t) => numbersOk(t, allowed) && unitsOk(t, input);
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

