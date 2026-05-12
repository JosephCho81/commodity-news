// api/lib/firebase.js — Firebase JWT / Firestore 헬퍼

// ─── 환경변수 ───────────────────────────────────────────────────────────────
const FIREBASE_PROJECT_ID   = process.env.FIREBASE_PROJECT_ID;
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
    const b64 = key.replace(/\s/g, '');
    const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    key = `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
  }

  // Step 4: 헤더/푸터 사이 줄바꿈 정규화
  key = key
    .replace(/(-----BEGIN[^-]+-----)([^\n])/g, '$1\n$2')
    .replace(/([^\n])(-----END[^-]+-----)/g, '$1\n$2');

  return key;
}

const FIREBASE_PRIVATE_KEY = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

const KEY_VALID =
  FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY') &&
  FIREBASE_PRIVATE_KEY.length > 200;

export const FIREBASE_ENABLED = !!(
  FIREBASE_PROJECT_ID &&
  FIREBASE_CLIENT_EMAIL &&
  KEY_VALID
);

// ─── 진단 로그 ───────────────────────────────────────────────────────────────
console.log(`[Firebase] ENABLED:${FIREBASE_ENABLED} PROJECT:${FIREBASE_PROJECT_ID ?? '❌'}`);

// ─── JWT / Firestore 헬퍼 ──────────────────────────────────────────────────
let _token = null;
let _tokenExp = 0;

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

export async function getFirestoreToken() {
  if (_token && Date.now() < _tokenExp - 60_000) return _token;

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
  _token = data.access_token;
  _tokenExp = (now + 3600) * 1000;
  console.log('[Firebase] ✅ 토큰 발급 성공');
  return _token;
}

export async function saveToFirestore(token, collection, docId, data) {
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

export async function getFromFirestore(token, collection, docId) {
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

export async function fetchPrevDayData(token, tab) {
  if (!token) return null;
  try {
    const days = [1, 2, 3].map(i =>
      new Date(Date.now() + 9 * 60 * 60 * 1000 - i * 86400000).toISOString().slice(0, 10)
    );
    const docs = await Promise.all(
      days.map(d => getFromFirestore(token, 'commodity_cache', `${tab}_${d}`).catch(() => null))
    );
    const idx = docs.findIndex(doc => doc?.data);
    if (idx === -1) return null;
    console.log(`[PrevDay] ${tab} 전일 데이터 로드: ${days[idx]}`);
    return { date: days[idx], data: JSON.parse(docs[idx].data) };
  } catch (e) {
    console.warn('[PrevDay] 전일 데이터 로드 실패:', e.message);
  }
  return null;
}
