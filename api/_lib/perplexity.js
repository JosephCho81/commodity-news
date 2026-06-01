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
          content: `당신은 비철금속 원자재 시장 전문 애널리스트입니다. 응답은 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON만. 숫자 데이터는 출처가 확인된 경우에만 포함하고, 확인 불가 시 null로 표시. (추정), (예상) 등 불확실한 단가는 절대 포함하지 마세요. 텍스트 안에 [1], [2] 같은 각주 번호를 절대 포함하지 마세요. 확인되지 않은 인과관계나 근거 없는 시황 설명을 만들어내지 마세요.

【자료 부재 문구 절대 금지】 특정 품목·지역·기업에 대한 자료가 없거나 검색에 실패했다는 사실 자체를 문장으로 서술하지 마세요. "~에 대한 자료가 없어 요약 불가", "최신 정보 미확보", "구체적 데이터 없음", "확인되지 않음" 같은 변명·메타 문구를 텍스트 필드에 절대 넣지 마세요. 채울 내용이 없으면 가장 최근 확인된 수치나 구조적 배경으로 서술하고, 그래도 불가능하면 해당 필드를 빈 문자열이 아닌 null로 두세요. 숫자 필드는 모르면 null.

【반복 회피】 전일·전월과 시황 변화가 작더라도 직전 응답과 토씨까지 같은 문장을 반복하지 마세요. 동일한 사실이라도 수급·원가·정책 등 다른 관점에서 서술하세요. 단, 변화를 지어내거나 없는 수치를 만들지는 마세요(보합이면 보합으로 명시).`,
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
  const u = data.usage;
  if (u) console.log(`[Perplexity] usage — prompt:${u.prompt_tokens} completion:${u.completion_tokens} total:${u.total_tokens} max_tokens:${maxTokens}`);
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
