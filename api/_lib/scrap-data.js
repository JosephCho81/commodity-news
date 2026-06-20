// api/_lib/scrap-data.js — 알루미늄 라이브 가격 수집 (recycleinme 미국·dokindokin 일본·검색 스크랩 등급)

import { callPerplexity, parseJSON } from './perplexity.js';

const LB_TO_TON = 2204.62;

// ─── 미국·중국 스크랩 등급별 현재 시세 (검색, 호출부에서 LME 정합 검증) ────────
// 무료 결정적 등급별 도매 소스가 없어 검색으로 수집하되, 호출부가 LME 밴드로 비현실값 제거.
// 미국 USD/MT, 중국 CNY/MT.
export async function fetchScrapGradesViaSearch() {
  try {
    const prompt = `Find the CURRENT (this week) wholesale aluminium scrap prices for the United States and China. Use the latest market/trade quotes — NOT consumer scrap-yard buying prices.
US prices in USD per metric tonne. China prices in CNY per metric tonne.
Grades: UBC (used beverage cans), 6063 extrusion, Old Cast, Old Sheet.
Context for sanity: LME aluminium cash is ~USD 2,500-2,800/MT; clean aluminium scrap trades at roughly 55-90% of LME.
Return ONLY this JSON, no prose (null if a current figure is unavailable):
{
  "us": { "UBC": <USD/MT|null>, "6063 Extrusion": <USD/MT|null>, "Old Cast": <USD/MT|null>, "Old Sheet": <USD/MT|null> },
  "cn": { "UBC": <CNY/MT|null>, "6063 Extrusion": <CNY/MT|null>, "Old Cast": <CNY/MT|null> }
}
If a source quotes USD/lb, multiply by 2204.62.`;
    const parsed = parseJSON(await callPerplexity(prompt));
    if (parsed?.us || parsed?.cn) {
      console.log('[ScrapGrades] ✅ 검색 성공');
      return parsed;
    }
  } catch (e) {
    console.warn('[ScrapGrades] 검색 실패:', e.message);
  }
  return null;
}

// ─── 미국 알루미늄 거래가 (recycleinme.com, 라이브) ──────────────────────────
// recycleinme는 Inertia(data-page에 JSON 내장) — 헤드리스 불필요.
// "US Metal Prices/Aluminum" = Trading Price(거래가, 도매급). USD/Lb → USD/MT.
// scrapmonster 무료는 전 지역 3개월 지연이라 미국은 이쪽 라이브로 대체.
export async function fetchUsAluminumPrice() {
  try {
    const res = await fetch('https://www.recycleinme.com/freepricedetailedlisting/US%20Metal%20Prices/Aluminum/6', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`recycleinme HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(/data-page="((?:[^"]|&quot;)*)"/);
    if (!m) throw new Error('data-page 미발견');
    const json = JSON.parse(
      m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    );
    const series = json?.props?.marketpricegraph_value;
    if (!Array.isArray(series) || series.length === 0) throw new Error('가격 시리즈 없음');
    const latest = series.find(x => String(x.Latest) === '1') ?? series[series.length - 1];
    const perLb = parseFloat(latest.closePrice);
    if (!(perLb > 0)) throw new Error('가격 파싱 실패');
    const date = (latest.Dat || '').slice(0, 10) || null;
    const usdPerMt = Math.round(perLb * LB_TO_TON);
    console.log(`[recycleinme] ✅ 미국 알루미늄 거래가 $${perLb}/lb → $${usdPerMt}/MT (${date})`);
    return { usd_per_mt: usdPerMt, per_lb: perLb, date, source: 'recycleinme' };
  } catch (e) {
    console.warn('[recycleinme] 미국 알루미늄 가격 실패:', e.message);
    return null;
  }
}

// ─── 일본 알루미늄 스크랩 가격 fetch (dokindokin.com - 오사카 스크랩 업체) ──────
// 【440000円/㌧(税込)】 패턴으로 직접 톤당 가격 파싱
export async function fetchJapanScrapPrices() {
  try {
    const res = await fetch('https://www.dokindokin.com/scrap_type/aluminum/', {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`dokindokin HTTP ${res.status}`);
    const html = await res.text();

    // 날짜 추출: "2026年06月20日現在" — 年月日 리터럴로 고정(와일드카드는 숫자열 오매칭됨)
    const dateMatch = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
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
