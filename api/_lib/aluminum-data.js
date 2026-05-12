// api/lib/aluminum-data.js — 알루미늄 탭 전용 실시간 데이터 수집
// LME 가격, 전망 텍스트, 스크랩 가격(미국/유럽/중국), 일본 스크랩 가격

import { getLmeHolidayNote } from './uk-holidays.js';
import { callPerplexity, parseJSON } from './perplexity.js';

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

// ─── LME 알루미늄 Cash-Settlement 가격 fetch (westmetall.com) ──────────────
// 소스: https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash
// westmetall.com은 독일 금속거래 회사가 운영하며 LME Cash-Settlement를 텍스트로 게시.
// LME 공식 Cash Bid와 0.5 USD 이내 일치 확인됨.
export async function fetchLmePrice() {
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
export async function fetchAluminumOutlook() {
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
// 미국: USD/lb × 2204.62 = USD/톤 / 유럽: USD/톤 / 중국: CNY/톤
export async function fetchScrapPrices() {
  // ── 1순위: scrapmonster.com 직접 스크래핑 ────────────────────────────────
  try {
    const res = await fetch('https://www.scrapmonster.com/scrap-prices/category/Aluminum-Scrap/116/1/1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
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
export async function fetchJapanScrapPrices() {
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

    // 일반 패턴: 【숫자円/㌧】 전체 HTML에서 순서대로 추출
    // 순서: 上, 下, ガラA, ガラB, 缶プレス, 缶, ラジエーター
    const tonPattern = /【(\d+)円\/㌧/g;
    const allTonPrices = [];
    let m;
    while ((m = tonPattern.exec(html)) !== null) {
      allTonPrices.push(parseInt(m[1], 10));
    }

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
