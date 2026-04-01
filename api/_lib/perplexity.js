// api/lib/perplexity.js — Perplexity API 호출 및 JSON 파싱 헬퍼

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

export async function callPerplexity(prompt, { maxTokens = 3000 } = {}) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(55000), // 55초 타임아웃 (maxDuration 60초보다 여유있게)
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: `당신은 비철금속 원자재 시장 전문 애널리스트입니다. 응답은 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON만. 숫자 데이터는 출처가 확인된 경우에만 포함하고, 확인 불가 시 null로 표시. (추정), (예상) 등 불확실한 단가는 절대 포함하지 마세요. 텍스트 안에 [1], [2] 같은 각주 번호를 절대 포함하지 마세요. 확인되지 않은 인과관계나 근거 없는 시황 설명을 만들어내지 마세요. 모르면 null을 반환하세요.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export function parseJSON(raw) {
  let clean = raw.trim();
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  } else {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);
  }
  return JSON.parse(clean);
}
