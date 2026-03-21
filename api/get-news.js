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
- 단, lme_verified 필드: LME 공식 사이트(lme.com) 또는 주요 금융 뉴스(Reuters, Bloomberg, Metal Bulletin)에서 오늘 또는 최근 LME 알루미늄 Cash Settlement 가격을 검색해서, 주입된 가격(아래 컨텍스트)과 ±10 USD/톤 이내로 일치하면 true, 불일치 또는 확인 불가면 false로 기재.
- 스크랩 가격: scrapmonster.com → isri.org → Metal Bulletin → 업계 보도 순으로 검색. 반드시 실제 가격 기재.
- price_range 필드: 확인된 가격 기재. 못 찾으면 최근 시장 보도 기준 추정 범위를 "추정: Zorba $X~$Y/톤" 형식으로 기재. 절대 null 금지.
- [1][2] 각주 번호 절대 금지.
- 텍스트는 한국어로 작성하세요.

{
  "lme": {
    "price": null,
    "change": null,
    "change_pct": null,
    "date": null,
    "lme_verified": "true 또는 false — LME 공식/주요 뉴스 교차 검증 결과",
    "lme_verify_source": "검증에 사용한 소스 (예: Reuters, Bloomberg, lme.com) 또는 '확인 불가'",
    "move_reason": "오늘 하루 LME 알루미늄 가격 변동 이유를 2~3문장으로 작성. 오늘 날짜 기준 전일 대비 상승/하락 원인을 구체적 수치와 함께 설명. 수치 없이 막연한 서술 금지. 반드시 작성.",
    "market_status": "현재 시장 상황을 2~3문장으로 작성. LME 재고 톤수(숫자 명시), 최근 N일간 가격 추세(기간과 등락폭 수치 명시), 중국/글로벌 수요 현황 포함. 기간과 수치 없는 서술 금지. 반드시 작성.",
    "outlook": "향후 1~2주 가격 방향성을 2~3문장으로 작성. 상승/하락 근거를 구체적 요인과 함께 설명. 시장 전문가 전망치 있으면 출처와 함께 인용. 막연한 상승 가능성만 쓰지 말고 반드시 근거 명시."
  },
  "scrap": {
    "weekly_summary": "이번 주 글로벌 알루미늄 스크랩 시장 전반 요약 3~4문장. 반드시 작성.",
    "us_premium": "미국 P1020A 프리미엄 최신 분기 발표치 (USc/lb, 분기 명시). 없으면 null",
    "eu_premium": "유럽 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 분기 명시). 없으면 null",
    "japan_premium": "일본 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 분기 명시). 없으면 null",
    "regions": [
      {
        "region": "미국",
        "key_grades": "Zorba, 6063 Extrusions, UBC, Old Sheet, 5052",
        "price_range": "주요 품목 가격 (USD/톤). scrapmonster 또는 업계 보도 기준. 못 찾으면 추정 범위 기재. 예: Zorba $1,740/톤, 6063 $2,182/톤, UBC $1,896/톤. 절대 null 금지.",
        "price_driver": "미국 스크랩 가격 변동 이유: 관세 영향, 중국 수입 수요, 달러 강세/약세, 국내 공급량 변화 2~3문장. 반드시 작성.",
        "flow": "주요 수출 방향 및 물동량 특이사항. 반드시 작성.",
        "outlook": "미국 스크랩 단기 가격 전망 1~2문장. 반드시 작성."
      },
      {
        "region": "유럽",
        "key_grades": "Aluminum Cuttings, UBC, Old Cast, Mixed Turnings",
        "price_range": "주요 품목 가격 (USD/톤). 못 찾으면 추정 범위 기재. 예: Cuttings $1,350/톤, UBC $1,250/톤. 절대 null 금지.",
        "price_driver": "유럽 스크랩 수급: 자동차 해체, 건설경기, 에너지 비용, 아시아 수출 경쟁 2~3문장. 반드시 작성.",
        "flow": "아시아·터키 수출 동향. 반드시 작성.",
        "outlook": "유럽 스크랩 단기 가격 전망 1~2문장. 반드시 작성."
      },
      {
        "region": "중국",
        "key_grades": "6063 Extrusions, Old Cast, Old Sheet, UBC, Zorba",
        "price_range": "주요 품목 가격 (CNY/톤). 못 찾으면 추정 범위 기재. 예: 6063 19,500 CNY/톤, Old Cast 19,300 CNY/톤. 절대 null 금지.",
        "price_driver": "중국 내 스크랩 수급: 국내 소비 vs 수입 경쟁, 환경 규제, 제련소 가동률 변화 2~3문장. 반드시 작성.",
        "flow": "주요 수입국 및 물동량 방향. 반드시 작성.",
        "outlook": "중국 스크랩 단기 가격 전망 1~2문장. 반드시 작성."
      },
      {
        "region": "일본",
        "key_grades": "6063 Extrusion Clean, 6063 Extrusion w/attach, Cast Aluminum A, UBC Pressed, UBC Loose, Aluminum Radiator",
        "price_range": "dokindokin.com 오사카 기준 주요 품목 가격 (JPY/톤). 별도 주입 데이터 있으면 그대로 사용. 절대 null 금지.",
        "price_driver": "일본 스크랩 가격 변동 이유: 엔화 환율, 국내 건설경기·자동차 해체 물량, 한국·동남아 수입 수요 2~3문장. 반드시 작성.",
        "flow": "한국·동남아·인도 수출 현황 및 물동량 특이사항. 반드시 작성.",
        "outlook": "일본 스크랩 단기 가격 전망 1~2문장. 반드시 작성."
      }
    ]
  },
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  ferrosilicon: `오늘 날짜(${new Date().toISOString().slice(0,10)}) 기준 페로실리콘 75 시장 인텔리전스를 JSON으로 반환하세요.

【절대 규칙】
1. null 및 빈 문자열 금지. 모든 문자열 필드는 반드시 내용 작성.
2. 수치가 없으면 최신 뉴스·업계 동향·구조적 배경으로 서술. "확인된 수치 없음" 절대 금지.
3. hbis_bid_price: 반드시 아래 순서로 검색해서 기재. "미확인" 절대 금지.
   - 검색1: "HBIS ferrosilicon bidding price 2026"
   - 검색2: "河钢 硅铁 招标价 2026"
   - 검색3: "HBIS Group ferrosilicon tender price"
   - 검색4: mysteel.net "HBIS ferrosilicon"
   - 못 찾으면 가장 최근에 알려진 값(예: 2026년 1월 CNY 5,760/톤) 기재. 절대 미확인 금지.
4. fob_tianjin_monthly: mysteel, Metal Bulletin 검색. 없으면 미확인.
5. market_summary: 반드시 3~4문장.
6. 각주 번호 절대 금지. 한국어 작성.
7. 【가격 표기 형식 필수】 모든 가격은 반드시 아래 형식으로 통일:
   - USD가 있으면: "USD X,XXX/톤 (CNY X,XXX/톤)" 형식
   - CNY만 있으면: "CNY X,XXX/톤" 형식
   - 천단위 콤마 필수. "Yuan" 사용 금지, 반드시 "CNY" 사용.

{
  "china_price": {
    "hbis_bid_price": "HBIS Group 최신 월별 입찰가. Yuan/톤 및 USD/톤 병기. 예: 2026년 1월 Yuan 5760/톤 USD 805/톤",
    "hbis_bid_month": "HBIS 입찰가 기준 연월. 예: 2026-01",
    "hbis_bid_change": "전월 대비 변동. 없으면 null",
    "fob_tianjin_monthly": {
      "2026_01": "FOB 천진항 가격. 없으면 미확인",
      "2026_02": "FOB 천진항 가격. 없으면 미확인",
      "2026_03": "FOB 천진항 가격. 없으면 미확인"
    },
    "fesi75_ningxia": "닝샤 내수 현물가 CNY/톤. 최근 수치 또는 추정 범위",
    "date": "기준일 YYYY-MM-DD",
    "change": "전월 대비 변동",
    "china_context": "HBIS 입찰가 기준 현재 수준, 전월 대비 변화, 한국·일본·EU 바이어 동향, 철강사 입찰 동향 3~4문장. 반드시 작성.",
    "china_outlook": "향후 1~3개월 가격 방향성과 근거 2문장. 반드시 작성."
  },
  "china_production": {
    "overall": "닝샤·내몽골 가동률과 변화 이유, 생산량 증감, 수출 물량 변화, 2026년 전망 4~5문장. 수치 없으면 업계 구조적 현황으로 서술. 반드시 작성."
  },
  "non_china": [
    {
      "country": "노르웨이",
      "producer": "Elkem, Ferroglobe",
      "status": "가동 현황, EU CBAM 영향, 에너지가격 영향 포함. 반드시 작성.",
      "price_context": "유럽산 FOB 수준 또는 중국산 대비 프리미엄",
      "export_direction": "EU 역내, 미국, 일본 수출"
    },
    {
      "country": "카자흐스탄",
      "producer": "Kazsilicon, ENRC",
      "status": "생산·수출 동향, 증설 현황, 가격 경쟁력. 반드시 작성.",
      "price_context": "중국산 대비 가격 경쟁력",
      "export_direction": "유럽, 한국, 일본 수출"
    },
    {
      "country": "말레이시아",
      "producer": "OM Holdings",
      "status": "생산·수출 동향, 한국·일본 수요 변화. 반드시 작성.",
      "price_context": "말레이시아산 가격 수준 및 중국산 대비 경쟁력",
      "export_direction": "한국, 일본, 인도 수출"
    },
    {
      "country": "러시아",
      "producer": "CHEMK",
      "status": "제재 이후 수출 루트 변화, 생산·수출 동향, 할인 폭. 반드시 작성.",
      "price_context": "제재 이후 할인 폭 및 가격 경쟁력",
      "export_direction": "중국, 인도, 터키 우회 수출"
    }
  ],
  "non_china_context": "EU CBAM, 카자흐스탄 증설, 러시아 제재, 중국산 점유율 현황 2~3문장. 반드시 작성.",
  "market_summary": "HBIS 입찰가 기준 가격 수준, 중국 FOB 방향성, 비중국 공급 변화, 글로벌 철강 수요 전망, 단기 가격 방향성 3~4문장. 반드시 작성.",
  "updated_at": "응답 생성 시각 ISO 8601"
}`,

  recarburizer: `당신은 원자재 시장 애널리스트입니다. 아래 JSON을 오늘 날짜(${new Date().toISOString().slice(0,10)}) 기준으로 완전히 채워서 반환하세요.

【절대 규칙】
- 모든 텍스트 필드(string)는 반드시 실제 내용을 작성하세요. "" 또는 "정보 없음" 금지.
- 가격 필드는 숫자만 입력하세요. 단위·설명 금지. 예: "135" (O), "135 USD/톤" (X), "약 135" (X)
- 가격을 찾으면 반드시 해당 필드에 숫자로 기재. 텍스트 설명 안에만 넣고 필드를 null로 두는 것 금지.
- 끝까지 못 찾은 경우에만 null 허용.
- 【핵심】 이 보고서는 반드시 무연탄(Anthracite)만 다룹니다. 유연탄(Bituminous coal), 열탄(Thermal coal), 원료탄(Coking coal), 갈탄(Lignite) 관련 내용은 절대 포함 금지.
- 【금지 문구】 아래 표현은 어떤 필드에도 절대 사용 금지:
  "검색 결과에서 확인되지 않았다", "구체적 정보가 제시되지 않았다", "데이터 부재",
  "추가 정보가 필요합니다", "파악하기 어렵습니다", "확인할 수 없습니다",
  "제공된 검색 결과로는", "신뢰할 수 있는 전망을 제시하기 어렵습니다"
  → 이런 표현 대신 반드시 업계 구조적 현황, 알려진 사실, 시장 논리 기반으로 작성할 것.

【검색 소스 — 아래 소스들을 적극 활용하세요】
- 가격 데이터: coalspot.com, steelorbis.com, sunsirs.com, metalbulletin.com, argusmedia.com
- 시장 뉴스: Reuters, Bloomberg, S&P Global Commodity Insights, Fastmarkets
- 중국 무연탄 업체: Jincheng Anthracite Mining Group(晋城无烟煤矿业集团), Lu'an Group(潞安集团), Yangquan Coal(阳泉煤业)
- 러시아 무연탄 업체: SUEK(시베리아석탄에너지), Raspadskaya, Mechel
- 업계 기관: World Coal Association(worldcoal.org), IEA coal reports, China National Coal Association
- 한국 수입: KITA(한국무역협회), 한국에너지공단

【중국 무연탄(Anthracite) 가격 검색】
1. "China anthracite FOB Qinhuangdao price 2026"
2. "Jincheng Lu'an anthracite export price 2026"
3. sunsirs.com 무연탄 시세
→ fob_qinhuangdao 또는 domestic_shanxi 필드에 숫자 기재. 참고 범위: FOB 100~180 USD/톤

【러시아 무연탄(Anthracite) 가격 검색】
1. "SUEK anthracite export price 2026"
2. "Russia anthracite FOB Murmansk price 2026"
3. "Russian anthracite Korea import price 2026"
→ fob_murmansk 필드에 숫자 기재. 참고 범위: FOB 80~150 USD/톤

{
  "china_price": {
    "fob_qinhuangdao": "숫자만. 예: 135 (못 찾으면 null)",
    "cif_korea": "숫자만. 예: 148 (못 찾으면 null)",
    "domestic_shanxi": "숫자만 CNY/톤. 예: 850 (못 찾으면 null)",
    "calcined_cac_fob": "숫자만 USD/톤. 못 찾으면 null",
    "price_range_text": "fob_qinhuangdao를 못 찾은 경우 반드시 작성. 형식 엄수: '숫자~숫자 USD/MT' 만 작성. 예: '130~150 USD/MT'. fob_qinhuangdao가 있으면 null",
    "price_range_source": "가격 기준 출처 한 줄. 못 찾으면 'FOB 친황다오 기준' 으로 기재",
    "price_range_note": "최근 무연탄(Anthracite) 시장 특이사항 한 줄. 반드시 작성.",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "change": "예: -2 USD/톤 또는 -1.5% (못 찾으면 null)"
  },
  "russia_price": {
    "fob_murmansk": "숫자만. 예: 110 (못 찾으면 null)",
    "cif_korea": "숫자만. 예: 125 (못 찾으면 null)",
    "price_range_text": "fob_murmansk를 못 찾은 경우 반드시 작성. 형식 엄수: '숫자~숫자 USD/MT' 만 작성. 예: '100~120 USD/MT'. fob_murmansk가 있으면 null",
    "price_range_source": "가격 기준 출처 한 줄. 못 찾으면 'FOB 무르만스크 기준' 으로 기재",
    "price_range_note": "러시아 무연탄(Anthracite) 시장 특이사항 한 줄. 반드시 작성.",
    "date": "가격 기준일 (YYYY-MM-DD)",
    "change": "전주/전월 대비 변동 (못 찾으면 null)",
    "vs_china": "러시아산 vs 중국산 무연탄 가격 격차 한 줄 요약 — 반드시 작성"
  },
  "global_market": {
    "headline": "현재 전세계 무연탄(Anthracite) 시장 최대 이슈 — 반드시 1문장으로 작성. 유연탄·열탄 내용 포함 금지.",
    "current_level": "현재 무연탄(Anthracite) 가격 수준 — 최근 추이를 2문장으로 작성. 무연탄만 서술.",
    "key_drivers": "무연탄(Anthracite) 가격에 영향을 주는 주요 요인 3~4문장. 가탄제 수요(제강·주조업), 러·우 전쟁, 중국 생산 규제, 인도 수요 중 해당되는 것 포함. 유연탄·열탄 내용 포함 금지.",
    "outlook": "향후 1~3개월 무연탄(Anthracite) 가격 방향성과 근거를 2문장으로 작성."
  },
  "china_production": {
    "annual_output": "중국 무연탄(Anthracite) 연간 생산량 — 최근 확인된 수치. 못 찾으면 null",
    "annual_consumption": "중국 무연탄(Anthracite) 연간 소비량. 못 찾으면 null",
    "export_volume": "중국 무연탄(Anthracite) 수출량 및 주요 수출국. 못 찾으면 null",
    "import_volume": "중국 무연탄(Anthracite) 수입량 및 주요 수입국. 못 찾으면 null",
    "production_status": "현재 중국 무연탄(Anthracite) 생산 현황 3문장. 산시·내몽골·귀저우 산지 상황, 안전규제, 계절적 요인 포함. 유연탄 내용 포함 금지. 반드시 작성.",
    "cbam_carbon": "CBAM과 중국 탄소배출권(CEA)이 중국 무연탄 수출·생산에 미치는 영향 2~3문장. 반드시 작성.",
    "policy": "최근 중국 무연탄(Anthracite) 관련 주요 정책과 영향 2문장. 반드시 작성.",
    "outlook": "향후 6~12개월 중국 무연탄 생산·수출 전망 2~3문장. 반드시 작성."
  },
  "russia_production": {
    "annual_output": "러시아 무연탄(Anthracite) 연간 생산량. 못 찾으면 null",
    "export_volume": "러시아 무연탄(Anthracite) 수출량 및 주요 수출국. 못 찾으면 null",
    "main_importers": "러시아 무연탄 주요 수입국과 비중 한 줄. 예: 인도 30%, 중국 25%, 한국 10%, 터키 8%. 반드시 작성.",
    "production_status": "현재 러시아 무연탄(Anthracite) 생산 현황 2~3문장. 쿠즈바스·사하·시베리아 탄전 상황 포함. 반드시 작성.",
    "sanctions_impact": "서방 제재가 러시아 무연탄 수출에 미친 영향 3~4문장. 아시아 피벗, 항만·철도 물류 변화 포함. 반드시 작성.",
    "war_impact": "러시아-우크라이나 전쟁이 무연탄 생산·수출에 미친 영향 2~3문장. 반드시 작성.",
    "outlook": "향후 6~12개월 러시아 무연탄 생산·수출 전망 2문장. 반드시 작성."
  },
  "asia_flows": {
    "available": true,
    "flows": [
      { "importer": "한국", "main_sources": "무연탄 기준 중국/러시아/기타 비중", "volume_trend": "전년 대비 무연탄 수입 물량 동향", "price_trend": "수입 단가 동향" },
      { "importer": "인도", "main_sources": "무연탄 주요 공급국", "volume_trend": "물량 추이", "price_trend": "단가 동향" },
      { "importer": "중국(수입)", "main_sources": "무연탄 주요 공급국", "volume_trend": "물량 추이", "price_trend": "단가 동향" },
      { "importer": "일본/동남아", "main_sources": "무연탄 주요 공급국", "volume_trend": "물량 추이", "price_trend": "단가 동향" }
    ]
  },
  "market_summary": "전세계 무연탄(Anthracite)·가탄제 시장 종합 — 중국·러시아 공급 구도, 지정학적 리스크, 아시아 가탄제 수요 방향, 단기 가격 전망을 4~5문장으로 반드시 작성. 유연탄·열탄 내용 포함 금지.",
  "updated_at": "${new Date().toISOString()}"
}`,

  summary: `당신은 원자재 시장 애널리스트입니다. 오늘 날짜(${new Date().toISOString().slice(0,10)}) 기준으로 비철금속 원자재 시장 종합 인텔리전스를 JSON으로 반환하세요.
대상 품목: LME 알루미늄, 페로실리콘(FeSi75), 가탄제(안트라사이트), 알루미늄 스크랩

【절대 규칙】
- 모든 필드 반드시 작성. null 또는 빈 문자열 금지.
- one_liner: 따옴표(\") 절대 포함 금지. 순수 텍스트만.
- key_signals: 4개 품목 모두 반드시 작성. signal 필드는 최근 시황 기반 1문장.
- direction: 반드시 UP, DOWN, NEUTRAL 중 하나.
- urgency: 반드시 HIGH, MEDIUM, LOW 중 하나.
- week_ahead: 이번 주 주목 변수 3가지를 줄바꿈(\\n)으로 구분해서 작성.
- 모든 숫자 가격은 천단위 콤마 필수. 예: 3,426 USD/톤, 5,850 CNY/톤, 440,000 JPY/톤.

{
  "date": "${new Date().toISOString().slice(0,10)}",
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
      "risk": "리스크 명칭 — 반드시 작성 (예: 중동 공급 차질 심화)",
      "affected": "영향 받는 품목 — 반드시 작성",
      "probability": "HIGH 또는 MEDIUM 또는 LOW",
      "impact": "리스크 실현 시 예상 영향 1~2문장 — 반드시 작성"
    },
    {
      "risk": "두 번째 리스크 — 반드시 작성",
      "affected": "영향 받는 품목",
      "probability": "HIGH 또는 MEDIUM 또는 LOW",
      "impact": "예상 영향 1~2문장"
    }
  ],
  "week_ahead": "① 첫 번째 주목 변수\\n② 두 번째 주목 변수\\n③ 세 번째 주목 변수 — 반드시 3가지 작성",
  "updated_at": "${new Date().toISOString()}"
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
        const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const docId = `${tab}_${todayKST}`;
        const cached = await getFromFirestore(token, 'commodity_cache', docId);
        if (cached?.data) {
          const ageMin = cached.cached_at
            ? Math.round((Date.now() - Number(cached.cached_at)) / 60000)
            : 0;
          console.log(`[Cache] HIT: ${docId}, age: ${ageMin}분`);
          const parsed = JSON.parse(cached.data);
          return res.status(200).json({ ...parsed, _cached: true, _age_min: ageMin });
        }
        console.log(`[Cache] MISS: ${docId} → Perplexity 호출`);
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

    // ── 2-1. summary 탭 전용: 각 탭 캐시 데이터 주입 ────────────────────
    let summaryContext = '';
    if (tab === 'summary' && token) {
      try {
        // 오늘 우선, 없으면 최근 7일 fallback
        const readTab = async (tabName) => {
          for (let i = 0; i <= 7; i++) {
            try {
              const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10);
              const doc = await getFromFirestore(token, 'commodity_cache', `${tabName}_${d}`).catch(() => null);
              if (doc?.data) return doc;
            } catch (e) { /* 다음 날짜 시도 */ }
          }
          return null;
        };

        const [alData, fsiData, recData] = await Promise.all([
          readTab('aluminum'),
          readTab('ferrosilicon'),
          readTab('recarburizer'),
        ]);
        summaryContext = '\n\n【오늘 수집된 각 탭 실제 데이터 — 반드시 아래 내용을 기반으로 시그널 작성】\n';
        if (alData?.data) {
          const al = JSON.parse(alData.data);
          summaryContext += `\n[알루미늄]\n`;
          summaryContext += `LME Cash Settlement: ${al.lme?.price ?? 'N/A'} USD/톤 (${al.lme?.date ?? ''})\n`;
          summaryContext += `변동: ${al.lme?.change ?? 'N/A'} USD/톤 (${al.lme?.change_pct ?? ''})\n`;
          summaryContext += `시장현황: ${al.lme?.market_status ?? ''}\n`;
          summaryContext += `전망: ${al.lme?.outlook ?? ''}\n`;
          summaryContext += `스크랩: ${al.scrap?.weekly_summary ?? ''}\n`;
        }
        if (fsiData?.data) {
          const fsi = JSON.parse(fsiData.data);
          summaryContext += `\n[페로실리콘]\n`;
          const fobM = fsi.china_price?.fob_tianjin_monthly;
          if (fobM) summaryContext += `FOB 천진항: ${JSON.stringify(fobM)}\n`;
          summaryContext += `시장현황: ${fsi.china_price?.china_context ?? ''}\n`;
          summaryContext += `전망: ${fsi.china_price?.china_outlook ?? ''}\n`;
          summaryContext += `종합: ${fsi.market_summary ?? ''}\n`;
        }
        if (recData?.data) {
          const rec = JSON.parse(recData.data);
          summaryContext += `\n[가탄제]\n`;
          summaryContext += `중국 무연탄: ${rec.china_price?.fob_qinhuangdao ?? rec.china_price?.price_range_text ?? 'N/A'} USD/MT\n`;
          summaryContext += `러시아: ${rec.russia_price?.fob_murmansk ?? rec.russia_price?.price_range_text ?? 'N/A'} USD/MT\n`;
          summaryContext += `시장현황: ${rec.global_market?.headline ?? ''} ${rec.global_market?.key_drivers ?? ''}\n`;
          summaryContext += `종합: ${rec.market_summary ?? ''}\n`;
        }
        console.log('[Summary] 탭 데이터 주입 완료');
      } catch (e) {
        console.warn('[Summary] 탭 데이터 주입 실패:', e.message);
      }
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

    if (tab === 'summary' && summaryContext) {
      prompt = PROMPTS[tab] + summaryContext;
    }

    console.log(`[Perplexity] 호출 시작: ${tab}`);
    const raw = await callPerplexity(prompt);

    let parsed;
    try {
      parsed = parseJSON(raw);
    } catch (e) {
      console.error('[JSON] 파싱 실패:', e.message, '| raw:', raw.slice(0, 300));

      // JSON 파싱 실패 시 최근 7일 fallback
      if (token) {
        for (let i = 1; i <= 7; i++) {
          try {
            const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10);
            const fallback = await getFromFirestore(token, 'commodity_cache', `${tab}_${d}`);
            if (fallback?.data) {
              console.log(`[Fallback] JSON 파싱 실패 → ${i}일 전 데이터 반환`);
              const fallbackParsed = JSON.parse(fallback.data);
              return res.status(200).json({ ...fallbackParsed, _cached: true, _fallback: true, _age_min: 0 });
            }
          } catch (fe) { /* 다음 날짜 시도 */ }
        }
      }

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

    // ── 3. Firestore 날짜별 저장 (7일 보관, 빈 데이터 저장 방지) ──────────
    if (token) {
      try {
        // 탭별 핵심 필드 유효성 검사 — 빈 데이터는 저장 안 함
        const isValidData = (() => {
          if (tab === 'aluminum')     return !!(parsed.lme?.price || parsed.lme?.market_status);
          if (tab === 'ferrosilicon') return !!(parsed.china_price?.china_context || parsed.market_summary);
          if (tab === 'recarburizer') return !!(
            parsed.china_price?.price_range_text || parsed.china_price?.fob_qinhuangdao ||
            parsed.global_market?.headline || parsed.market_summary
          );
          if (tab === 'summary')      return !!(parsed.one_liner && parsed.key_signals?.length > 0);
          return true;
        })();

        if (!isValidData) {
          console.warn(`[Firestore] 유효성 검사 실패 — 빈 데이터 저장 건너뜀: ${tab}`);
          // 빈 데이터 대신 최근 7일 fallback 반환
          for (let i = 1; i <= 7; i++) {
            try {
              const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10);
              const fallback = await getFromFirestore(token, 'commodity_cache', `${tab}_${d}`);
              if (fallback?.data) {
                console.log(`[Fallback] 유효성 실패 → ${i}일 전 데이터 반환: ${tab}_${d}`);
                const fallbackParsed = JSON.parse(fallback.data);
                return res.status(200).json({ ...fallbackParsed, _cached: true, _fallback: true, _age_min: Math.round((Date.now() - Number(fallback.cached_at || 0)) / 60000) });
              }
            } catch (e) { /* 다음 날짜 시도 */ }
          }
          // fallback도 없으면 빈 데이터 그대로 반환
          return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
        } else {
          const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const docId = `${tab}_${todayKST}`;
          await saveToFirestore(token, 'commodity_cache', docId, {
            data: JSON.stringify(parsed),
            cached_at: String(Date.now()),
            tab,
            date: todayKST,
          });
          console.log(`[Firestore] ✅ 저장 성공: commodity_cache/${docId}`);
        }
      } catch (e) {
        console.warn('[Firestore] 캐시 저장 실패:', e.message);
      }
    }

    return res.status(200).json({ ...parsed, _cached: false, _age_min: 0 });
  } catch (err) {
    console.error('[Handler] 예외:', err.message);

    // Perplexity 실패 시 최근 7일 fallback (가장 최신 데이터 반환)
    if (token) {
      for (let i = 1; i <= 7; i++) {
        try {
          const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10);
          const fallback = await getFromFirestore(token, 'commodity_cache', `${tab}_${d}`);
          if (fallback?.data) {
            console.log(`[Fallback] ${i}일 전 데이터 반환: ${tab}_${d}`);
            const parsed = JSON.parse(fallback.data);
            return res.status(200).json({
              ...parsed,
              _cached: true,
              _fallback: true,
              _age_min: Math.round((Date.now() - Number(fallback.cached_at || 0)) / 60000),
            });
          }
        } catch (e) { /* 없으면 다음 날짜 시도 */ }
      }
    }

    return res.status(500).json({ error: err.message });
  }
}
