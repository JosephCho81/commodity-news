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

// ─── UK 공식 공휴일 API 기반 LME 휴장 감지 ───────────────────────────────────
// 출처: https://www.gov.uk/bank-holidays.json (영국 정부 공식 API, 무료·키 불필요)
// 매년 자동 업데이트되므로 하드코딩 불필요

// 공휴일명 영→한 매핑
const HOLIDAY_NAME_KO = {
  "New Year's Day":          '신년',
  "New Year's Day (substitute)": '신년 대체공휴일',
  'Good Friday':             '성금요일',
  'Easter Monday':           '부활절 월요일',
  'Early May bank holiday':  '5월 조기 공휴일',
  'Spring bank holiday':     '봄 공휴일',
  'Summer bank holiday':     '하계 공휴일',
  'Christmas Day':           '크리스마스',
  'Christmas Day (substitute)': '크리스마스 대체공휴일',
  'Boxing Day':              '박싱데이',
  'Boxing Day (substitute)': '박싱데이 대체공휴일',
};

// UK 공식 API에서 공휴일 목록을 fetch해서 캐시
let _ukHolidayCache = null; // { date: title, ... }

async function fetchUkHolidays() {
  if (_ukHolidayCache) return _ukHolidayCache;
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`UK holiday API HTTP ${res.status}`);
    const data = await res.json();
    // england-and-wales 기준 (LME 소재지)
    const events = data['england-and-wales']?.events ?? [];
    _ukHolidayCache = {};
    for (const e of events) {
      _ukHolidayCache[e.date] = e.title; // { '2026-04-03': 'Good Friday', ... }
    }
    console.log(`[UKHoliday] ✅ ${Object.keys(_ukHolidayCache).length}개 공휴일 로드`);
    return _ukHolidayCache;
  } catch (e) {
    console.warn('[UKHoliday] API 실패, 빈 목록 사용:', e.message);
    return {};
  }
}

// parsedDate(마지막 LME 가격 날짜)와 오늘 사이 UK 공휴일 탐색
// 반환 형식: "영국 Easter Monday(부활절 월요일) 공휴일로 03/21 ~ 03/23 LME 휴장"
async function getLmeHolidayNote(parsedDate) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (parsedDate === today) return null; // 오늘 날짜 데이터면 정상

  const holidays = await fetchUkHolidays();

  // parsedDate 다음날부터 오늘(당일 포함) 사이 공휴일 수집
  const holidayDates = [];
  const from = new Date(parsedDate + 'T00:00:00Z');
  const to   = new Date(today + 'T00:00:00Z');

  for (let d = new Date(from.getTime() + 86400000); d <= to; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    if (holidays[key]) holidayDates.push({ date: key, title: holidays[key] });
  }

  if (holidayDates.length === 0) return null;

  // 연속 구간으로 묶어서 시작일~종료일 표시
  // mm/dd 형식으로 변환
  const fmt = (dateStr) => {
    const [, mm, dd] = dateStr.split('-');
    return `${mm}/${dd}`;
  };

  const startDate = holidayDates[0].date;
  const endDate   = holidayDates[holidayDates.length - 1].date;

  // 공휴일 이름들 (중복 제거)
  const uniqueTitles = [...new Set(holidayDates.map(h => h.title))];
  const titleStr = uniqueTitles.map(t => {
    const ko = HOLIDAY_NAME_KO[t];
    return ko ? `${t}(${ko})` : t;
  }).join(', ');

  const rangeStr = startDate === endDate ? fmt(startDate) : `${fmt(startDate)} ~ ${fmt(endDate)}`;

  return `영국 ${titleStr} 공휴일로 ${rangeStr} LME 휴장`;
}


