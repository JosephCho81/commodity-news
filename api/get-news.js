// api/get-news.js — 비철금속 원자재 인텔리전스 API
// 탭: aluminum | ferrosilicon | recarburizer | summary

export const config = { maxDuration: 60 };

import {
  FIREBASE_ENABLED,
  getFirestoreToken,
  saveToFirestore,
  getFromFirestore,
  fetchPrevDayData,
} from './lib/firebase.js';

import { getLmeHolidayNote } from './lib/uk-holidays.js';
import { getAluminumPrompt } from './prompts/aluminum.js';
import { getFerrosiliconPrompt } from './prompts/ferrosilicon.js';
import { getRecarburizerPrompt } from './prompts/recarburizer.js';
import { getSummaryPrompt } from './prompts/summary.js';

// ─── 환경변수 ───────────────────────────────────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

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

// ─── 탭별 프롬프트 (요청 시점 날짜로 생성) ──────────────────────────────────
const PROMPTS = (() => {
  const date = getKSTDate();
  return {
    aluminum:     getAluminumPrompt(date),
    ferrosilicon: getFerrosiliconPrompt(date),
    recarburizer: getRecarburizerPrompt(date),
    summary:      getSummaryPrompt(date),
  };
})()


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
