// api/prompts/summary.js — 비철금속 원자재 종합 인텔리전스 프롬프트

export function getSummaryPrompt(date) {
  return `당신은 원자재 시장 애널리스트입니다. 오늘 날짜(${date}) 기준으로 비철금속 원자재 시장 종합 인텔리전스를 JSON으로 반환하세요.
대상 품목: LME 알루미늄, 페로실리콘(FeSi75), 가탄제(안트라사이트), 알루미늄 스크랩

【절대 규칙】
- 모든 필드 반드시 작성. null 또는 빈 문자열 금지.
- one_liner: 따옴표(\\") 절대 포함 금지. 순수 텍스트만.
- key_signals: 4개 품목 모두 반드시 작성. signal 필드는 최근 시황 기반 1문장.
- direction: 반드시 UP, DOWN, NEUTRAL 중 하나.
- urgency: 반드시 HIGH, MEDIUM, LOW 중 하나.
- week_ahead: 이번 주 주목 변수 3가지를 줄바꿈(\\n)으로 구분해서 작성.
- 모든 숫자 가격은 천단위 콤마 필수. 예: 3,426 USD/톤, 5,850 CNY/톤, 440,000 JPY/톤.

{
  "date": "${date}",
  "one_liner": "오늘 비철금속 시장 핵심 한 문장 — 따옴표 없이 순수 텍스트로 반드시 작성",
  "key_signals": [
    {
      "commodity": "LME 알루미늄",
      "signal": "LME 알루미늄 최근 가격 동향과 핵심 시그널을 1문장으로 — 반드시 작성",
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "urgency": "HIGH 또는 MEDIUM 또는 LOW"
    },
    {
      "commodity": "페로실리콘(FeSi75)",
      "signal": "페로실리콘 75 FOB 천진항 가격 동향과 핵심 시그널을 1문장으로 — 반드시 작성",
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "urgency": "HIGH 또는 MEDIUM 또는 LOW"
    },
    {
      "commodity": "가탄제(안트라사이트)",
      "signal": "무연탄·안트라사이트 시장 핵심 시그널을 1문장으로 — 반드시 작성",
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "urgency": "HIGH 또는 MEDIUM 또는 LOW"
    },
    {
      "commodity": "알루미늄 스크랩",
      "signal": "글로벌 알루미늄 스크랩 시장 핵심 시그널을 1문장으로 — 반드시 작성",
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "urgency": "HIGH 또는 MEDIUM 또는 LOW"
    }
  ],
  "risk_signals": [
    {
      "risk": "리스크 명칭 (10자 이내). 예: '중국 알루미늄 수출 규제'",
      "affected": "영향 받는 품목. 예: 'LME 알루미늄, 알루미늄 스크랩'",
      "probability": "HIGH 또는 MEDIUM 또는 LOW",
      "why": "이 리스크가 왜 발생했는지/발생할 가능성이 있는지 — 원인·배경 1~2문장. 반드시 작성.",
      "impact": "리스크 실현 시 각 품목 가격에 미치는 영향 1~2문장. 수치 포함. 반드시 작성.",
      "outlook": "이 리스크의 단기 해소 가능성 또는 악화 가능성 1문장. 반드시 작성."
    },
    {
      "risk": "두 번째 리스크 명칭",
      "affected": "영향 받는 품목",
      "probability": "HIGH 또는 MEDIUM 또는 LOW",
      "why": "왜 이 리스크가 존재하는지 1~2문장. 반드시 작성.",
      "impact": "실현 시 영향 1~2문장. 수치 포함. 반드시 작성.",
      "outlook": "단기 해소/악화 가능성 1문장. 반드시 작성."
    }
  ],
  "week_ahead": [
    {
      "variable": "주목 변수명 (10자 이내). 예: '중국 알루미늄 생산량 통계'",
      "why": "왜 이 변수를 주목해야 하는지 1~2문장. 반드시 작성.",
      "expected": "이 변수가 어떻게 나올 것으로 예상되며, 그 영향은 무엇인지 1문장. 반드시 작성."
    },
    {
      "variable": "두 번째 주목 변수명",
      "why": "왜 주목해야 하는지 1~2문장. 반드시 작성.",
      "expected": "예상 결과와 영향 1문장. 반드시 작성."
    },
    {
      "variable": "세 번째 주목 변수명",
      "why": "왜 주목해야 하는지 1~2문장. 반드시 작성.",
      "expected": "예상 결과와 영향 1문장. 반드시 작성."
    }
  ],
  "updated_at": "${new Date().toISOString()}"
}`;
}