// ─── 전일 Firestore 캐시에서 핵심 수치 추출 ───────────────────────────────────
async function fetchPrevDayData(token, tab) {
  if (!token) return null;
  try {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10);
      const doc = await getFromFirestore(token, 'commodity_cache', `${tab}_${d}`).catch(() => null);
      if (doc?.data) {
        const parsed = JSON.parse(doc.data);
        console.log(`[PrevDay] ${tab} 전일 데이터 로드: ${d}`);
        return { date: d, data: parsed };
      }
    }
  } catch (e) {
    console.warn('[PrevDay] 전일 데이터 로드 실패:', e.message);
  }
  return null;
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

    const holidayNote = await getLmeHolidayNote(date);
    if (holidayNote) console.log(`[LME] 공휴일 감지: ${holidayNote}`);
    console.log(`[LME] Cash-Settlement: ${latest.price} USD/톤 (${date})`);
    return {
      price:        String(latest.price),
      change:       change !== null ? String(change) : null,
      change_pct:   changePct,
      date,
      holiday_note: holidayNote,
      source:       'westmetall',
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

// ─── 1순위 실패 시 이메일 알림 (Resend) ──────────────────────────────────────
async function sendFailureAlert(reason) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // 환경변수 없으면 조용히 skip
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'noreply@resend.dev',
        to: 'joseph@a1kor.com',
        subject: '[A1KOR 원자재] ScrapMonster 가격 수집 실패',
        html: `
          <h2>⚠️ ScrapMonster 스크랩 가격 수집 실패</h2>
          <p><b>시각:</b> ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)</p>
          <p><b>원인:</b> ${reason}</p>
          <p>Perplexity 2순위 검색으로 fallback 처리됐습니다.</p>
          <hr/>
          <p style="color:#888;font-size:12px">(주)한국에이원 원자재 인텔리전스 시스템</p>
        `,
      }),
    });
    console.log('[Alert] 실패 알림 이메일 발송 완료');
  } catch (e) {
    console.warn('[Alert] 이메일 발송 실패 (무시):', e.message);
  }
}

async function fetchScrapPrices() {
  // ── 1순위: scrapmonster.com 직접 스크래핑 ────────────────────────────────
  try {
    const res = await fetch('https://www.scrapmonster.com/scrap-prices/category/Aluminum-Scrap/116/1/1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ScrapMonster HTTP ${res.status}`);
    const html = await res.text();

    // ── 미국 가격 (USD/lb → USD/MT 환산) ──────────────────────────────────
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
        usResult[label] = Math.round(pricePerLb * LB_TO_TON);
      }
    }

    // ── 유럽 가격 (USD/MT) ────────────────────────────────────────────────
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

    // ── 중국 가격 (CNY/MT) ────────────────────────────────────────────────
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

    const total = Object.keys(usResult).length + Object.keys(euResult).length + Object.keys(cnResult).length;

    // 파싱 결과가 0개면 구조 변경으로 실패한 것 — 2순위로 fallback
    if (total === 0) throw new Error('파싱 결과 0개 — 사이트 구조 변경 의심');

    console.log(`[ScrapMonster] ✅ 1순위 성공: 총 ${total}개 가격 수집`);
    return { us: usResult, eu: euResult, cn: cnResult, source: 'scrapmonster' };

  } catch (e) {
    console.warn('[ScrapMonster] 1순위 실패:', e.message);
    // 이메일 알림 (fire-and-forget — 메인 흐름 차단 안 함)
    sendFailureAlert(e.message);
  }

  // ── 2순위: Perplexity 검색으로 scrapmonster 기준 가격 수집 ───────────────
  try {
    console.log('[ScrapPrices] 2순위: Perplexity 검색 시도');
    const prompt = `Search for the most recent aluminum scrap prices from scrapmonster.com or equivalent sources.
Return ONLY a JSON object with this exact structure, no other text:
{
  "us": {
    "6063 Extrusions": <number USD/MT or null>,
    "UBC": <number USD/MT or null>,
    "Old Sheet": <number USD/MT or null>,
    "Zorba 90% NF": <number USD/MT or null>,
    "Old Cast": <number USD/MT or null>
  },
  "eu": {
    "Aluminum Cuttings": <number USD/MT or null>,
    "UBC": <number USD/MT or null>,
    "Old Cast": <number USD/MT or null>
  },
  "cn": {
    "6063 Extrusions": <number CNY/MT or null>,
    "UBC": <number CNY/MT or null>,
    "Old Sheet": <number CNY/MT or null>
  }
}
All US/EU prices in USD/MT, CN prices in CNY/MT. Convert from USD/lb if needed (1 lb = 2204.62 MT).`;

    const raw = await callPerplexity(prompt);
    const parsed = parseJSON(raw);
    if (parsed?.us || parsed?.eu || parsed?.cn) {
      console.log('[ScrapPrices] ✅ 2순위 Perplexity 성공');
      return { ...parsed, source: 'perplexity_search' };
    }
    throw new Error('Perplexity 응답 구조 불일치');
  } catch (e) {
    console.warn('[ScrapPrices] 2순위 실패:', e.message);
  }

  // ── 3순위: LME 기반 추정 (완전 fallback) ─────────────────────────────────
  console.warn('[ScrapPrices] 3순위: LME 기반 추정값 사용');
  return null; // null 반환 → 알루미늄 프롬프트에서 Perplexity가 자체 판단
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
    signal: AbortSignal.timeout(55000), // 55초 타임아웃 (maxDuration 60초보다 여유있게)
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

