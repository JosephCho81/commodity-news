// api/get-news.js — 비철금속 원자재 인텔리전스 API
// 탭: aluminum | ferrosilicon | recarburizer | summary

export const config = { maxDuration: 60 };

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// ─── Firestore JWT ───────────────────────────────────────────────────────────
async function getFirestoreToken() {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    iss: FIREBASE_CLIENT_EMAIL,
    sub: FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBinary(FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

function pemToBinary(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer;
}

async function saveToFirestore(token, collection, docId, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: JSON.stringify(v) };
  }
  await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function getFromFirestore(token, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const doc = await res.json();
  if (!doc.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? null;
  }
  return out;
}

// ─── Perplexity 호출 ─────────────────────────────────────────────────────────
async function callPerplexity(prompt) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: `당신은 비철금속 원자재 시장 전문 애널리스트입니다.
응답은 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록('''json) 없이 순수 JSON만.
숫자 데이터는 출처가 확인된 경우에만 포함하고, 확인 불가 시 해당 필드를 생략하거나 null로 표시.
(추정), (예상) 등 불확실한 단가는 절대 포함하지 마세요.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ─── 탭별 프롬프트 ────────────────────────────────────────────────────────────

const PROMPTS = {

  aluminum: `오늘 날짜 기준으로 알루미늄 시장 인텔리전스를 JSON으로 반환하세요.

{
  "lme": {
    "price": "LME 알루미늄 3개월물 현재가 (USD/톤, westmetall.com 또는 LME 공식 기준, 확인된 값만)",
    "change": "전일 대비 변동 (예: +12.5 또는 -8.0, USD/톤)",
    "change_pct": "전일 대비 변동률 (예: +0.52%)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "move_reason": "가격 변동 이유 — 수급, 재고, 거시경제, 달러, 에너지 비용 등 복합 요인을 2~3문장으로",
    "market_status": "현재 시장 상황 — 글로벌 수요, 주요 생산국 동향, 재고 수준을 2~3문장으로",
    "outlook": "단기 가격 예측 — 상승/하락 압력 요인과 방향성을 2~3문장으로"
  },
  "scrap": {
    "weekly_summary": "이번 주 알루미늄 스크랩 시장 전반 요약 (2문장)",
    "regions": [
      {
        "region": "미국",
        "grades": "주요 거래 등급 (예: Taint/Tabor, Twitch 등)",
        "price_range": "이번 주 가격대 (USD/톤, 확인된 경우만)",
        "flow": "주요 물동량 방향 및 특이사항"
      },
      { "region": "유럽", "grades": "...", "price_range": "...", "flow": "..." },
      { "region": "일본", "grades": "...", "price_range": "...", "flow": "..." },
      { "region": "중동", "grades": "...", "price_range": "...", "flow": "..." }
    ]
  },
  "dross_deox": {
    "dross_status": "알루미늄 드로스 세계 시황 — 주요 생산국 동향, 수급 흐름, 환경 규제 영향 (3~4문장, 단가 제외)",
    "deox_status": "탈산제 세계 시황 — 철강사 수요, 공급 상황, 주요 교역 흐름 (3~4문장, 단가 제외)"
  },
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  ferrosilicon: `오늘 날짜 기준으로 페로실리콘(FeSi) 시장 인텔리전스를 JSON으로 반환하세요.

{
  "china_price": {
    "fesi75_ningxia": "닝샤 FeSi75 현물가 (CNY/톤, sunsirs.com 기준, 확인된 값만)",
    "fesi75_neimenggu": "내몽골 FeSi75 현물가 (CNY/톤, 확인된 경우만)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "change": "전주 대비 변동 방향 및 폭 (예: -50 CNY/톤)",
    "price_context": "현재 가격 수준의 맥락 — 연중 고저점 대비, 추세 방향 (2문장)"
  },
  "china_production": {
    "ningxia": {
      "power_situation": "닝샤 전력 공급 현황 — 수력/화력 비율, 제한 여부",
      "utilization_rate": "가동률 (확인된 경우만, 예: 72%)",
      "weather_impact": "날씨 영향 (강수, 기온이 수력발전/전력비에 미치는 영향)"
    },
    "yunnan": {
      "power_situation": "윈난 전력 공급 현황",
      "utilization_rate": "가동률 (확인된 경우만)",
      "weather_impact": "날씨 영향"
    },
    "overall": "중국 전체 FeSi 생산 현황 요약 (2~3문장)"
  },
  "non_china": [
    {
      "country": "노르웨이",
      "producer": "주요 생산기업 (예: Elkem, Ferroglobe)",
      "status": "생산 현황 및 최근 동향",
      "export_direction": "주요 수출국 및 물동량 방향"
    },
    { "country": "카자흐스탄", "producer": "...", "status": "...", "export_direction": "..." },
    { "country": "말레이시아", "producer": "...", "status": "...", "export_direction": "..." },
    { "country": "러시아", "producer": "...", "status": "...", "export_direction": "..." }
  ],
  "export_flows": {
    "korea": "한국向 수입 현황 — 주요 공급국, 물량 추이, 가격 동향",
    "japan": "일본向 수입 현황",
    "eu": "EU向 수입 현황",
    "india": "인도向 수입 현황"
  },
  "market_summary": "FeSi 시장 종합 요약 및 단기 전망 (3~4문장)",
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  recarburizer: `오늘 날짜 기준으로 가탄제(무연탄·안트라사이트) 시장 인텔리전스를 JSON으로 반환하세요.

{
  "china_price": {
    "anthracite_shanxi": "산시성 무연탄 현물가 (CNY/톤, sunsirs.com 기준, 확인된 값만)",
    "anthracite_guizhou": "귀저우 무연탄 현물가 (CNY/톤, 확인된 경우만)",
    "calcined_anthracite": "하소 안트라사이트(가탄제용) 가격 (CNY/톤, 확인된 경우만)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "change": "전주 대비 변동 방향 및 폭",
    "price_context": "현재 가격 수준의 맥락 (2문장)"
  },
  "china_production": {
    "mining_status": "중국 무연탄 채굴 현황 — 주요 산지 생산량, 안전 규제 영향",
    "processing_status": "가탄제 가공 현황 — 하소 처리 능력, 가동률",
    "policy_impact": "환경/안전 정책이 생산에 미치는 영향"
  },
  "russia": {
    "export_volume": "러시아 안트라사이트 수출 현황 — 물량, 주요 목적지",
    "sanctions_impact": "제재 영향 및 우회 루트 현황",
    "price_competitiveness": "러시아산 가격 경쟁력 (중국산 대비)"
  },
  "asia_flows": [
    {
      "importer": "한국",
      "main_sources": "주요 공급국 (중국/러시아/기타 비중)",
      "volume_trend": "물량 추이 (전년 대비)",
      "price_trend": "수입 단가 동향"
    },
    { "importer": "일본", "main_sources": "...", "volume_trend": "...", "price_trend": "..." },
    { "importer": "인도", "main_sources": "...", "volume_trend": "...", "price_trend": "..." },
    { "importer": "베트남/동남아", "main_sources": "...", "volume_trend": "...", "price_trend": "..." }
  ],
  "market_summary": "가탄제 시장 종합 요약 및 단기 전망 (3~4문장)",
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  summary: `오늘 날짜 기준으로 비철금속 원자재 시장 종합 인텔리전스를 JSON으로 반환하세요.
대상 품목: LME 알루미늄, 페로실리콘(FeSi75), 가탄제(안트라사이트), 알루미늄 스크랩

{
  "date": "기준일 (YYYY-MM-DD)",
  "one_liner": "오늘 시장을 한 문장으로 — 가장 중요한 시그널 하나 (예: '닝샤 전력 제한 심화로 FeSi 공급 타이트, LME 알루미늄은 달러 약세에 반등')",
  "key_signals": [
    {
      "commodity": "LME 알루미늄",
      "signal": "핵심 시그널 (1문장)",
      "direction": "UP / DOWN / NEUTRAL",
      "urgency": "HIGH / MEDIUM / LOW"
    },
    { "commodity": "페로실리콘", "signal": "...", "direction": "...", "urgency": "..." },
    { "commodity": "가탄제", "signal": "...", "direction": "...", "urgency": "..." },
    { "commodity": "알루미늄 스크랩", "signal": "...", "direction": "...", "urgency": "..." }
  ],
  "risk_signals": [
    {
      "risk": "리스크 명칭 (예: 중국 전력 제한 심화)",
      "affected": "영향 받는 품목",
      "probability": "HIGH / MEDIUM / LOW",
      "impact": "리스크 실현 시 예상 영향 (1~2문장)"
    }
  ],
  "week_ahead": "이번 주 주목해야 할 이벤트 또는 변수 3가지 (간결하게)",
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,
};

// ─── 캐시 TTL (분) ───────────────────────────────────────────────────────────
const CACHE_TTL = {
  aluminum: 120,      // 2시간
  ferrosilicon: 180,  // 3시간
  recarburizer: 180,
  summary: 60,        // 1시간
};

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tab = req.query.tab || 'summary';
  const force = req.query.force === 'true';

  if (!PROMPTS[tab]) {
    return res.status(400).json({ error: `Unknown tab: ${tab}` });
  }

  try {
    const token = await getFirestoreToken();
    const cacheDoc = await getFromFirestore(token, 'commodity_cache', tab);

    // 캐시 유효성 확인
    if (!force && cacheDoc?.data && cacheDoc?.cached_at) {
      const age = (Date.now() - Number(cacheDoc.cached_at)) / 1000 / 60;
      if (age < CACHE_TTL[tab]) {
        const parsed = JSON.parse(cacheDoc.data);
        return res.status(200).json({ ...parsed, _cached: true, _age_min: Math.round(age) });
      }
    }

    // Perplexity 호출
    const raw = await callPerplexity(PROMPTS[tab]);

    let parsed;
    try {
      const clean = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'JSON parse failed', raw });
    }

    // Firestore 저장
    await saveToFirestore(token, 'commodity_cache', tab, {
      data: JSON.stringify(parsed),
      cached_at: String(Date.now()),
      tab,
    });

    return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
