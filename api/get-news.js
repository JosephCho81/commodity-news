// api/get-news.js — 비철금속 원자재 인텔리전스 API
// 탭: aluminum | ferrosilicon | recarburizer | summary

export const config = { maxDuration: 60 };

// ─── 환경변수 ─────────────────────────────────────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
// Vercel 환경변수에서 \n이 리터럴 문자열로 저장되는 경우 처리
const RAW_KEY = process.env.FIREBASE_PRIVATE_KEY || '';
const FIREBASE_PRIVATE_KEY = RAW_KEY.replace(/\\n/g, '\n');

// Firestore 활성화 여부: 3개 환경변수 모두 필요
const FIREBASE_ENABLED = !!(
  FIREBASE_PROJECT_ID &&
  FIREBASE_CLIENT_EMAIL &&
  (FIREBASE_PRIVATE_KEY.includes('BEGIN RSA PRIVATE KEY') ||
   FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY'))
);

// ─── JWT / Firestore 헬퍼 ────────────────────────────────────────────────────
function pemToBinary(pem) {
  const b64 = pem
    .replace(/-----BEGIN[^-]*-----/g, '')
    .replace(/-----END[^-]*-----/g, '')
    .replace(/\s/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

function toBase64Url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function bufToBase64Url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getFirestoreToken() {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = toBase64Url(
    JSON.stringify({
      iss: FIREBASE_CLIENT_EMAIL,
      sub: FIREBASE_CLIENT_EMAIL,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/datastore',
    })
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBinary(FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${bufToBase64Url(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Firebase token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function saveToFirestore(token, collection, docId, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: JSON.stringify(v) };
  }
  await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
}

async function getFromFirestore(token, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
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
응답은 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON만.
숫자 데이터는 출처가 확인된 경우에만 포함하고, 확인 불가 시 null로 표시.
(추정), (예상) 등 불확실한 단가는 절대 포함하지 마세요.
텍스트 안에 [1], [2] 같은 각주 번호를 절대 포함하지 마세요.
확인되지 않은 인과관계나 근거 없는 시황 설명을 만들어내지 마세요. 모르면 null을 반환하세요.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ─── JSON 파싱 (코드펜스 제거 포함) ─────────────────────────────────────────
function parseJSON(raw) {
  let clean = raw.trim();
  // ```json ... ``` 또는 ``` ... ``` 제거
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  } else {
    // 첫 { 부터 마지막 } 까지만 추출
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);
  }
  return JSON.parse(clean);
}

// ─── 탭별 프롬프트 ────────────────────────────────────────────────────────────
const PROMPTS = {

  aluminum: `오늘 날짜 기준 알루미늄 시장 인텔리전스를 JSON으로 반환하세요.

중요 지침:
- LME 가격은 반드시 lme.com 공식 사이트(https://www.lme.com/en/metals/non-ferrous/lme-aluminium) 또는 westmetall.com의 가장 최근 공식 데이터를 사용하세요. 오늘 또는 가장 최근 거래일 기준입니다.
- 텍스트에 [1][2] 같은 각주 번호를 절대 포함하지 마세요.
- 드로스와 탈산제는 확인된 뉴스 기반 정보만 작성하고, 없으면 null을 반환하세요. 추측 금지.
- 알루미늄 스크랩 가격대는 최근 업계 뉴스(AMM, Metal Bulletin, Fastmarkets 등)에서 확인된 범위를 작성하세요.

{
  "lme": {
    "price": "LME 알루미늄 3개월물 공식가 (USD/톤) — lme.com 또는 westmetall.com 최신값, 확인 불가 시 null",
    "change": "전일 대비 변동액 (숫자만, 예: 12.5 또는 -8.0)",
    "change_pct": "전일 대비 변동률 (예: +0.52%)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "move_reason": "가격 변동 이유 — 확인된 뉴스 기반으로 2~3문장. 각주 번호 없이.",
    "market_status": "현재 시장 상황 — 확인된 수급/재고/수요 동향 2~3문장. 각주 번호 없이.",
    "outlook": "단기 전망 — 실제 시장 요인 기반 2~3문장. 각주 번호 없이."
  },
  "scrap": {
    "weekly_summary": "이번 주 알루미늄 스크랩 시장 전반 요약 (확인된 뉴스 기반 2문장)",
    "regions": [
      {
        "region": "미국",
        "grades": "주요 거래 등급 (예: Taint/Tabor, Twitch, 356 등)",
        "price_range": "최근 거래 가격대 (USD/톤, AMM 또는 업계 뉴스 기반, 없으면 null)",
        "flow": "이번 주 물동량 방향 및 주요 동향"
      },
      { "region": "유럽", "grades": "주요 등급", "price_range": "가격대 또는 null", "flow": "물동량 동향" },
      { "region": "일본", "grades": "주요 등급", "price_range": "가격대 또는 null", "flow": "물동량 동향" },
      { "region": "중동", "grades": "주요 등급", "price_range": "가격대 또는 null", "flow": "물동량 동향" }
    ]
  },
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  ferrosilicon: `오늘 날짜 기준으로 페로실리콘(FeSi) 시장 인텔리전스를 JSON으로 반환하세요.

{
  "china_price": {
    "fesi75_ningxia": "닝샤 FeSi75 현물가 (CNY/톤, sunsirs.com 기준, 확인된 값만, 없으면 null)",
    "fesi75_neimenggu": "내몽골 FeSi75 현물가 (CNY/톤, 확인된 경우만, 없으면 null)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "change": "전주 대비 변동 방향 및 폭 (예: -50 CNY/톤, 없으면 null)",
    "price_context": "현재 가격 수준의 맥락 — 연중 고저점 대비, 추세 방향 (2문장)"
  },
  "china_production": {
    "ningxia": {
      "power_situation": "닝샤 전력 공급 현황 — 수력/화력 비율, 제한 여부",
      "utilization_rate": "가동률 (확인된 경우만, 예: 72%, 없으면 null)",
      "weather_impact": "날씨 영향 (강수, 기온이 수력발전/전력비에 미치는 영향)"
    },
    "yunnan": {
      "power_situation": "윈난 전력 공급 현황",
      "utilization_rate": "가동률 (확인된 경우만, 없으면 null)",
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
    { "country": "카자흐스탄", "producer": "주요 생산기업", "status": "현황", "export_direction": "수출 방향" },
    { "country": "말레이시아", "producer": "주요 생산기업", "status": "현황", "export_direction": "수출 방향" },
    { "country": "러시아", "producer": "주요 생산기업", "status": "현황", "export_direction": "수출 방향" }
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
    "anthracite_shanxi": "산시성 무연탄 현물가 (CNY/톤, sunsirs.com 기준, 확인된 값만, 없으면 null)",
    "anthracite_guizhou": "귀저우 무연탄 현물가 (CNY/톤, 확인된 경우만, 없으면 null)",
    "calcined_anthracite": "하소 안트라사이트(가탄제용) 가격 (CNY/톤, 확인된 경우만, 없으면 null)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "change": "전주 대비 변동 방향 및 폭 (없으면 null)",
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
    { "importer": "일본", "main_sources": "공급국", "volume_trend": "추이", "price_trend": "단가 동향" },
    { "importer": "인도", "main_sources": "공급국", "volume_trend": "추이", "price_trend": "단가 동향" },
    { "importer": "베트남/동남아", "main_sources": "공급국", "volume_trend": "추이", "price_trend": "단가 동향" }
  ],
  "market_summary": "가탄제 시장 종합 요약 및 단기 전망 (3~4문장)",
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  summary: `오늘 날짜 기준으로 비철금속 원자재 시장 종합 인텔리전스를 JSON으로 반환하세요.
대상 품목: LME 알루미늄, 페로실리콘(FeSi75), 가탄제(안트라사이트), 알루미늄 스크랩

{
  "date": "기준일 (YYYY-MM-DD)",
  "one_liner": "오늘 시장을 한 문장으로 — 가장 중요한 시그널 하나",
  "key_signals": [
    {
      "commodity": "LME 알루미늄",
      "signal": "핵심 시그널 (1문장)",
      "direction": "UP",
      "urgency": "MEDIUM"
    },
    { "commodity": "페로실리콘", "signal": "핵심 시그널", "direction": "DOWN", "urgency": "HIGH" },
    { "commodity": "가탄제", "signal": "핵심 시그널", "direction": "NEUTRAL", "urgency": "LOW" },
    { "commodity": "알루미늄 스크랩", "signal": "핵심 시그널", "direction": "UP", "urgency": "MEDIUM" }
  ],
  "risk_signals": [
    {
      "risk": "리스크 명칭 (예: 중국 전력 제한 심화)",
      "affected": "영향 받는 품목",
      "probability": "HIGH",
      "impact": "리스크 실현 시 예상 영향 (1~2문장)"
    }
  ],
  "week_ahead": "이번 주 주목해야 할 이벤트 또는 변수 3가지 (간결하게, 줄바꿈 사용 가능)",
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,
};

// ─── 캐시 TTL (분) ───────────────────────────────────────────────────────────
const CACHE_TTL = {
  aluminum: 120,
  ferrosilicon: 180,
  recarburizer: 180,
  summary: 60,
};

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Perplexity 키 필수
  if (!PERPLEXITY_API_KEY) {
    return res.status(500).json({ error: 'PERPLEXITY_API_KEY not set' });
  }

  const tab = (req.query.tab || 'summary').toLowerCase();
  const force = req.query.force === 'true';

  if (!PROMPTS[tab]) {
    return res.status(400).json({ error: `Unknown tab: ${tab}. Use: aluminum, ferrosilicon, recarburizer, summary` });
  }

  try {
    // ── 1. Firestore 캐시 읽기 시도 ─────────────────────────────────────────
    let token = null;
    if (FIREBASE_ENABLED) {
      try {
        token = await getFirestoreToken();
      } catch (e) {
        console.warn('[Firebase] 토큰 발급 실패 (캐시 비활성화):', e.message);
      }
    }

    if (token && !force) {
      try {
        const cached = await getFromFirestore(token, 'commodity_cache', tab);
        if (cached?.data && cached?.cached_at) {
          const ageMin = (Date.now() - Number(cached.cached_at)) / 60000;
          if (ageMin < CACHE_TTL[tab]) {
            const parsed = JSON.parse(cached.data);
            return res.status(200).json({
              ...parsed,
              _cached: true,
              _age_min: Math.round(ageMin),
            });
          }
        }
      } catch (e) {
        console.warn('[Firestore] 캐시 읽기 실패:', e.message);
      }
    }

    // ── 2. Perplexity 호출 ───────────────────────────────────────────────────
    const raw = await callPerplexity(PROMPTS[tab]);

    let parsed;
    try {
      parsed = parseJSON(raw);
    } catch (e) {
      console.error('[JSON] 파싱 실패:', e.message, '| raw:', raw.slice(0, 300));
      return res.status(500).json({
        error: 'JSON parse failed',
        detail: e.message,
        raw_preview: raw.slice(0, 300),
      });
    }

    // ── 3. Firestore 캐시 저장 시도 ─────────────────────────────────────────
    if (token) {
      try {
        await saveToFirestore(token, 'commodity_cache', tab, {
          data: JSON.stringify(parsed),
          cached_at: String(Date.now()),
          tab,
        });
      } catch (e) {
        console.warn('[Firestore] 캐시 저장 실패:', e.message);
      }
    }

    return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
  } catch (err) {
    console.error('[Handler] 예외:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
