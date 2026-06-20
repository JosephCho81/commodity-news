// api/_lib/scrap-data.js — 알루미늄 스크랩 가격 직접 수집 (scrapmonster·dokindokin)

import { callPerplexity, parseJSON } from './perplexity.js';
import { sendFailureAlert } from './alert.js';

const LB_TO_TON = 2204.62;

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

    // 갱신지연(stale) 감지: 해당 지역 섹션에 변동 스팬(priceup/pricedown)이 전혀 없으면
    // 시세가 멈춘 동결 데이터(예: scrapmonster 유럽 표). 숨기지 않고 실시간 검색값으로 교체.
    const isStale = (title) => {
      const i = html.indexOf(title);
      if (i === -1) return false;
      return !/price(up|down)/.test(html.slice(i, i + 4000));
    };
    const regions = { us: usResult, eu: euResult, cn: cnResult };
    const stale = {
      us: isStale('United States Aluminum Scrap'),
      eu: isStale('Europe Aluminum Scrap'),
      cn: isStale('China Aluminum Scrap'),
    };
    const region_source = { us: 'scrapmonster', eu: 'scrapmonster', cn: 'scrapmonster' };

    const staleRegions = Object.keys(regions).filter(r => stale[r] && Object.keys(regions[r]).length > 0);
    if (staleRegions.length > 0) {
      console.warn(`[ScrapMonster] 갱신지연(stale) 지역: ${staleRegions.join(',')} — 실시간 검색으로 교체 시도`);
      const fresh = await fetchScrapPricesViaSearch().catch(() => null);
      // 양수 값만 추림 — Perplexity가 못 찾은 등급(null)으로 기존 값을 덮어쓰지 않게.
      const cleanPos = (obj) => {
        const out = {};
        for (const [k, v] of Object.entries(obj ?? {})) {
          const n = Number(String(v).replace(/,/g, ''));
          if (Number.isFinite(n) && n > 0) out[k] = n;
        }
        return out;
      };
      for (const r of staleRegions) {
        const freshClean = cleanPos(fresh?.[r]);
        const nFresh = Object.keys(freshClean).length;
        if (nFresh > 0) {
          // 머지: 스크랩몬스터 등급은 유지하고 신선값만 덮어쓴다(등급 유실 방지).
          const staleGrades = Object.keys(regions[r]).filter(k => !(k in freshClean));
          regions[r] = { ...regions[r], ...freshClean };
          region_source[r] = 'scrapmonster+perplexity';
          // 신선값으로 덮이지 않고 스크랩몬스터(동결)에 남은 등급이 있으면 여전히 갱신지연 표기.
          stale[r] = staleGrades.length > 0;
          console.log(`[ScrapMonster] ${r} 머지 갱신: 신선 ${nFresh}개 덮음, 동결잔존 ${staleGrades.length}개`);
        } else {
          console.warn(`[ScrapMonster] ${r} 실시간 교체 실패 — 갱신지연 표시로 유지`);
        }
      }
    }

    console.log(`[ScrapMonster] ✅ 1순위 성공: 총 ${total}개 (stale=${JSON.stringify(stale)})`);
    return { ...regions, source: 'scrapmonster', stale, region_source };

  } catch (e) {
    console.warn('[ScrapMonster] 1순위 실패:', e.message);
    // 이메일 알림 (fire-and-forget — 메인 흐름 차단 안 함)
    sendFailureAlert('ScrapMonster 가격 수집 실패', e.message, 'Perplexity 2순위 검색으로 fallback 처리됐습니다.');
  }

  // ── 2순위: 전체 실패 시 Perplexity 검색으로 대체 ─────────────────────────
  try {
    const parsed = await fetchScrapPricesViaSearch();
    return { ...parsed, source: 'perplexity_search', stale: { us: false, eu: false, cn: false } };
  } catch (e) {
    console.warn('[ScrapPrices] 2순위 실패:', e.message);
  }

  // ── 3순위: 완전 실패 → null (NULL 원칙, 추정값 만들지 않음) ───────────────
  console.warn('[ScrapPrices] 전체 실패 — null 반환');
  return null;
}

// 실시간 검색으로 현재 스크랩 시세 수집 (stale 지역 교체 + 전체 fallback 겸용).
// "가격이 오르고 있다"는 상승 국면을 반영하도록 항상 '가장 최근' 시세를 요구.
async function fetchScrapPricesViaSearch() {
  console.log('[ScrapPrices] 실시간 Perplexity 검색 시도');
  const prompt = `You are a metals price researcher. Find the CURRENT (this week) European aluminium scrap prices in USD per metric tonne. Search UK/EU sources (e.g. letsrecycle.com, scrapmonster Europe, EUROMETAL, Davis Index, Fastmarkets summaries, recycling trade press) and cross-check.

Context for sanity: LME aluminium cash is roughly USD 2,500-2,800/MT. Clean European aluminium scrap grades trade at a large fraction of LME — UBC typically ~70-85% of LME (≈ USD 1,800-2,300/MT), clean cuttings/extrusions near or above UBC, old cast somewhat lower. A UBC figure near USD 1,200/MT is almost certainly STALE — do NOT report stale figures; find the latest.

Return ONLY this JSON (no prose). Every value in USD/MT. Use null only if you truly cannot find a current figure:
{
  "eu": {
    "UBC": <USD/MT or null>,
    "Aluminum Cuttings": <USD/MT or null>,
    "Old Cast": <USD/MT or null>,
    "6063 Extrusions": <USD/MT or null>
  },
  "us": {
    "UBC": <USD/MT or null>,
    "6063 Extrusions": <USD/MT or null>,
    "Old Sheet": <USD/MT or null>,
    "Zorba 90% NF": <USD/MT or null>,
    "Old Cast": <USD/MT or null>
  },
  "cn": {
    "UBC": <CNY/MT or null>,
    "6063 Extrusions": <CNY/MT or null>,
    "Old Sheet": <CNY/MT or null>
  }
}
US/EU in USD/MT, CN in CNY/MT. If a source quotes USD/lb, multiply by 2204.62.`;

  const raw = await callPerplexity(prompt);
  const parsed = parseJSON(raw);
  if (parsed?.us || parsed?.eu || parsed?.cn) {
    console.log('[ScrapPrices] ✅ Perplexity 검색 성공');
    return parsed;
  }
  throw new Error('Perplexity 응답 구조 불일치');
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
