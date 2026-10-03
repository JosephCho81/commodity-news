// api/_lib/agent.js — Perplexity Agent API 호출 (검색 도구 없음: 주어진 숫자·근거만 해석)
// Sonar 채팅 API는 2026-09-27 지원 종료. 모든 호출은 budget.reserveCall()로 일일 상한을 지난다.

import { reserveCall } from './budget.js';

export const DEFAULT_MODEL = process.env.AGENT_MODEL || 'anthropic/claude-sonnet-5-5';

/**
 * @returns {Promise<{ text: string, json: object|null, usage: object|null, model: string }>}
 */
export async function callAgent({ instructions, input, schema = null, model = DEFAULT_MODEL, maxOutputTokens = 2500, label = 'agent' }) {
  await reserveCall(label);
  const body = {
    model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    temperature: 0.3,
  };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'market', schema } };

  // 요청 한도(429)는 잠시 뒤 재시도 — 상한 예약은 위에서 한 번만(재시도로 일일 상한을 더 쓰지 않는다)
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch('https://api.perplexity.ai/v1/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(100000),
    });
    if (res.status !== 429 || attempt >= 3) break;
    await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`Agent HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.error) throw new Error(`Agent 오류: ${JSON.stringify(data.error).slice(0, 300)}`);

  const text = (data.output ?? [])
    .filter(o => o.type === 'message')
    .flatMap(o => o.content ?? [])
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('');
  let json = null;
  if (schema) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    try { json = JSON.parse(text.slice(s, e + 1)); } catch { json = null; }
  }
  const u = data.usage;
  if (u) console.log(`[Agent] ${label} ${model} in:${u.input_tokens} out:${u.output_tokens} $${u.cost?.total_cost ?? '?'}`);
  return { text, json, usage: u ?? null, model };
}
