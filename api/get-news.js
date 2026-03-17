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

// ─── LME 알루미늄 Cash-Settlement 가격 fetch (westmetall.com) ──────────────
// 소스: https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash
// westmetall.com은 독일 금속거래 회사가 운영하며 LME Cash-Settlement를 텍스트로 게시.
// LME 공식 Cash Bid와 0.5 USD 이내 일치 확인됨.
async function fetchLmePrice() {
  try {
    const url = 'https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`westmetall HTTP ${res.status}`);
    const html = await res.text();

    // 테이블에서 최신 2개 행 파싱
    // 패턴: <td>16. March 2026</td><td>3,440.00</td><td>...</td>
    const rowRegex = /<tr[^>]*>\s*<td[^>]*>([\d]+\.\s*\w+\s*\d{4})<\/td>\s*<td[^>]*>([\d,]+\.\d+)<\/td>/g;
    const rows = [];
    let m;
    while ((m = rowRegex.exec(html)) !== null) {
      const dateStr = m[1].trim(); // "16. March 2026"
      const priceStr = m[2].replace(/,/g, ''); // "3440.00"
      const price = parseFloat(priceStr);
      if (price > 1500 && price < 5000) {
        rows.push({ dateStr, price });
      }
      if (rows.length >= 2) break;
    }

    if (rows.length === 0) throw new Error('westmetall: 가격 파싱 실패');

    const latest = rows[0];
    const prev   = rows[1] ?? null;

    // 날짜 파싱: "16. March 2026" → "2026-03-16"
    const dateObj = new Date(latest.dateStr.replace(/\.$/, ''));
    const date = isNaN(dateObj) ? latest.dateStr : dateObj.toISOString().slice(0, 10);

    const change = prev ? +(latest.price - prev.price).toFixed(2) : null;
    const changePct = (change !== null && prev)
      ? `${change >= 0 ? '+' : ''}${((change / prev.price) * 100).toFixed(2)}%`
      : null;

    console.log(`[LME] Cash-Settlement: ${latest.price} USD/톤 (${date})`);
    return {
      price:      String(latest.price),
      change:     change !== null ? String(change) : null,
      change_pct: changePct,
      date,
      source:     'westmetall',
    };
  } catch (e) {
    console.warn('[LME] westmetall fetch 실패 — Perplexity fallback:', e.message);
    return null;
  }
}

// ─── Trading Economics 전망 텍스트 fetch ──────────────────────────────────────
async function fetchAluminumOutlook() {
  try {
    const res = await fetch('https://tradingeconomics.com/commodity/aluminum', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`TE HTTP ${res.status}`);
    const html = await res.text();

    // <h2> 태그의 첫 번째 시황 텍스트 추출
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/g);
    if (!h2Match) throw new Error('TE: h2 없음');

    // 텍스트 정리 (HTML 태그 제거)
    const texts = h2Match
      .map(h => h.replace(/<[^>]+>/g, '').trim())
      .filter(t => t.length > 50);

    if (texts.length === 0) throw new Error('TE: 텍스트 없음');

    console.log(`[TE] 전망 텍스트 fetch 성공 (${texts[0].slice(0, 50)}...)`);
    return texts.slice(0, 2).join(' ');
  } catch (e) {
    console.warn('[TE] 전망 fetch 실패:', e.message);
    return null;
  }
}

// ─── ScrapMonster 스크랩 가격 fetch (전부 USD/톤으로 통일) ─────────────────────
// 미국: USD/lb × 2204.62 = USD/톤
// 유럽: USD/톤 (그대로)
// 중국: CNY/톤 (그대로)
const LB_TO_TON = 2204.62;