// ─── KST 날짜 헬퍼 ──────────────────────────────────────────────────────────
const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ─── 탭별 프롬프트 ──────────────────────────────────────────────────────────
const PROMPTS = {

  aluminum: `당신은 국내 제강사 구매팀을 위한 비철금속 시황 전문 애널리스트입니다.
오늘 날짜(${getKSTDate()}) 기준 LME 알루미늄 및 스크랩 시황을 아래 JSON 형식으로 작성하세요.

【독자 페르소나】
국내 제강사·주조사 구매팀 담당자. 매일 공급업체 입찰 단가의 시황 적정성을 판단함.
LME, 스크랩 시장 기본 개념 설명 불필요. 필요한 것: 오늘 단가가 왜 이 수준인지, 앞으로 어떻게 될지.

【작성 원칙】
1. 최근 24~48시간 이내 발생한 새 뉴스·이벤트를 먼저 검색하고 그것을 중심으로 작성.
2. 아래 【전일 데이터】와 반드시 비교하여 "어제 대비 달라진 것"을 명확히 서술.
3. 달라진 것이 없으면 "보합세" 명시 후 그 이유(왜 조용한가) + 다음에 주목할 지표 서술.
4. 모든 분석은 구체적 수치·출처·인과관계를 갖출 것. 막연한 서술 금지.
5. LME 가격은 아래 【실시간 수집 데이터】 수치만 사용. 다른 숫자 절대 금지.
6. [1][2] 각주 번호 절대 금지. 한국어 작성.

【지정학·거시경제 — 매일 자율 검색】
"aluminum supply disruption [오늘 날짜]", "LME aluminum inventory latest",
"China aluminum production policy 2026", "global trade tariff aluminum 2026"
→ 알루미늄 수급에 실질 영향 있는 이슈만 반영. 영향 없으면 생략.

{
  "lme": {
    "price": null,
    "change": null,
    "change_pct": null,
    "date": null,
    "lme_verified": "true 또는 false",
    "lme_verify_source": "검증 소스 또는 '확인 불가'",
    "today_summary": "오늘 LME 알루미늄 핵심 한 줄 — 전일 대비 변동폭과 주된 이유를 1문장으로. 예: '전일 대비 -$19(-0.57%) 하락, Alba 생산 재개로 공급 우려 완화'",
    "move_reason": "전일 대비 가격 변동의 원인을 2~3문장으로. 반드시 아래 【전일 데이터】와 비교하여 무엇이 달라졌는지 명시. 수치(톤수, %, USD) 포함. 오늘 발생한 구체적 이벤트(공급업체 발표, 재고 변동, 정책 변화 등) 중심으로 작성. 새 이벤트 없으면 '신규 재료 없이 전일 수준 유지, 시장 관망세' 명시.",
    "market_status": "현재 시장 구조적 상황 2~3문장. LME 재고 톤수(전일 대비 증감 포함), 최근 1주·1개월 가격 추세(수치 명시), 중국 수요·글로벌 수급 현황. 수치 없는 서술 금지.",
    "outlook": "향후 1~2주 방향성 2~3문장. 상승·하락·보합 근거를 구체적 요인으로 설명. 전문가 전망치 있으면 출처와 함께 인용. 다음 주 주목할 이벤트(통계 발표, 정책 결정 등) 있으면 언급."
  },
  "scrap": {
    "weekly_summary": "이번 주 글로벌 알루미늄 스크랩 시장 핵심 3~4문장. 전주 대비 달라진 것 중심으로.",
    "us_premium": "미국 P1020A 프리미엄 최신 분기 발표치 (USc/lb, 분기 명시). 없으면 null",
    "eu_premium": "유럽 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 분기 명시). 없으면 null",
    "japan_premium": "일본 P1020A 프리미엄 최신 분기 발표치 (USD/톤, 분기 명시). 없으면 null",
    "regions": [
      {
        "region": "미국",
        "key_grades": "Zorba, 6063 Extrusions, UBC, Old Sheet, 5052",
        "price_range": "주요 품목 가격 (USD/톤). scrapmonster 기준. 전주 대비 변동 폭 병기. 예: Zorba $1,786/톤(+$12), 6063 $2,227/톤(보합). 절대 null 금지.",
        "price_driver": "이번 주 미국 스크랩 가격 변동 핵심 원인 2문장. 전주 대비 무엇이 달라졌나.",
        "flow": "주요 수출 방향 및 물동량 특이사항.",
        "outlook": "미국 스크랩 단기 가격 전망 1~2문장."
      },
      {
        "region": "유럽",
        "key_grades": "Aluminum Cuttings, UBC, Old Cast, Mixed Turnings",
        "price_range": "주요 품목 가격 (USD/톤). 전주 대비 변동 폭 병기. 절대 null 금지.",
        "price_driver": "이번 주 유럽 스크랩 시장 핵심 변화 2문장.",
        "flow": "아시아·터키 수출 동향.",
        "outlook": "유럽 스크랩 단기 가격 전망 1~2문장."
      },
      {
        "region": "중국",
        "key_grades": "6063 Extrusions, Old Cast, Old Sheet, UBC, Zorba",
        "price_range": "주요 품목 가격 (CNY/톤). 전주 대비 변동 폭 병기. 절대 null 금지.",
        "price_driver": "이번 주 중국 스크랩 수급 핵심 변화 2문장.",
        "flow": "주요 수입국 및 물동량 방향.",
        "outlook": "중국 스크랩 단기 가격 전망 1~2문장."
      },
      {
        "region": "일본",
        "key_grades": "6063 Extrusion Clean, 6063 Extrusion w/attach, Cast Aluminum A, UBC Pressed, UBC Loose, Aluminum Radiator",
        "price_range": "dokindokin.com 오사카 기준 주요 품목 가격 (JPY/톤). 주입 데이터 있으면 그대로 사용. 전주 대비 변동 폭 병기. 절대 null 금지.",
        "price_driver": "이번 주 일본 스크랩 시장 핵심 변화 2문장.",
        "flow": "한국·동남아·인도 수출 현황 및 물동량 특이사항.",
        "outlook": "일본 스크랩 단기 가격 전망 1~2문장."
      }
    ]
  },
  "updated_at": "응답 생성 시각 (ISO 8601)"
}`,

  ferrosilicon: `당신은 국내 제강사 구매팀을 위한 비철금속 시황 전문 애널리스트입니다.
오늘 날짜(${new Date().toISOString().slice(0,10)}) 기준 페로실리콘 75 시황을 아래 JSON 형식으로 작성하세요.

【독자 페르소나】
국내 제강사 구매팀 담당자. 매월 HBIS 입찰가를 기준으로 공급업체 단가 적정성을 판단함.
필요한 것: 이번 달 HBIS 입찰가가 왜 이 수준인지, 전월 대비 무엇이 달라졌는지, 앞으로의 방향.

【절대 규칙】
1. "미확인", "정보 없음", "확인되지 않음", "데이터 부재" 등 모든 불확실 표현 절대 금지.
   → 검색 후 못 찾으면 가장 최근에 알려진 값 또는 업계 구조적 현황으로 반드시 작성.
2. hbis_bid_price: 반드시 숫자 기재. 아래 검색 순서 모두 시도 후에도 없으면
   가장 최근 알려진 값(예: 2026년 1월 CNY 5,760/톤)을 기재하고 "(추정)" 표시.
3. non_china 각 국가의 status, price_context, export_direction: 반드시 실제 내용 작성.
   "미확인" 절대 금지. 알려진 구조적 사실 기반으로 작성.
4. 모든 분석은 구체적 수치·출처·인과관계 포함. 막연한 서술 금지.
5. 각주 번호 절대 금지. 한국어 작성.
6. 【가격 표기】 CNY X,XXX/톤 (USD X,XXX/톤) 형식. 천단위 콤마 필수. "Yuan" 금지.

【HBIS 입찰가 검색 — 반드시 아래 순서로 모두 시도】
1. "HBIS ferrosilicon bidding price 2026"
2. "HBIS ferrosilicon tender price March 2026"
3. "河钢 硅铁 招标价 2026년 3월"
4. mysteel.net "HBIS ferrosilicon"
5. steelorbis.com "HBIS ferrosilicon"
→ 못 찾으면 가장 최근 알려진 값 기재 + "(추정)" 표시. "미확인" 절대 금지.

【추가 검색 필수】
- "ferrosilicon Ningxia spot price 2026" (닝샤 내수가)
- "ferrosilicon FOB Tianjin 2026" (FOB 천진항)
- "ferrosilicon market outlook latest 2026"
- "global steel demand outlook 2026"
- "Elkem Ferroglobe ferrosilicon production 2026"
- "Kazsilicon ferrosilicon export 2026"
→ 현재 이슈가 제련 원가·철강 수요에 영향 준다면 반영.

{
  "china_price": {
    "hbis_bid_price": "HBIS Group 최신 월별 입찰가. CNY/톤 및 USD/톤 병기. 전월 대비 변동폭 포함. 예: 2026년 3월 CNY 5,950/톤 USD 820/톤 (전월比 +CNY 190)",
    "hbis_bid_month": "HBIS 입찰가 기준 연월. 예: 2026-03",
    "hbis_bid_change": "전월 대비 변동. 없으면 null",
    "fob_tianjin_monthly": {
      "2026_01": "FOB 천진항 가격. 없으면 미확인",
      "2026_02": "FOB 천진항 가격. 없으면 미확인",
      "2026_03": "FOB 천진항 가격. 없으면 미확인"
    },
    "fesi75_ningxia": "닝샤 내수 현물가 CNY/톤. 전월 대비 변동폭 포함",
    "date": "기준일 YYYY-MM-DD",
    "change": "전월 대비 변동",
    "today_summary": "이번 달 HBIS 입찰가 핵심 한 줄. 전월 대비 변동폭과 주된 이유. 예: '전월比 +CNY 190 상승, 닝샤 감산 및 입찰 물량 감소가 원인'",
    "china_context": "HBIS 입찰가 전월 대비 변화 이유·배경 3~4문장. 닝샤·내몽골 가동률 변화, 한국·일본·EU 바이어 동향, 에너지 비용 변화 등 구체적 인과관계 포함. 반드시 작성.",
    "china_outlook": "향후 1~3개월 페로실리콘 가격 방향성 2문장. 상승·하락·보합 근거를 구체적 요인으로. 다음 달 입찰에 영향을 줄 변수 포함."
  },
  "china_production": {
    "overall": "닝샤·내몽골 가동률과 전월 대비 변화 이유, 생산량 증감, 수출 물량 변화 4~5문장. 수치 포함. 반드시 작성."
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
  "non_china_context": "비중국 공급 전반 현황 2~3문장. EU CBAM, 카자흐스탄 증설, 러시아 제재 현황. 글로벌 철강 수요 변화가 페로실리콘 수요에 미치는 영향 포함. 반드시 작성.",
  "market_summary": "페로실리콘 시장 종합 브리핑 3~4문장. HBIS 입찰가 수준·방향, 중국 공급 구조, 글로벌 수요 전망, 단기 가격 방향성을 순서대로. 구매팀이 이번 달 입찰 단가 판단에 쓸 수 있는 근거 포함. 반드시 작성.",
  "updated_at": "응답 생성 시각 ISO 8601"
}`,

  recarburizer: `당신은 국내 제강사 구매팀을 위한 원자재 시황 전문 애널리스트입니다.
오늘 날짜(${new Date().toISOString().slice(0,10)}) 기준 가탄제(무연탄 Anthracite) 시황을 아래 JSON 형식으로 작성하세요.

【독자 페르소나】
국내 제강사·주조사 구매팀 담당자. 중국산·러시아산 무연탄 CIF 단가를 공급업체로부터 매월 입찰받음.
필요한 것: 이번 달 CIF 단가가 왜 이 수준인지, 주요 생산국 현황, 앞으로의 방향.

【절대 규칙】
1. "미확인", "정보 없음", "확인되지 않음", "데이터 부재", "수치 없음",
   "파악하기 어렵습니다", "확인할 수 없습니다" 등 모든 불확실 표현 절대 금지.
   → 검색 후 못 찾으면 가장 최근 알려진 값 또는 업계 구조적 현황으로 반드시 작성.
2. 가격 필드(숫자): 반드시 숫자 기재. 못 찾으면 참고 범위 내 추정값 기재.
   중국 FOB 친황다오: 100~180 USD/톤 범위. 러시아 FOB: 80~150 USD/톤 범위.
3. 각 생산국(중국·러시아·기타) status: 반드시 실제 내용 작성. "미확인" 절대 금지.
4. 이 보고서는 반드시 무연탄(Anthracite)만 다룸. 유연탄·열탄·원료탄·갈탄 금지.
5. 각주 번호 절대 금지. 한국어 작성.

【중국 무연탄 가격 검색 — 반드시 아래 순서로 모두 시도】
1. "China anthracite FOB Qinhuangdao price 2026"
2. "Jincheng Lu'an Yangquan anthracite export price 2026"
3. sunsirs.com 무연탄(安泰科) 시세
4. coalspot.com anthracite China 2026
5. steelorbis.com anthracite China 2026
→ 참고 범위: FOB 친황다오 100~180 USD/톤. 못 찾으면 추정값 기재.

【러시아 무연탄 가격 검색 — 반드시 아래 순서로 모두 시도】
1. "SUEK anthracite export price FOB Murmansk 2026"
2. "Russia anthracite Nakhodka FOB price 2026"
3. "Russian anthracite Korea CIF import price 2026"
4. steelorbis.com "Russian anthracite 2026"
→ 참고 범위: FOB 80~150 USD/톤. 못 찾으면 추정값 기재.

【국가별 생산·수출 현황 검색 필수】
- "China anthracite production Shanxi Guizhou 2026"
- "SUEK anthracite production export 2026"
- "Vietnam anthracite export 2026"
- "South Africa anthracite export 2026"
- "anthracite market supply demand 2026 latest"
- "Korea anthracite import 2026 China Russia"

{
  "china_price": {
    "fob_qinhuangdao": "숫자만 USD/톤. 참고범위 100~180. 못 찾으면 추정값 기재",
    "cif_korea": "숫자만 USD/톤. 못 찾으면 fob_qinhuangdao + 운임 $10~15 추정",
    "domestic_shanxi": "숫자만 CNY/톤. 못 찾으면 추정값 기재",
    "calcined_cac_fob": "숫자만 USD/톤. 못 찾으면 null",
    "price_range_text": "fob_qinhuangdao 없을 때만. 형식: '숫자~숫자 USD/MT'. 있으면 null",
    "price_range_source": "가격 기준 출처. 못 찾으면 'FOB 친황다오 시장 추정'",
    "today_summary": "중국 무연탄 핵심 한 줄. 현재 가격 수준과 주된 이유. 예: 'FOB 친황다오 $140~155/MT, 산시성 생산 안정적이나 철강사 수요 소폭 감소'",
    "price_range_note": "최근 중국 무연탄 시장 특이사항 2~3문장. 생산지별 동향, 재고 수준, 수출 경쟁력 포함.",
    "date": "가격 기준일 YYYY-MM-DD",
    "change": "전월 대비 변동. 못 찾으면 '전월 대비 보합 추정'"
  },
  "russia_price": {
    "fob_murmansk": "숫자만 USD/톤. 참고범위 80~150. 못 찾으면 추정값 기재",
    "cif_korea": "숫자만 USD/톤. 못 찾으면 fob + 운임 추정",
    "price_range_text": "fob_murmansk 없을 때만. 형식: '숫자~숫자 USD/MT'. 있으면 null",
    "price_range_source": "가격 기준 출처. 못 찾으면 'FOB 무르만스크 시장 추정'",
    "today_summary": "러시아 무연탄 핵심 한 줄. 현재 가격 수준과 주된 이유. 예: 'FOB $110~125/MT, 중국산 대비 $30 저렴하나 서방 제재로 한국 직수입 제한적'",
    "price_range_note": "러시아 무연탄 시장 특이사항 2~3문장. 제재 현황, 우회 수출 루트, 운임 변화 포함.",
    "date": "가격 기준일 YYYY-MM-DD",
    "change": "전월 대비 변동. 못 찾으면 '전월 대비 보합 추정'",
    "vs_china": "러시아산 vs 중국산 가격 격차 한 줄. 수치 포함. 반드시 작성."
  },
  "producing_countries": [
    {
      "country": "중국",
      "key_producers": "Jincheng Anthracite Mining Group(晋城无烟煤), Lu'an Group(潞안집团), Yangquan Coal(阳泉煤业)",
      "production_status": "산시성·구이저우성 생산 현황, 전월 대비 생산량 변화, 안전 규제 영향, 수출 물량 변화 3~4문장. 수치 포함. 반드시 작성.",
      "export_volume": "한국·일본·인도 수출 현황 및 물량. 반드시 작성.",
      "price_competitiveness": "현재 FOB 친황다오 수준 및 경쟁력 분석. 반드시 작성."
    },
    {
      "country": "러시아",
      "key_producers": "SUEK(시베리아석탄에너지), Raspadskaya, Mechel",
      "production_status": "생산 현황, 서방 제재 영향, 수출 루트 변화(인도·중국 우회), 무르만스크·나호트카 항만 물동량 3~4문장. 반드시 작성.",
      "export_volume": "인도·중국 우회 수출 물량, 한국 직수입 현황. 반드시 작성.",
      "price_competitiveness": "중국산 대비 가격 경쟁력 및 할인폭. 반드시 작성."
    },
    {
      "country": "베트남",
      "key_producers": "Vinacomin(Vietnam National Coal-Mineral Industries Group)",
      "production_status": "생산 현황, 수출 물량 변화, 품질 등급별 현황 2~3문장. 반드시 작성.",
      "export_volume": "한국·일본 수출 현황. 반드시 작성.",
      "price_competitiveness": "중국산 대비 가격 및 품질 경쟁력. 반드시 작성."
    },
    {
      "country": "남아프리카",
      "key_producers": "Exxaro Resources, Universal Coal",
      "production_status": "생산 현황 및 아시아 수출 동향 2문장. 반드시 작성.",
      "export_volume": "아시아·유럽 수출 현황.",
      "price_competitiveness": "중국산 대비 가격 경쟁력."
    }
  ],
  "global_market": {
    "headline": "전세계 무연탄 시장 오늘의 최대 이슈 1문장. 유연탄·열탄 내용 금지.",
    "key_drivers": "글로벌 무연탄 수급 핵심 요인 3~4문장. 중국 생산·수출, 러시아 제재, 한국·일본·인도 수입 동향, 에너지 전환 영향. 수치 포함.",
    "korea_import": "한국 무연탄 수입 현황 2~3문장. 중국산·러시아산·베트남산 비중, 최근 CIF 수준, 수입업체 재고 동향.",
    "outlook": "향후 1~2개월 무연탄 가격 방향성 2~3문장. 상승·하락·보합 근거를 구체적 요인으로. 다음 입찰에 영향을 줄 변수 포함."
  },
  "market_summary": "가탄제 시장 종합 브리핑 3~4문장. 중국산·러시아산 가격 수준과 방향, 주요 생산국 공급 변화, 한국 수입 구조, 단기 가격 전망. 구매팀이 이번 달 입찰 단가 판단에 쓸 수 있는 근거 포함.",
  "updated_at": "응답 생성 시각 ISO 8601"
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
    let prevAluminum = null;
    let prevFerrosilicon = null;
    let prevRecarburizer = null;
    if (tab === 'aluminum') {
      [lmeData, outlookText, scrapPrices, japanScrap, prevAluminum] = await Promise.all([
        fetchLmePrice(),
        fetchAluminumOutlook(),
        fetchScrapPrices(),
        fetchJapanScrapPrices(),
        fetchPrevDayData(token, 'aluminum'),
      ]);
    }
    if (tab === 'ferrosilicon') {
      prevFerrosilicon = await fetchPrevDayData(token, 'ferrosilicon');
    }
    if (tab === 'recarburizer') {
      prevRecarburizer = await fetchPrevDayData(token, 'recarburizer');
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

    // ── 3. Perplexity 호출 — 전일 데이터 + 실시간 데이터 컨텍스트 주입 ──────
    let prompt = PROMPTS[tab];

    // ── 3-0. 전일 캐시 → 비교 컨텍스트 주입 (aluminum / ferrosilicon / recarburizer) ──
    if (tab === 'aluminum' && prevAluminum) {
      const p = prevAluminum.data;
      let prevCtx = `

【전일 데이터 (${prevAluminum.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】
`;
      prevCtx += `전일 LME: ${p.lme?.price ?? 'N/A'} USD/MT (변동: ${p.lme?.change ?? 'N/A'} USD)
`;
      prevCtx += `전일 LME 재고: 별도 확인 필요
`;
      prevCtx += `전일 move_reason 요약: ${p.lme?.today_summary ?? p.lme?.move_reason?.slice(0, 80) ?? 'N/A'}
`;
      prevCtx += `전일 스크랩 요약: ${p.scrap?.weekly_summary?.slice(0, 100) ?? 'N/A'}
`;
      prevCtx += `→ 오늘 위 수치 대비 달라진 것이 있으면 구체적으로 서술. 달라진 것 없으면 "전일 대비 보합" 명시.
`;
      prompt += prevCtx;
    }

    if (tab === 'ferrosilicon' && prevFerrosilicon) {
      const p = prevFerrosilicon.data;
      let prevCtx = `

【전일 데이터 (${prevFerrosilicon.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】
`;
      prevCtx += `전일 HBIS 입찰가: ${p.china_price?.hbis_bid_price ?? 'N/A'} (${p.china_price?.hbis_bid_month ?? ''})
`;
      prevCtx += `전일 닝샤 현물가: ${p.china_price?.fesi75_ningxia ?? 'N/A'}
`;
      prevCtx += `전일 market_summary 요약: ${p.market_summary?.slice(0, 100) ?? 'N/A'}
`;
      prevCtx += `→ 오늘 위 수치 대비 달라진 것이 있으면 구체적으로 서술. 달라진 것 없으면 "전일 대비 보합" 명시.
`;
      prompt += prevCtx;
    }

    if (tab === 'recarburizer' && prevRecarburizer) {
      const p = prevRecarburizer.data;
      let prevCtx = `

【전일 데이터 (${prevRecarburizer.date}) — 반드시 아래 수치와 오늘을 비교하여 달라진 것 서술】
`;
      prevCtx += `전일 중국 FOB: ${p.china_price?.fob_qinhuangdao ?? p.china_price?.price_range_text ?? 'N/A'} USD/MT
`;
      prevCtx += `전일 러시아 FOB: ${p.russia_price?.fob_murmansk ?? p.russia_price?.price_range_text ?? 'N/A'} USD/MT
`;
      prevCtx += `전일 시장 요약: ${p.market_summary?.slice(0, 100) ?? 'N/A'}
`;
      prevCtx += `→ 오늘 위 수치 대비 달라진 것이 있으면 구체적으로 서술. 달라진 것 없으면 "전월 수준 유지" 명시.
`;
      prompt += prevCtx;
    }
    if (tab === 'aluminum') {
      let context = '\n\n【LME 실시간 수집 데이터 — move_reason/market_status 작성 시 반드시 아래 LME 공식 가격만 사용. 다른 출처의 LME 가격 절대 금지】\n';
      // LME 가격을 컨텍스트 최상단에 명시 — Perplexity가 다른 숫자 사용 방지
      if (lmeData) {
        context += `\n[LME Cash Settlement 공식 가격 — westmetall.com 파싱값, 이 숫자만 사용할 것]\n`;
        const fmtPrice = (v) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const priceFormatted = fmtPrice(lmeData.price);
        const changeFormatted = lmeData.change !== null ? `${parseFloat(lmeData.change) >= 0 ? '+' : ''}${fmtPrice(lmeData.change)}` : null;
        context += `현재가: ${priceFormatted} USD/MT\n`;
        if (changeFormatted !== null) context += `전일 대비: ${changeFormatted} USD/MT\n`;
        if (lmeData.change_pct) context += `등락률: ${lmeData.change_pct}\n`;
        context += `기준일: ${lmeData.date}\n`;
        context += `[주의] move_reason 작성 시 반드시 위 ${priceFormatted} USD/MT 숫자를 사용 (천단위 쉼표 포함). 절대로 다른 수치 사용 금지.\n`;
      }
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
        price:        lmeData.price,
        change:       lmeData.change,
        change_pct:   lmeData.change_pct,
        date:         lmeData.date,
        holiday_note: lmeData.holiday_note ?? null,
        source:       lmeData.source,
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
