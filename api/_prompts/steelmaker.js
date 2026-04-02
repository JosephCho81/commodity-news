// api/_prompts/steelmaker.js — 국내외 제강사 현황 프롬프트

export function getSteelmakerPrompt(date) {
  const d = new Date(date + 'T00:00:00Z');
  const d3 = new Date(d.getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const ym = date.slice(0, 7); // "2026-04"
  const y  = date.slice(0, 4); // "2026"

  return `당신은 국내 제강사 구매팀을 위한 철강 산업 전문 애널리스트입니다.
오늘 날짜: ${date}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【⚠️ 필수 JSON 필드명 — 절대 변경 금지】
아래 필드명만 사용. operating_rate, production_cut, eaf_status, current_status, reason, impact, outlook 사용 금지.

domestic_makers 배열 각 객체 필드:
  name / recent_issues / production_trend / cost_factors / demand_sales / raw_material_impact

overseas_makers 배열 각 객체 필드:
  country / makers / recent_issues / production_trend / cost_factors / demand_sales / raw_material_impact
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【데이터 기준】
- recent_issues: 반드시 ${d3} ~ ${date} 기간 뉴스만. 날짜 포함. 없으면 "최근 3일 내 주요 발표 없음"
- 나머지: 2026년 1분기 또는 4월 최신 데이터. 2025년 이전 금지. 연도 명시.

【5개 필드 정의】
1. recent_issues: ${d3}~${date} 3일 이내 주요 뉴스. "YYYY년 MM월 DD일: 내용" 형식. 없으면 "최근 3일 내 주요 발표 없음"
2. production_trend: ${ym} 기준 생산량·조강량 동향. 전월/전분기 대비 수치 포함. 2~3문장.
3. cost_factors: 반드시 아래 【원가 지표 검색】 결과를 사용. ${ym} 기준 환율·철광석·원료탄·전기료 실제 수치 포함. 2문장.
4. demand_sales: 주요 수요처(건설·자동차·조선) 현황과 수출 흐름. ${ym} 기준. 2문장.
5. raw_material_impact: 탈산제·합금철·가탄제 수요 전망. 생산 수준 기반. 2문장.

【절대 규칙】
- 모든 필드 작성 필수. null 금지.
- 각 필드 2~3문장. 연도 명시.
- direction: UP / DOWN / NEUTRAL 중 하나만.
- 각주 번호 [1][2] 절대 금지. 한국어.
- 문장 종결어미 사용 금지: "~이다", "~했다", "~있다", "~된다", "~한다" 금지.
  대신 명사/단어형으로 끝낼 것: "~중", "~세", "~수준", "~감소", "~상승", "~유지", "~전망"
- demand_industries 모든 필드에 반드시 구체적 수치(%, 금액, 수량) 포함.

【원가 지표 검색 — cost_factors 작성 시 반드시 이 결과 사용】
- "원달러 환율 ${ym}" / "KRW USD exchange rate ${ym}"
- "철광석 가격 ${ym}" / "iron ore price ${ym}"
- "원료탄 가격 ${ym}" / "coking coal price ${ym}"
- "한국 산업용 전기요금 ${y}" / "Korea electricity tariff industry ${y}"
→ 위 검색으로 ${ym} 기준 실제 수치를 확인한 후 cost_factors에 반영. 이전 분기·과거 기사 수치 사용 금지.

【오늘의 시장 영향 뉴스 — 매일 자율 검색】
- "steel industry news ${date}"
- "global steel market disruption ${date}"
- "trade tariff steel impact ${date}"
- "geopolitical risk steel supply ${date}"
→ 오늘 발생한 이슈 중 철강 수요·생산·원가에 실질 영향 있는 것만 recent_issues 또는 raw_material_forecast에 반영.

【회사별·국가별 생산·수요 검색】
국내: "동국제강 ${date}" / "포스코 ${ym}" / "현대제철 ${ym}"
중국: "중국 조강 생산 ${ym}" / "Baowu HBIS steel output ${ym}"
인도: "JSW Steel production ${ym}" / "Tata Steel output ${ym}"
일본: "Nippon Steel JFE production ${ym}"
미국: "Nucor Cleveland-Cliffs steel production ${ym}"
유럽: "ArcelorMittal production ${ym}" / "Europe steel output ${ym}"
수요: "한국 건설 착공 ${ym}" / "한국 자동차 생산 ${ym}" / "한국 조선 수주 ${ym}"

{
  "domestic_makers": [
    {
      "name": "동국제강",
      "recent_issues": "${d3}~${date} 기간 주요 뉴스. 날짜 포함. 없으면 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 생산량 동향 2~3문장",
      "cost_factors": "2026년 원가 요인 2문장",
      "demand_sales": "2026년 수요처 현황 2문장",
      "raw_material_impact": "2026년 부원료 수요 전망 2문장"
    },
    {
      "name": "포스코",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 생산량 동향 2~3문장",
      "cost_factors": "2026년 원가 요인 2문장",
      "demand_sales": "2026년 수요처 현황 2문장",
      "raw_material_impact": "2026년 부원료 수요 전망 2문장"
    },
    {
      "name": "현대제철",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 생산량 동향 2~3문장",
      "cost_factors": "2026년 원가 요인 2문장",
      "demand_sales": "2026년 수요처 현황 2문장",
      "raw_material_impact": "2026년 부원료 수요 전망 2문장"
    }
  ],
  "overseas_makers": [
    {
      "country": "중국",
      "makers": "바오우(Baowu), HBIS",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 중국 조강 생산 동향 2문장. NBS 통계 기반.",
      "cost_factors": "석탄·코크스·에너지·환율 2문장",
      "demand_sales": "내수(부동산·인프라)·수출 동향 2문장",
      "raw_material_impact": "합금철·가탄제 수요 영향 2문장"
    },
    {
      "country": "인도",
      "makers": "JSW Steel, 타타스틸(Tata Steel)",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 인도 철강 생산 동향 2문장",
      "cost_factors": "원가 요인 2문장",
      "demand_sales": "인프라·건설·수출 동향 2문장",
      "raw_material_impact": "합금철·가탄제 수요 전망 2문장"
    },
    {
      "country": "일본",
      "makers": "닛폰스틸(Nippon Steel), JFE스틸",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 일본 철강 생산 동향 2문장. JISF 통계.",
      "cost_factors": "에너지·환율·원자재 2문장",
      "demand_sales": "자동차·조선·수출 동향 2문장",
      "raw_material_impact": "부원료 수요 전망 2문장"
    },
    {
      "country": "미국",
      "makers": "Nucor, Cleveland-Cliffs",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 미국 철강 생산 동향 2문장. EAF 비중 포함.",
      "cost_factors": "전기료·고철가격·관세 영향 2문장",
      "demand_sales": "건설·자동차·에너지 수요 2문장",
      "raw_material_impact": "합금철·가탄제 수요 전망 2문장"
    },
    {
      "country": "유럽",
      "makers": "ArcelorMittal",
      "recent_issues": "날짜 포함 뉴스 또는 '최근 3일 내 주요 발표 없음'",
      "production_trend": "2026년 유럽 철강 생산 동향 2문장",
      "cost_factors": "에너지·CBAM·탄소비용 2문장",
      "demand_sales": "자동차·건설·수입경쟁 2문장",
      "raw_material_impact": "부원료 수요 전망 2문장"
    }
  ],
  "demand_industries": {
    "construction_korea": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "착공·허가 면적 또는 수주액 구체 수치 포함. 예: '2026년 1분기 착공면적 전년比 -18%, 침체 지속'",
      "basis": "수치 근거. 예: '국토부 2026년 2월 착공면적 820만㎡, 전년 동기 대비 -22%'",
      "reason": "미분양·금리·PF 규제 등 원인. 수치 포함. '~이다' 금지 → '~세', '~수준', '~지속'으로 끝낼 것",
      "outlook": "2026년 하반기 전망. 반드시 숫자·조건 포함. 문장 종결 금지"
    },
    "construction_china": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "부동산 착공·완공 면적 또는 투자액 수치 포함",
      "basis": "NBS 또는 CISA 통계 수치. 예: '2026년 2월 부동산 투자 전년比 -9.8%'",
      "reason": "헝다 사태 잔재·자금조달 경색·정책 지원 규모 등. 수치 포함. 종결어미 금지",
      "outlook": "2026년 하반기 전망. 정책 효과 수치 포함. 종결어미 금지"
    },
    "auto": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "생산량·수출대수 수치 포함. 예: '2026년 1분기 한국 자동차 생산 104만대, 전년比 +3%'",
      "basis": "한국자동차산업협회·KAMA 통계 수치",
      "reason": "EV 전환율·관세·반도체 공급 등 원인. 수치 포함. 종결어미 금지",
      "outlook": "2026년 하반기 전망. 수출 전망 수치 포함. 종결어미 금지"
    },
    "shipbuilding": {
      "direction": "UP 또는 DOWN 또는 NEUTRAL",
      "status": "신규수주·수주잔량 수치(CGT 또는 척수) 포함",
      "basis": "클락슨·조선해운시황 통계. 예: '2026년 1분기 한국 신규수주 X CGT, 글로벌 점유율 Y%'",
      "reason": "LNG선·컨테이너선·암모니아추진선 수요 등 원인. 수치 포함. 종결어미 금지",
      "outlook": "2026년 하반기 전망. 수주잔량 소진 시기 또는 신규 발주 전망 포함. 종결어미 금지"
    }
  },
  "raw_material_forecast": {
    "summary": "제강사 전체 현황 기반 부원료 수요 종합 전망. 이러한 이유로 이렇게 전망한다는 인과 관계 포함. 3~4문장.",
    "deoxidizer": "탈산제(알루미늄) 수요 전망. 고로·전기로 생산량 기반 수요 증감 근거 포함. 2문장.",
    "ferroalloy": "합금철 수요 전망. 전기로·고로 가동률과 제강사 생산 계획 기반 인과관계 포함. 2문장.",
    "recarburizer": "가탄제 수요 전망. 전기로 가동률 기반 수요 증감 근거 포함. 2문장."
  },
  "updated_at": "응답 생성 시각 ISO 8601"
}`;
}
