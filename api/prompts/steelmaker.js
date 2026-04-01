// api/prompts/steelmaker.js — 국내외 제강사 현황 + 해상 운임 프롬프트

export function getSteelmakerPrompt(date) {
  return `당신은 국내 제강사 구매팀을 위한 철강 산업 전문 애널리스트입니다.
오늘 날짜(${date}) 기준 국내외 주요 제강사 현황과 해상 운임을 아래 JSON 형식으로 작성하세요.

【독자 페르소나】
국내 제강사 구매팀 담당자. 현재 제강사들의 가동 상황을 파악하고, 이것이 부원료(합금철·가탄제 등) 수요에 어떤 영향을 미칠지 예측하는 것이 핵심 관심사.

【절대 규칙】
1. "미확인", "정보 없음" 절대 금지. 최근 알려진 사실 기반으로 반드시 작성.
2. operating_rate: 반드시 HIGH, MID, LOW 중 하나.
3. direction: 반드시 UP, DOWN, NEUTRAL 중 하나.
4. 반드시 "제강사 현황 → 부원료 수요 예측" 방향으로 서술. 역방향 금지.
5. 근거 없는 업황 판단 금지. 구체적 수치·뉴스 출처 포함.
6. 각주 번호 절대 금지. 한국어 작성.

【검색 필수】
- "현대제철 가동률 생산 ${date.slice(0, 7)}"
- "POSCO 전기로 고로 가동 ${date.slice(0, 4)}"
- "동국제강 생산 감산 ${date.slice(0, 4)}"
- "China steel production operating rate ${date.slice(0, 7)}"
- "HBIS Baowu steel production ${date.slice(0, 4)}"
- "한국 건설 착공 수주 ${date.slice(0, 4)}"
- "한국 조선 수주 후판 수요 ${date.slice(0, 4)}"
- "container shipping rate Busan ${date.slice(0, 7)}"
- "40ft FEU container rate Busan USA Europe ${date.slice(0, 4)}"
- "shipping freight market BDI ${date.slice(0, 7)}"

{
  "domestic_makers": [
    {
      "name": "현대제철",
      "operating_rate": "HIGH 또는 MID 또는 LOW",
      "production_cut": false,
      "eaf_status": "전기로 가동 현황 1문장. 예: 정상 가동 / 일부 중단 / 야간 집중",
      "note": "현황 설명 2문장. 가동률 수준과 원인 포함. 반드시 작성.",
      "raw_material_impact": "이 가동 수준에서 합금철·가탄제 수요 변화 예측 1문장. 반드시 작성."
    },
    {
      "name": "POSCO",
      "operating_rate": "HIGH 또는 MID 또는 LOW",
      "production_cut": false,
      "eaf_status": "전기로/고로 가동 현황 1문장",
      "note": "현황 설명 2문장. 반드시 작성.",
      "raw_material_impact": "부원료 수요 변화 예측 1문장. 반드시 작성."
    },
    {
      "name": "동국제강",
      "operating_rate": "HIGH 또는 MID 또는 LOW",
      "production_cut": false,
      "eaf_status": "전기로 가동 현황 1문장",
      "note": "현황 설명 2문장. 반드시 작성.",
      "raw_material_impact": "부원료 수요 변화 예측 1문장. 반드시 작성."
    }
  ],
  "overseas_makers": [
    {
      "country": "중국",
      "makers": "HBIS, Baowu, Ansteel",
      "status": "중국 철강 생산 현황 3문장. 가동률 수준, 감산 여부, 정책 영향. 수치 포함. 반드시 작성.",
      "raw_material_impact": "중국 제강사 현황이 글로벌 합금철·가탄제 수요에 미치는 영향 2문장. 반드시 작성."
    },
    {
      "country": "일본",
      "makers": "Nippon Steel, JFE Steel",
      "status": "일본 철강 생산 현황 2문장. 수치 포함. 반드시 작성.",
      "raw_material_impact": "부원료 수요 영향 1문장. 반드시 작성."
    }
  ],
  "demand_industries": {
    "construction_korea": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "현재 상태 1문장",
      "basis": "근거 1문장. 착공·수주·통계 포함."
    },
    "construction_china": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "현재 상태 1문장",
      "basis": "근거 1문장. 부동산·인프라 통계 포함."
    },
    "auto": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "현재 상태 1문장",
      "basis": "근거 1문장. 생산량·수출 통계 포함."
    },
    "shipbuilding": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "현재 상태 1문장",
      "basis": "근거 1문장. 수주잔량·후판 수요 포함."
    }
  },
  "raw_material_forecast": {
    "summary": "제강사 현황 종합 기반 부원료 수요 전망 3~4문장. 반드시 '제강사 현황 → 부원료 수요' 방향으로 서술. 반드시 작성.",
    "ferroalloy": "합금철 수요 전망 2문장. 국내외 전기로·고로 가동률 기반. 반드시 작성.",
    "recarburizer": "가탄제 수요 전망 2문장. 전기로 가동률 기반. 반드시 작성."
  },
  "shipping": {
    "current_issues": "현재 해상 운임에 영향을 미치는 글로벌 이슈 3~4문장. 홍해·수에즈 상황, 미-중 관세, 계절적 요인 등 구체적 원인 포함. 반드시 작성.",
    "routes": [
      {
        "route": "부산 → 미국 서안",
        "price_feu": "USD X,XXX (40ft FEU 기준). 없으면 최근 알려진 값.",
        "direction": "UP 또는 DOWN 또는 NEUTRAL",
        "note": "변동 이유 1문장"
      },
      {
        "route": "부산 → 미국 동안",
        "price_feu": "USD X,XXX",
        "direction": "UP 또는 DOWN 또는 NEUTRAL",
        "note": "변동 이유 1문장"
      },
      {
        "route": "부산 → 유럽",
        "price_feu": "USD X,XXX",
        "direction": "UP 또는 DOWN 또는 NEUTRAL",
        "note": "변동 이유 1문장"
      },
      {
        "route": "부산 → 중국",
        "price_feu": "USD XXX",
        "direction": "UP 또는 DOWN 또는 NEUTRAL",
        "note": "변동 이유 1문장"
      },
      {
        "route": "부산 → 일본",
        "price_feu": "USD XXX",
        "direction": "UP 또는 DOWN 또는 NEUTRAL",
        "note": "변동 이유 1문장"
      },
      {
        "route": "부산 → 중동",
        "price_feu": "USD X,XXX",
        "direction": "UP 또는 DOWN 또는 NEUTRAL",
        "note": "변동 이유 1문장"
      }
    ],
    "outlook": "해상 운임 단기 전망 2문장. 이슈 해소 가능성과 방향성 포함. 반드시 작성."
  },
  "updated_at": "응답 생성 시각 ISO 8601"
}`;
}
