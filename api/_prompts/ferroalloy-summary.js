// api/_prompts/ferroalloy-summary.js — 합금철 3품목 종합 시황 (경량, Step2 호출용)
// fesi/femn/simn 분석 결과를 주입받아 intl_context·non_china_summary·outlook 3개 필드만 생성

export function getFerroalloySummaryPrompt(date, fesi, femn, simn) {
  const fmt = (v) => v ?? 'N/A';

  const fesiLine    = `FeSi 75: CNY ${fmt(fesi?.price_cny)}/MT, ${fmt(fesi?.direction)}`;
  const femnLine    = `FeMn HC78: CNY ${fmt(femn?.price_cny)}/MT, ${fmt(femn?.direction)}`;
  const simnLine    = `SiMn 6517: CNY ${fmt(simn?.price_cny)}/MT, ${fmt(simn?.direction)}`;

  const fesiCtx     = String(fesi?.context  ?? 'N/A').slice(0, 200);
  const femnCtx     = String(femn?.context  ?? 'N/A').slice(0, 200);
  const simnCtx     = String(simn?.context  ?? 'N/A').slice(0, 200);

  const fesiSupply  = String(fesi?.supply_cause ?? 'N/A').slice(0, 150);
  const femnSupply  = String(femn?.supply_cause ?? 'N/A').slice(0, 150);
  const simnSupply  = String(simn?.supply_cause ?? 'N/A').slice(0, 150);

  const fesiNcList  = fesi?.non_china_producers?.map(p => p.country).join('·') ?? 'N/A';
  const femnNcList  = femn?.non_china_producers?.map(p => p.country).join('·') ?? 'N/A';
  const simnNcList  = simn?.non_china_producers?.map(p => p.country).join('·') ?? 'N/A';

  return `당신은 합금철 시황 전문 애널리스트입니다.
오늘 날짜: ${date}

아래 3개 품목 실제 분석 데이터를 기반으로 intl_context, non_china_summary, outlook 3개 필드만 작성하세요.
fesi·femn·simn 필드는 작성하지 마세요 (서버에서 자동 조립).

【3품목 현황 (실제 수집 데이터)】
${fesiLine}
공급: ${fesiSupply}
시장현황: ${fesiCtx}
비중국 생산국: ${fesiNcList}

${femnLine}
공급: ${femnSupply}
시장현황: ${femnCtx}
비중국 생산국: ${femnNcList}

${simnLine}
공급: ${simnSupply}
시장현황: ${simnCtx}
비중국 생산국: ${simnNcList}

【절대 규칙】
- intl_context, non_china_summary, outlook 3개 필드만. 다른 필드 추가 금지.
- 각 필드 1~2문장.
- 종결어미 금지: "~이다", "~했다", "~있다", "~된다".
- 가격 언급 시 CNY x,xxx/MT 형식만.
- "정보 부재", "데이터 없음" 등 불확실 표현 절대 금지.
- 각주 번호 [1][2] 금지. 한국어.

{
  "intl_context": "미·중 관세, 러시아 제재, 에너지 가격 등 FeSi·FeMn·SiMn 전반에 영향을 주는 국제 정세 요인 1~2문장.",
  "non_china_summary": "FeSi(${fesiNcList}), FeMn(${femnNcList}), SiMn(${simnNcList}) 비중국 생산지 현황 종합 1~2문장.",
  "outlook": "FeSi·FeMn·SiMn 3품목 단기(4주) 가격 방향과 핵심 변수 1~2문장."
}`;
}
