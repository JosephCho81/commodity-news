// api/_lib/agent.js — Perplexity Agent API 호출. 리포트 해석은 검색 도구 없음(주어진 숫자·근거만 해석).
// 세계 동향 탐색(explore.js)만 web_search를 켠다 — 찾은 주소·문장은 코드가 원문을 열어 대조한다.
// Sonar 채팅 API는 2026-09-27 지원 종료. 모든 호출은 budget.reserveCall()로 일일 상한을 지난다.

import { reserveCall } from './budget.js';

export const DEFAULT_MODEL = process.env.AGENT_MODEL || 'anthropic/claude-sonnet-5-5';

/**
 * @returns {Promise<{ text: string, json: any, usage: any, model: string, search: { url: string, title: string, date: string | null }[] }>}
 */
// timeoutMs: 재시도까지 포함한 전체 시간 상한 — 300초 함수 한도 안에서 마지막 호출(검수)이 넘치지 않게
// tools·maxSteps: 탐색만 쓴다(검색 → 읽기 → 다시 검색 단계 수). 안 주면 요청 본문은 예전과 같다
export async function callAgent({ instructions, input, schema = null, model = DEFAULT_MODEL, maxOutputTokens = 2500, label = 'agent', timeoutMs = 100000, tools = null, maxSteps = null }) {
  const deadline = Date.now() + timeoutMs;
  await reserveCall(label);
  const body = {
    model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    temperature: 0.3,
  };
  if (tools) body.tools = tools;
  if (maxSteps) body.max_steps = maxSteps;
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'market', schema } };

  const send = () => fetch('https://api.perplexity.ai/v1/agent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  // 요청 한도(429)는 잠시 뒤 재시도 — 상한 예약은 위에서 한 번만(재시도로 일일 상한을 더 쓰지 않는다)
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await send();
    if (res.status !== 429 || attempt >= 3 || Date.now() + 4000 * (attempt + 1) + 5000 > deadline) break;
    await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
  }
  // 단계 수·검색 필터를 API가 거절하면(400) 검색 도구만, 기본 단계로 한 번 더 — 탐색이 설정 하나로 통째로 죽지 않게(glove-news 운영 방식)
  if (res.status === 400 && tools && (maxSteps || tools.some(t => Object.keys(t).length > 1))) {
    console.warn(`[Agent] ${label} 400 — 단계 수·검색 필터 없이 재시도: ${(await res.text()).slice(0, 200)}`);
    delete body.max_steps;
    body.tools = tools.map(t => ({ type: t.type }));
    res = await send();
  }
  if (!res.ok) throw new Error(`Agent HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = /** @type {any} */ (await res.json());
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
  // 검색 도구가 실제로 돌려준 결과(주소·색인 날짜) — LLM이 쓴 글이 아니라 검색 색인 값이라 발행일 확인에 쓴다
  const search = (data.output ?? []).filter(o => o.type === 'search_results').flatMap(o => o.results ?? [])
    .map(r => ({ url: r.url, title: r.title ?? '', date: r.date ?? null }));
  return { text, json, usage: u ?? null, model, search };
}
