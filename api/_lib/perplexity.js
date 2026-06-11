// api/lib/perplexity.js — Perplexity API 호출 및 JSON 파싱 헬퍼

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

/**
 * @param {string} prompt
 * @param {object} opts
 * @param {number}   [opts.maxTokens=3000]
 * @param {string}   [opts.recency]         - search_recency_filter: 'day' | 'week' | 'month' | 'year'
 * @param {string}   [opts.searchAfterDate] - search_after_date_filter: 'M/D/YYYY' (recency와 동시 사용 불가)
 * @param {string[]} [opts.domainFilter]    - search_domain_filter (최대 10개)
 * @param {boolean}  [opts.withMeta=false]  - true면 { content, searchResults } 반환
 * @returns {Promise<string | { content: string, searchResults: Array<{title?: string, url: string, date?: string}> }>}
 */
export async function callPerplexity(prompt, {
  maxTokens = 3000,
  recency = null,
  searchAfterDate = null,
  domainFilter = null,
  withMeta = false,
} = {}) {
  const body = {
    model: 'sonar',
    messages: [
      {
        role: 'system',
        content: `당신은 비철금속 원자재 시장 전문 애널리스트입니다. 응답은 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON만. 텍스트 안에 [1], [2] 같은 각주 번호를 절대 포함하지 마세요. 확인되지 않은 인과관계나 근거 없는 시황 설명을 만들어내지 마세요.

【가격·수치 필드 — NULL 원칙】 모든 숫자 필드(가격, 생산량, 재고 등)는 이번 검색 결과에서 출처와 날짜가 확인된 값만 기재하세요. 확인 불가 시 null이 정직한 응답입니다. 추정값, 범위 중간값, "약 X", 학습 데이터 기억값을 숫자 필드에 넣는 것은 null보다 나쁜 오답입니다. (추정), (예상) 등 불확실한 단가는 절대 포함하지 마세요.

【자료 부재 문구 절대 금지 — 텍스트 필드 한정】 특정 품목·지역·기업에 대한 자료가 없거나 검색에 실패했다는 사실 자체를 문장으로 서술하지 마세요. "~에 대한 자료가 없어 요약 불가", "최신 정보 미확보", "구체적 데이터 없음", "확인되지 않음", "이번 검색 결과에 확인되지 않으며" 같은 변명·메타 문구를 텍스트 필드에 절대 넣지 마세요. 검색이라는 행위 자체를 본문에 언급하지 마세요("검색 결과", "이번 검색", "검색 범위" 등 금지) — 이런 문구가 포함된 문장은 서버가 통째로 삭제하므로 처음부터 쓰지 마세요. 텍스트(서술형) 필드는 채울 내용이 없으면 가장 최근 확인된 수치나 구조적 배경으로 서술하고, 그래도 불가능하면 빈 문자열이 아닌 null로 두세요. 이 대체 서술 규칙은 텍스트 필드에만 적용되며, 숫자 필드에는 절대 적용하지 마세요.

【반복 회피】 전일·전월과 시황 변화가 작더라도 직전 응답과 토씨까지 같은 문장을 반복하지 마세요. 동일한 사실이라도 수급·원가·정책 등 다른 관점에서 서술하세요. 단, 변화를 지어내거나 없는 수치를 만들지는 마세요(보합이면 보합으로 명시).`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  if (recency) body.search_recency_filter = recency;
  else if (searchAfterDate) body.search_after_date_filter = searchAfterDate;
  if (Array.isArray(domainFilter) && domainFilter.length > 0) {
    body.search_domain_filter = domainFilter.slice(0, 10);
  }

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(55000), // 55초 타임아웃 (maxDuration 60초보다 여유있게)
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const u = data.usage;
  if (u) console.log(`[Perplexity] usage — prompt:${u.prompt_tokens} completion:${u.completion_tokens} total:${u.total_tokens} max_tokens:${maxTokens}${recency ? ` recency:${recency}` : ''}`);
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!withMeta) return content;
  const searchResults = Array.isArray(data.search_results)
    ? data.search_results
    : Array.isArray(data.citations) ? data.citations.map(u => ({ url: u })) : [];
  return { content, searchResults };
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