async function fetchScrapPrices() {
  try {
    const res = await fetch('https://www.scrapmonster.com/scrap-prices/category/Aluminum-Scrap/116/1/1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    if (!res.ok) throw new Error(`ScrapMonster HTTP ${res.status}`);
    const html = await res.text();

    // ── 미국 가격 (USD/lb → USD/톤 환산) ──────────────────────────────────
    const usResult = {};
    const usTargets = [
      ['Zorba 90% NF',      'Zorba 90% NF'],
      ['6063 Extrusions/Fe','6063 Extrusions/Fe'],
      ['6063 Extrusions',   '6063 Extrusions'],
      ['UBC',               'UBC'],
      ['Old Sheet',         'Old Sheet'],
      ['5052 Scrap',        '5052 Scrap'],
      ['Old Cast',          'Old Cast'],
    ];
    for (const [key, label] of usTargets) {
      const idx = html.indexOf('>' + key + '<');
      if (idx === -1) continue;
      const segment = html.slice(idx, idx + 300);
      const numMatch = segment.match(/>\s*([\d]+\.[\d]+)\s*\(/);
      if (numMatch) {
        const pricePerLb = parseFloat(numMatch[1]);
        // USD/lb → USD/톤 환산 후 반올림
        usResult[label] = Math.round(pricePerLb * LB_TO_TON);
      }
    }

    // ── 유럽 가격 (USD/톤, 그대로) ────────────────────────────────────────
    const euResult = {};
    const euTargets = [
      ['Aluminum Cuttings',     'Aluminum Cuttings'],
      ['Mixed Aluminum Turnings','Mixed Turnings'],
      ['Old Cast',              'Old Cast'],
      ['UBC',                   'UBC'],
    ];
    const euSectionStart = html.indexOf('Europe Aluminum Scrap');
    const euSection = euSectionStart !== -1 ? html.slice(euSectionStart, euSectionStart + 3000) : '';
    for (const [key, label] of euTargets) {
      const idx = euSection.indexOf('>' + key + '<');
      if (idx === -1) continue;
      const segment = euSection.slice(idx, idx + 300);
      const numMatch = segment.match(/>\s*([\d,]+\.[\d]+)\s*</);
      if (numMatch) euResult[label] = parseFloat(numMatch[1].replace(/,/g, ''));
    }

    // ── 중국 가격 (CNY/톤, 그대로) ────────────────────────────────────────
    const cnResult = {};
    const cnTargets = [
      ['6063 Extrusions', '6063 Extrusions'],
      ['Old Cast',        'Old Cast'],
      ['Old Sheet',       'Old Sheet'],
      ['UBC',             'UBC'],
      ['Aluminum ingots', 'Aluminum ingots'],
    ];
    const cnSectionStart = html.indexOf('China Aluminum Scrap');
    const cnSection = cnSectionStart !== -1 ? html.slice(cnSectionStart, cnSectionStart + 3000) : '';
    for (const [key, label] of cnTargets) {
      const idx = cnSection.indexOf('>' + key + '<');
      if (idx === -1) continue;
      const segment = cnSection.slice(idx, idx + 300);
      const numMatch = segment.match(/>\s*([\d,]+\.[\d]+)\s*</);
      if (numMatch) cnResult[label] = parseFloat(numMatch[1].replace(/,/g, ''));
    }

    const result = { us: usResult, eu: euResult, cn: cnResult };
    const total = Object.keys(usResult).length + Object.keys(euResult).length + Object.keys(cnResult).length;
    console.log(`[ScrapMonster] fetch 성공: 총 ${total}개 가격 수집 (전부 톤당)`);
    return result;
  } catch (e) {
    console.warn('[ScrapMonster] fetch 실패:', e.message);
    return null;
  }
}


// ─── 일본 알루미늄 스크랩 가격 fetch (dokindokin.com - 오사카 스크랩 업체) ──────
// 【440000円/㌧(税込)】 패턴으로 직접 톤당 가격 파싱
async function fetchJapanScrapPrices() {
  try {
    const res = await fetch('https://www.dokindokin.com/scrap_type/aluminum/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`dokindokin HTTP ${res.status}`);
    const html = await res.text();

    // 날짜 추출: "2026年03月17日現在"
    const dateMatch = html.match(/(\d{4})..(\d{2})..(\d{2})../);
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : new Date().toISOString().slice(0, 10);

    // 섹션별로 【XXXXXX円/㌧】 패턴으로 파싱
    // 각 섹션 헤딩(## 품목명) 다음에 나오는 톤당 가격
    const sections = [
      { key: 'aluminum_high',       label: '6063 Extrusion Clean' },
      { key: 'aluminum_low',        label: '6063 Extrusion w/Attachments' },
      { key: 'aluminum_can_pressed',label: 'UBC Pressed (Baled)' },
      { key: 'aluminum_can',        label: 'UBC Loose' },
    ];

    // 일반 패턴: 【숫자円/㌧】 전체 HTML에서 순서대로 추출
    const tonPattern = /【(\d+)円\/㌧/g;
    const allTonPrices = [];
    let m;
    while ((m = tonPattern.exec(html)) !== null) {
      allTonPrices.push(parseInt(m[1], 10));
    }
    // 순서: 上, 下, ガラA, ガラB, 缶プレス, 缶, ラジエーター
    const labels = [
      '6063 Extrusion Clean',
      '6063 Extrusion w/Attachments',
      'Cast Aluminum A (pots/pans)',
      'Cast Aluminum B (mixed IH)',
      'UBC Pressed (Baled)',
      'UBC Loose',
      'Aluminum Radiator',
    ];

    const result = {};
    allTonPrices.forEach((price, i) => {
      if (i < labels.length && price > 0) {
        result[labels[i]] = price;
      }
    });

    console.log(`[dokindokin] 일본 스크랩 fetch 성공: ${Object.keys(result).length}개 (${date})`);
    return { prices: result, date };
  } catch (e) {
    console.warn('[dokindokin] 일본 스크랩 fetch 실패:', e.message);
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
      max_tokens: 3000,
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

【지침】
- LME 가격은 별도로 주입되므로 price/change/date 필드는 null로 두세요.
- 스크랩 가격은 scrapmonster.com 기준으로 작성하세요.
- [1][2] 각주 번호 절대 금지.
- 텍스트는 한국어로 작성하세요.

{
  "lme": {
    "price": null,
    "change": null,
    "change_pct": null,
    "date": null,
    "move_reason": "오늘 LME 알루미늄 가격 변동 이유 — 달러 인덱스, LME 재고 증감, 중국 수요, 중동 공급 차질, 미국 관세 등 실제 요인 2~3문장",
    "market_status": "현재 시장 상황 — LME 재고 톤수, 글로벌 수요 동향, 중국 생산/수출 현황 2~3문장",
    "outlook": "가격 전망 — 단기 상승/하락 압력 요인과 방향성 2~3문장. tradingeconomics.com 등 시장 전문가 전망 포함"
  },
  "scrap": {
    "weekly_summary": "이번 주 글로벌 알루미늄 스크랩 시장 전반 요약 3~4문장. 수급 변화, 주요 이슈 포함",
    "us_premium": "미국 P1020A 프리미엄 최신 분기 발표치 (USc/lb, 분기 명시)",
    "eu_premium": "유럽 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 분기 명시)",
    "japan_premium": "일본 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 분기 명시)",
    "regions": [
      {
        "region": "미국",
        "key_grades": "Zorba, 6063 Extrusions, UBC, Old Sheet, 5052",
        "price_range": "scrapmonster.com 기준 주요 품목 가격 (USD/톤). 예: Zorba $1,740/톤, 6063 $2,182/톤, UBC $1,896/톤",
        "price_driver": "미국 스크랩 가격 변동 이유: 관세 영향, 중국 수입 수요, 달러 강세/약세, 국내 공급량 변화 2~3문장",
        "flow": "주요 수출 방향 및 물동량 특이사항",
        "outlook": "미국 스크랩 단기 가격 전망 1~2문장"
      },
      {
        "region": "유럽",
        "key_grades": "Aluminum Cuttings, UBC, Old Cast, Mixed Turnings",
        "price_range": "scrapmonster.com 기준 주요 품목 가격 (USD/톤). 예: Cuttings $1,350/톤, UBC $1,250/톤",
        "price_driver": "유럽 스크랩 수급: 자동차 해체, 건설경기, 에너지 비용, 아시아 수출 경쟁 2~3문장",
        "flow": "아시아·터키 수출 동향",
        "outlook": "유럽 스크랩 단기 가격 전망 1~2문장"
      },
      {
        "region": "중국",
        "key_grades": "6063 Extrusions, Old Cast, Old Sheet, UBC, Zorba",
        "price_range": "scrapmonster.com 기준 주요 품목 가격 (CNY/톤). 예: 6063 19,500 CNY/톤, Old Cast 19,300 CNY/톤",
        "price_driver": "중국 내 스크랩 수급: 국내 소비 vs 수입 경쟁, 환경 규제, 제련소 가동률 변화 2~3문장",
        "flow": "주요 수입국 및 물동량 방향",
        "outlook": "중국 스크랩 단기 가격 전망 1~2문장"
      },
      {
        "region": "일본",
        "key_grades": "6063 Extrusion Clean, 6063 Extrusion w/attach, Cast Aluminum A, UBC Pressed, UBC Loose, Aluminum Radiator",
        "price_range": "dokindokin.com 오사카 기준 주요 품목 가격 (JPY/톤). 예: アルミ上 440,000円/톤, UBC프레스 300,000円/톤, アルミガラA 280,000円/톤",
        "price_driver": "일본 스크랩 가격 변동 이유: 엔화 환율 (LME 연동), 국내 건설경기·자동차 해체 물량, 한국·동남아 수입 수요, 계절적 발생량 변화 2~3문장",
        "flow": "한국·동남아·인도 수출 현황 및 물동량 특이사항",
        "outlook": "일본 스크랩 단기 가격 전망: 엔화 방향성, LME 연동 영향, 수출 수요 전망 1~2문장"
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

    // ── 2. aluminum 탭 전용 데이터 직접 fetch ────────────────────────────
    let lmeData = null;
    let outlookText = null;
    let scrapPrices = null;
    let japanScrap = null;
    if (tab === 'aluminum') {
      [lmeData, outlookText, scrapPrices, japanScrap] = await Promise.all([
        fetchLmePrice(),
        fetchAluminumOutlook(),
        fetchScrapPrices(),
        fetchJapanScrapPrices(),
      ]);
    }

    // ── 3. Perplexity 호출 — 스크랩/전망 데이터 컨텍스트 주입 ────────────
    let prompt = PROMPTS[tab];
    if (tab === 'aluminum') {
      let context = '\n\n【실시간 수집 데이터 — 반드시 아래 수치를 본문에 반영하세요】\n';
      if (outlookText) context += `\n[가격 전망 참고 텍스트]\n${outlookText}\n`;
      if (scrapPrices?.us && Object.keys(scrapPrices.us).length > 0) {
        context += `\n[미국 알루미늄 스크랩 실제 가격 (USD/톤, scrapmonster.com 기준, USD/lb에서 환산)]\n`;
        for (const [k, v] of Object.entries(scrapPrices.us)) {
          context += `${k}: $${v.toLocaleString('en-US')}/톤\n`;
        }
      }
      if (scrapPrices?.eu && Object.keys(scrapPrices.eu).length > 0) {
        context += `\n[유럽 알루미늄 스크랩 실제 가격 (USD/톤, scrapmonster.com 기준)]\n`;
        for (const [k, v] of Object.entries(scrapPrices.eu)) {
          context += `${k}: $${v.toLocaleString('en-US')}/톤\n`;
        }
      }
      if (scrapPrices?.cn && Object.keys(scrapPrices.cn).length > 0) {
        context += `\n[중국 알루미늄 스크랩 실제 가격 (CNY/톤, scrapmonster.com 기준)]\n`;
        for (const [k, v] of Object.entries(scrapPrices.cn)) {
          context += `${k}: ${v.toLocaleString('en-US')} CNY/톤\n`;
        }
      }
      if (japanScrap?.prices && Object.keys(japanScrap.prices).length > 0) {
        context += `\n[Japan Aluminum Scrap Prices (JPY/톤, dokindokin.com Osaka basis, ${japanScrap.date})]\n`;
        for (const [k, v] of Object.entries(japanScrap.prices)) {
          context += `${k}: ${v.toLocaleString('en-US')}円/톤\n`;
        }
      }
      prompt = PROMPTS[tab] + context;
    }

    console.log(`[Perplexity] 호출 시작: ${tab}`);
    const raw = await callPerplexity(prompt);

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

    // ── LME 가격 주입: westmetall 성공 시 덮어씌움, 실패 시 Perplexity 값 유지
    if (tab === 'aluminum' && lmeData) {
      console.log(`[LME] 가격 주입 (${lmeData.source}): ${lmeData.price} USD/톤 (${lmeData.date})`);
      parsed.lme = {
        ...parsed.lme,
        price:      lmeData.price,
        change:     lmeData.change,
        change_pct: lmeData.change_pct,
        date:       lmeData.date,
        source:     lmeData.source,
      };
    } else if (tab === 'aluminum') {
      console.warn('[LME] 직접 fetch 전부 실패 — Perplexity fallback (신뢰도 낮음)');
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
