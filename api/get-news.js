// api/get-news.js — 비철금속 원자재 인텔리전스 API
// 탭: aluminum | ferrosilicon | recarburizer | summary

export const config = { maxDuration: 60 };

// ─── 환경변수 ───────────────────────────────────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

/**
 * Vercel 환경변수 Private Key 정규화
 * 케이스 1: Vercel이 \n을 리터럴 \\n으로 저장한 경우 → replace로 복원
 * 케이스 2: Vercel이 실제 줄바꿈으로 저장한 경우 → 그대로 사용
 * 케이스 3: 헤더/푸터 없이 raw base64만 들어온 경우 → 래핑 추가
 */
function normalizePrivateKey(raw) {
  if (!raw) return '';

  // Step 1: 리터럴 \n → 실제 줄바꿈
  let key = raw.replace(/\\n/g, '\n');

  // Step 2: 앞뒤 공백/따옴표 제거
  key = key.trim().replace(/^["']|["']$/g, '');

  // Step 3: 헤더가 없는 경우 (raw base64만 있는 경우) 래핑
  if (!key.includes('-----BEGIN')) {
    // 공백/줄바꿈 제거 후 PEM 형식으로 래핑
    const b64 = key.replace(/\s/g, '');
    const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    key = `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
  }

  // Step 4: 헤더/푸터 사이 줄바꿈 정규화
  // (헤더와 본문 사이, 본문과 푸터 사이에 줄바꿈 보장)
  key = key
    .replace(/(-----BEGIN[^-]+-----)([^\n])/g, '$1\n$2')
    .replace(/([^\n])(-----END[^-]+-----)/g, '$1\n$2');

  return key;
}

const FIREBASE_PRIVATE_KEY = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

// Firestore 활성화 여부: 3개 환경변수 + 키 형식 확인
const KEY_VALID =
  FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY') &&
  FIREBASE_PRIVATE_KEY.length > 200; // 유효한 키는 최소 수백 자

const FIREBASE_ENABLED = !!(
  FIREBASE_PROJECT_ID &&
  FIREBASE_CLIENT_EMAIL &&
  KEY_VALID
);

// ─── 진단 로그 ───────────────────────────────────────────────────────────────
console.log('=== [Firebase Diagnostics] ===');
console.log('[Firebase] ENABLED:', FIREBASE_ENABLED);
console.log('[Firebase] PROJECT_ID:', FIREBASE_PROJECT_ID ? `✅ ${FIREBASE_PROJECT_ID}` : '❌ 없음');
console.log('[Firebase] CLIENT_EMAIL:', FIREBASE_CLIENT_EMAIL ? `✅ ${FIREBASE_CLIENT_EMAIL}` : '❌ 없음');
console.log('[Firebase] PRIVATE_KEY length:', FIREBASE_PRIVATE_KEY.length);
console.log('[Firebase] KEY_VALID:', KEY_VALID);
console.log('[Firebase] KEY_HEADER (first 60):', FIREBASE_PRIVATE_KEY.slice(0, 60).replace(/\n/g, '↵'));
console.log('[Firebase] KEY_FOOTER (last 30):', FIREBASE_PRIVATE_KEY.slice(-30).replace(/\n/g, '↵'));
console.log('=== [End Diagnostics] ===');

// ─── JWT / Firestore 헬퍼 ──────────────────────────────────────────────────
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

  let keyBinary;
  try {
    keyBinary = pemToBinary(FIREBASE_PRIVATE_KEY);
  } catch (e) {
    throw new Error(`PEM → Binary 변환 실패: ${e.message}`);
  }

  let key;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      keyBinary,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (e) {
    throw new Error(`crypto.subtle.importKey 실패: ${e.message}`);
  }

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
  if (!data.access_token) {
    throw new Error(`Firebase 토큰 발급 실패: ${JSON.stringify(data)}`);
  }
  console.log('[Firebase] ✅ 토큰 발급 성공');
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
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore PATCH 실패 ${res.status}: ${text.slice(0, 200)}`);
  }
  console.log(`[Firestore] ✅ 저장 성공: ${collection}/${docId}`);
}

async function getFromFirestore(token, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    console.log(`[Firestore] 캐시 없음: ${collection}/${docId}`);
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore GET 실패 ${res.status}: ${text.slice(0, 200)}`);
  }
  const doc = await res.json();
  if (!doc.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? null;
  }
  console.log(`[Firestore] ✅ 캐시 읽기 성공: ${collection}/${docId}`);
  return out;
}

// ─── LME 알루미늄 가격 직접 fetch (Yahoo Finance) ─────────────────────────
// ALI=F: LME Aluminium 3-month futures (Yahoo Finance)
async function fetchLmePrice() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/ALI=F?interval=1d&range=5d';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('Yahoo 응답 구조 이상');

    const price = meta.regularMarketPrice ?? meta.previousClose;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
    const changePct = change && prevClose ? `${change >= 0 ? '+' : ''}${((change / prevClose) * 100).toFixed(2)}%` : null;
    const date = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);

    console.log(`[Yahoo] LME 가격 fetch 성공: ${price} USD/톤 (${date})`);
    return { price: String(price), change: String(change), change_pct: changePct, date, source: 'yahoo' };
  } catch (e) {
    console.warn('[Yahoo] LME 가격 fetch 실패:', e.message);
    return null;
  }
}

// ─── Perplexity 호출 ───────────────────────────────────────────────────────
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
          content: `당신은 비철금속 원자재 시장 전문 애널리스트입니다. 응답은 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON만. 숫자 데이터는 출처가 확인된 경우에만 포함하고, 확인 불가 시 null로 표시. (추정), (예상) 등 불확실한 단가는 절대 포함하지 마세요. 텍스트 안에 [1], [2] 같은 각주 번호를 절대 포함하지 마세요. 확인되지 않은 인과관계나 근거 없는 시황 설명을 만들어내지 마세요. 모르면 null을 반환하세요.`,
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

// ─── JSON 파싱 (코드펜스 제거 포함) ───────────────────────────────────────
function parseJSON(raw) {
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

// ─── 탭별 프롬프트 ──────────────────────────────────────────────────────────
const PROMPTS = {

  aluminum: `오늘 날짜(${new Date().toISOString().slice(0,10)}) 기준 알루미늄 시장 인텔리전스를 JSON으로 반환하세요.

【중요 지침】
- LME 가격(price, change, change_pct, date)은 별도로 제공되므로 JSON에서 제외하세요. 텍스트 분석만 작성.
- [1][2] 각주 번호 절대 금지.
- 스크랩 가격: metal.com/aluminum-scrap, scrapmonster.com, AMM, Fastmarkets 기준 실제 확인된 가격대.
- 확인 불가 숫자는 null, 불확실한 추정치 금지.

{
  "lme": {
    "price": "숫자만 (예: 2485.50) — lme.com 최신 공식가 USD/톤. 반드시 실제 값.",
    "change": "전일 대비 변동액 숫자만 (예: 12.50 또는 -8.00)",
    "change_pct": "전일 대비 변동률 (예: +0.52%)",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "move_reason": "오늘 가격 변동 이유 — 달러 인덱스, LME 재고 증감, 중국 수요, 미국 관세, 에너지 가격 등 실제 요인 2~3문장",
    "market_status": "현재 시장 상황 — LME 재고 톤수, 글로벌 수요 동향, 중국 생산/수출 현황 2~3문장",
    "outlook": "가격 전망 — 단기 상승/하락 압력 요인과 방향성 2~3문장"
  },
  "scrap": {
    "weekly_summary": "이번 주 글로벌 알루미늄 스크랩 시장 전반 요약. 미국 관세 영향, 중국 수요, 물류 변화 등 포함 (3~4문장 구체적으로)",
    "us_premium": "미국 P1020A 프리미엄 최신 분기 발표치 (USc/lb, 기준분기 명시, 예: 2026 Q1: 21.0 USc/lb)",
    "eu_premium": "유럽 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 기준분기 명시)",
    "japan_premium": "일본 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 기준분기 명시)",
    "regions": [
      {
        "region": "미국",
        "key_grades": "Zorba, Taint/Tabor, Twitch, 356 cast",
        "price_range": "최근 실제 가격대 (USD/톤 또는 USc/lb). metal.com·AMM·scrapmonster 기준. 예: Zorba $1,450~1,520/톤",
        "price_driver": "가격 변동 주요 원인: 미국 내 스크랩 공급량, 중국 수입 수요, 관세 영향, 달러 강세/약세 등 구체적으로 2~3문장",
        "flow": "주요 수출 방향 (중국, 한국, 인도 등) 및 물동량 특이사항"
      },
      {
        "region": "유럽",
        "key_grades": "Old Alloy, Tense, 6063 extrusion scrap",
        "price_range": "최근 가격대 (EUR/톤 또는 USD/톤) 또는 방향성",
        "price_driver": "유럽 스크랩 수급 상황: 자동차 해체 물량, 건설경기, 에너지 비용, 아시아 수출 경쟁 등 2~3문장",
        "flow": "아시아·터키 수출 동향"
      },
      {
        "region": "일본",
        "key_grades": "UBC (Used Beverage Can), 압출재 스크랩, 주물 스크랩",
        "price_range": "최근 가격대 (JPY/kg 또는 USD/톤) 또는 방향성",
        "price_driver": "일본 스크랩 수급: 엔화 환율 영향, 국내 소비 vs 수출 경쟁, 한국·동남아 바이어 동향 2~3문장",
        "flow": "한국·동남아·인도 수출 현황"
      },
      {
        "region": "중동",
        "key_grades": "Mixed alloy, UBC",
        "price_range": "최근 가격대 또는 방향성",
        "price_driver": "중동 스크랩 발생량, 역내 제련소 수요, 아시아 수출 경쟁 2~3문장",
        "flow": "인도·아시아 수출 동향"
      }
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

// ─── 캐시 TTL (분) — 하루 1회 업데이트 컨셉
const CACHE_TTL = {
  aluminum: 1440,
  ferrosilicon: 1440,
  recarburizer: 1440,
  summary: 1440,
};

// ─── 메인 핸들러 ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!PERPLEXITY_API_KEY) {
    return res.status(500).json({ error: 'PERPLEXITY_API_KEY not set' });
  }

  const tab = (req.query.tab || 'summary').toLowerCase();
  const force =
    req.query.force === 'true' && req.query.secret === process.env.ADMIN_SECRET;

  if (!PROMPTS[tab]) {
    return res
      .status(400)
      .json({ error: `Unknown tab: ${tab}. Use: aluminum, ferrosilicon, recarburizer, summary` });
  }

  try {
    // ── 1. Firestore 캐시 읽기 시도 ───────────────────────────────────────
    let token = null;
    if (FIREBASE_ENABLED) {
      try {
        token = await getFirestoreToken();
      } catch (e) {
        console.warn('[Firebase] 토큰 발급 실패 (캐시 비활성화):', e.message);
      }
    } else {
      console.log('[Firebase] 비활성 — Perplexity 직접 호출');
    }

    if (token && !force) {
      try {
        const cached = await getFromFirestore(token, 'commodity_cache', tab);
        if (cached?.data && cached?.cached_at) {
          const ageMin = (Date.now() - Number(cached.cached_at)) / 60000;
          if (ageMin < CACHE_TTL[tab]) {
            console.log(`[Cache] HIT: ${tab}, age: ${Math.round(ageMin)}분`);
            const parsed = JSON.parse(cached.data);
            return res.status(200).json({
              ...parsed,
              _cached: true,
              _age_min: Math.round(ageMin),
            });
          } else {
            console.log(`[Cache] EXPIRED: ${tab}, age: ${Math.round(ageMin)}분`);
          }
        }
      } catch (e) {
        console.warn('[Firestore] 캐시 읽기 실패:', e.message);
      }
    }

    // ── 2. LME 가격 직접 fetch (aluminum 탭만) ────────────────────────────
    let lmeData = null;
    if (tab === 'aluminum') {
      lmeData = await fetchLmePrice();
    }

    // ── 3. Perplexity 호출 (텍스트 시황만) ────────────────────────────────
    console.log(`[Perplexity] 호출 시작: ${tab}`);
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

    // ── LME 가격 주입: Yahoo 성공 시 덮어씌움, 실패 시 Perplexity 값 유지
    if (tab === 'aluminum' && lmeData) {
      console.log(`[LME] Yahoo 가격 주입: ${lmeData.price} (${lmeData.date})`);
      parsed.lme = {
        ...parsed.lme,
        price:      lmeData.price,
        change:     lmeData.change,
        change_pct: lmeData.change_pct,
        date:       lmeData.date,
        source:     'yahoo',
      };
    } else if (tab === 'aluminum') {
      console.warn('[LME] Yahoo 실패 — Perplexity 값 사용 (신뢰도 낮음)');
      parsed.lme = { ...parsed.lme, source: 'perplexity' };
    }

    // ── 3. Firestore 캐시 저장 시도 ───────────────────────────────────────
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
