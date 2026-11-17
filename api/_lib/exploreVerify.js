// api/_lib/exploreVerify.js — 세계 동향 탐색의 결정적 검증(순수 함수). LLM이 찾은 주소·문장과 쓴 글을 코드가 원문과 대조한다.
// 원문을 직접 열어 발행일·인용문을 확인하고, 사실 문장은 근거 문장 번호·숫자 대조(cite.js), 추론 문장은 숫자 금지·추정 표현일 때만 남긴다.
// 리포트와 같은 함수(숫자·단위·위안·게시 게이트 H)를 그대로 쓴다. 규칙은 docs/quality.md "세계 동향 검증".
import { DOMAINS, extractBody, titleSimilarity } from './evidence.js';
import { decodeEntities } from './rss-news.js';
import { pageDate } from './pageDate.js';
import { allowedNumbers, noCny, numbersOk, unitsOk } from './interpret.js';
import { citeCheck, resolveCites } from './cite.js';
import { SEV, sentenceIssues, sentencesOf } from './quality.js';
import { DENY_HOSTS, MARKET_ENUM } from './exploreLenses.js';

export const MAX_AGE_DAYS = 14; // 감산·제재처럼 몇 주 이어지는 사안도 있어 2주. 화면에 발표일을 함께 낸다
const BODY_MIN = 200;
const BODY_MAX = 3000;
// 한 곳 보도만으로 받는 출처 — 정부·국제기구 공식 페이지, 통신사, 본문 수신을 실측한 근거 매체(evidence.js DOMAINS). 그 밖은 다른 사이트 1곳이 더 있어야 한다
const OFFICIAL = /(^|\.)(un\.org|europa\.eu|worldbank\.org|wto\.org|oecd\.org|imf\.org|iea\.org|korea\.kr)$|\.gov(\.[a-z]{2})?$|\.go\.(kr|jp|th|id)$|\.gob\.[a-z]{2}$|\.gouv\.fr$|\.gc\.ca$/;
const WIRE = /(^|\.)(reuters\.com|apnews\.com|bloomberg\.com|afp\.com|ft\.com|wsj\.com|nikkei\.com|bbc\.com|bbc\.co\.uk|yna\.co\.kr|xinhuanet\.com|news\.cn)$/;
const PROMO_TITLE = /market (size|share|report|research|forecast|outlook)|CAGR|市场规模|시장 규모/i;
const bare = (h) => String(h).replace(/^www\./, '');
export const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
export const deniedHost = (h) => DENY_HOSTS.some(d => bare(h) === d || bare(h).endsWith(`.${d}`));
export const trustedHost = (h) => OFFICIAL.test(bare(h)) || WIRE.test(bare(h)) || !!DOMAINS[h] || !!DOMAINS[`www.${bare(h)}`] || !!DOMAINS[bare(h)];
// 같은 회사 사이트의 다른 하위 주소는 "다른 매체"가 아니다 — 끝 두 마디(co.kr 꼴은 세 마디)로 비교
const site = (h) => { const p = bare(h).split('.'); return p.slice(/^(co|com|go|gov|or|ne|ac|org|net)$/.test(p[p.length - 2] ?? '') && p.length > 2 ? -3 : -2).join('.'); };

export const pageText = (html) => decodeEntities(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// LLM이 말한 발행일이 페이지 글에 실제로 적혀 있나 — "2026-11-13"·"2026.11.13"·"2026년 11월 13일"·"2026年11月13日"·"13 November 2026"·"Nov. 13, 2026"
// (공식 공지는 날짜 메타 없이 본문에 영어 날짜만 있는 경우가 있다 — glove-news 2026-11-17 세계보건기구 실측)
export function dateInText(date, text) {
  const [y, m, d] = date.split('-').map(Number);
  const mon = `${MONTHS[m - 1].slice(0, 3)}[a-z]*\\.?`;
  return [`${y}[.\\-/년年 ]+0?${m}[.\\-/월月 ]+0?${d}(?!\\d)`, `(?<!\\d)0?${d}(?:st|nd|rd|th)?\\s+${mon},?\\s+${y}`, `${mon}\\s+0?${d}(?:st|nd|rd|th)?,?\\s+${y}`]
    .some(p => new RegExp(p, 'i').test(text));
}

// 인용문이 원문에 그대로 있는지 — 공백·따옴표 모양·HTML 엔티티 차이만 무시한다
const squash = (s) => String(s)
  .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
export function quoteInBody(quote, body) {
  const q = squash(quote);
  // 중국어·한국어는 20자면 문장 하나다 — 영어 기준과 같게 둔다
  return q.length >= 20 && squash(body).includes(q);
}

/** 주소 하나 검증 — 원문에 인용문이 있고 발행일이 최근인가. searchDate: 검색 색인이 준 날짜(LLM 글 아님)
 * @returns {{ ok: true, host: string, published: string, title: string, body: string } | { ok: false, reason: string }} */
export function checkSource({ url, quote, claimed }, html, { today, searchDate = null }) {
  const fail = (reason) => /** @type {{ ok: false, reason: string }} */ ({ ok: false, reason });
  const host = hostOf(url);
  if (!/^https?:\/\//.test(url ?? '') || !host || /\.pdf($|\?)/i.test(url)) return fail('주소 형식');
  if (deniedHost(host)) return fail(`제외 매체 ${host}`);
  const title = decodeEntities(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ?? /<title[^>]*>([^<]*)/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  if (PROMO_TITLE.test(title)) return fail('시장 규모 홍보 글');
  // 발행일: 페이지 메타 → LLM이 말한 날짜가 페이지에 그 꼴로 있을 때 → 검색 색인 날짜. 셋 다 없으면 버린다
  const meta = pageDate(html, Date.parse(`${today}T23:59:59+09:00`));
  const text = pageText(html);
  const inPage = DATE_RE.test(claimed ?? '') && dateInText(claimed, text) ? claimed : null;
  const published = meta ? kstDate(meta) : inPage ?? (DATE_RE.test(searchDate ?? '') ? searchDate : null);
  if (!published) return fail('발행일 확인 불가');
  const age = days(published, today);
  if (age < -1 || age > MAX_AGE_DAYS) return fail(`발행일 ${published} — 최근 ${MAX_AGE_DAYS}일 아님`);
  if (!quoteInBody(quote, text)) return fail('인용문이 원문에 없음');
  // 본문 — 문단 추출이 짧으면(공식 공지의 낯선 마크업) 인용문 주변 글로
  let body = extractBody(html, null, BODY_MAX);
  if (body.length < BODY_MIN) {
    const at = text.toLowerCase().indexOf(String(quote).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40));
    body = text.slice(Math.max(0, at - 1200), Math.max(0, at - 1200) + BODY_MAX).replace(/([.!?。])\s+/g, '$1\n');
  }
  if (body.length < BODY_MIN) return fail('본문 짧음');
  return { ok: true, host, published, title, body };
}

/** 탐색 결과 한 건 → 근거 기사. pages: 주소 → HTML(못 받았으면 없음), searchDates: 주소 → 색인 날짜 */
export function verifyFound(item, { pages, today, searchDates = {} }) {
  /** @returns {any} */
  const one = (url, quote) => (pages[url] ? checkSource({ url, quote, claimed: item.published }, pages[url], { today, searchDate: searchDates[url] ?? null }) : { ok: false, reason: '원문 열기 실패' });
  const a = one(item.url, item.quote);
  // 첫 주소가 자동 접속을 막으면(로이터 등 — 2026-11-17 운영 첫 실행 탈락 11건 중 5건) 같은 사건의 두 번째 매체를 주 근거로 본다.
  // 두 번째 매체도 똑같이 원문 대조를 통과해야 하고, 공식·통신사·근거 매체가 아니면 한 곳 보도로 탈락 — 기준은 그대로다
  if (!a.ok && a.reason === '원문 열기 실패' && item.second_url) {
    const s = one(item.second_url, item.second_quote);
    if (!s.ok) return { error: `${a.reason} — ${item.url} / 두 번째 ${s.reason}` };
    if (!trustedHost(s.host)) return { error: `한 곳 보도(${s.host}) — 첫 주소 열기 실패 ${item.url}` };
    return { article: { title: s.title, url: item.second_url, source: s.host, published: s.published, body: s.body } };
  }
  if (!a.ok) return { error: `${a.reason} — ${item.url}` };
  if (!trustedHost(a.host)) {
    const b = item.second_url ? one(item.second_url, item.second_quote) : { ok: false, reason: '두 번째 매체 없음' };
    if (!b.ok) return { error: `한 곳 보도(${a.host}) — ${b.reason}` };
    if (site(b.host) === site(a.host)) return { error: `두 번째 매체가 같은 사이트(${a.host})` };
  }
  return { article: { title: a.title, url: item.url, source: a.host, published: a.published, body: a.body } };
}

// 같은 사건의 중복 보도는 먼저 온 것만
export const dedupeArticles = (arts) => arts.filter((a, i) => !arts.slice(0, i).some(b => b.url === a.url || titleSimilarity(a.title, b.title) >= 0.5));

// ─── 숫자 ───────────────────────────────────────────────────────────────────
// "1만1000명"·"450만 톤"·"1억4000만 달러" — 기존 숫자 대조(numbersOk·cite)는 "1"·"1000"으로 따로 보아 느슨하게 통과시킨다(glove-news 2026-11-17).
// 만·억·천이 붙은 수는 풀어 쓴 값이 인용 문장에 그 값으로 적혀 있을 때만 받는다. 원문이 万·亿·만·억으로 쓴 수는 풀어서 비교하고,
// 영어 million·billion을 만·억으로 바꾼 수(45 million → 4,500만)는 환산이라 받지 않는다(사용자 지시 2026-11-17).
const UNIT_VAL = { 천: 1e3, 만: 1e4, 억: 1e8, 千: 1e3, 万: 1e4, 亿: 1e8, 萬: 1e4, 億: 1e8 };
const num = (s) => Number(String(s).replace(/,/g, ''));
// 문장 속 만·억 단위 수의 값 목록. 이어 붙은 꼴("1억4000만", "1만1000")은 한 수로 합친다
function unitNumbers(s, units) {
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s?([${units}])`, 'g');
  const toks = [...String(s).matchAll(re)].map(m => ({ at: m.index, end: m.index + m[0].length, v: num(m[1]) * UNIT_VAL[m[2]], unit: UNIT_VAL[m[2]] }));
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    let { v, end, unit } = toks[i];
    while (toks[i + 1] && toks[i + 1].at - end <= 1 && toks[i + 1].unit < unit) { i++; v += toks[i].v; end = toks[i].end; unit = toks[i].unit; }
    // 끝에 붙은 작은 수("1만1000"의 1000) — 뒤에 또 단위·%·날짜가 오지 않을 때만
    const tail = /^\s?(\d[\d,]*)(?![\d.]|\s?(?:[천만억千万亿萬億%년월일개곳주차]))/.exec(String(s).slice(end));
    if (tail && num(tail[1]) < unit) v += num(tail[1]);
    out.push(String(Math.round(v)));
  }
  return out;
}
const plainNumbers = (s) => [...String(s).matchAll(/\d{1,3}(?:[.,   ]\d{3})+(?!\d)|\d+/g)].map(m => m[0].replace(/\D/g, ''));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCALE_SRC = { 백만: '(?:million|mln|mn|m\\b|mt\\b|百万)', 십억: '(?:billion|bn|bln|十亿)' };
/** 만·억·천 단위 수와 "백만·십억" 수가 인용 문장에 같은 값·같은 규모로 있나 (순수 함수) */
export function koNumbersBacked(text, cite, articles) {
  const sents = (resolveCites(cite, articles) ?? []).map(r => r.sentence);
  const need = unitNumbers(text, '천만억');
  if (need.length) {
    const have = new Set(sents.flatMap(s => [...plainNumbers(s), ...unitNumbers(s, '천만억千万亿萬億')]));
    if (!need.every(n => have.has(n))) return false;
  }
  // "45백만 톤" — 1~2자리 수는 기존 대조가 보지 않는다. 같은 수가 million·Mt·百万과 함께 인용 문장에 있어야 한다
  for (const m of String(text).matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(백만|십억)/g)) {
    const re = new RegExp(`(?<![\\d.])${esc(m[1].replace(/,/g, ''))}\\s?${SCALE_SRC[m[2]]}`, 'i');
    if (!sents.some(s => re.test(s.replace(/(\d),(?=\d{3})/g, '$1')))) return false;
  }
  return true;
}
// 단위가 붙은 1~2자리 수("30%", "톤당 80달러") — 기존 대조(cite·numbersOk)는 1~2자리 수를 날짜·개수로 보고 넘긴다. 사실 문장에서는
// 같은 수가 인용 문장에 있어야 한다(30%를 40%로 바꿔도 통과하던 빈틈, 2026-11-17 테스트에서 확인)
const norm = (s) => s.replace(/,/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
export function smallNumbersBacked(text, cite, articles) {
  const need = [...String(text).matchAll(/(?<![\d.,])(\d{1,2}(?:\.\d+)?)\s?(%|퍼센트|포인트|달러|원|톤|kg|배럴)/g)].map(m => norm(m[1]));
  if (!need.length) return true;
  const have = new Set((resolveCites(cite, articles) ?? []).flatMap(r => (r.sentence.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(norm)));
  return need.every(n => have.has(n));
}

// 추론 문장의 숫자 — 기간 표현("1~2주", "3개월", "2027년")만 허용
export const hasNumber = (s) => /\d/.test(String(s).replace(/\d+\s*~\s*\d+\s*주|\d+\s*(주|개월|월|일|분기|년)/g, ''));
// "11월 3일 … 앞둔/앞두고/예정" — 그 날이 기준일 전이면 지난 일을 예고처럼 쓴 것(glove-news 2026-11-05 선거)
const DATED_AHEAD = /(\d{1,2})월\s*(\d{1,2})일[^.]{0,30}?(앞둔|앞두고|예정|열릴|발표될)/g;
export function pastDateAhead(s, today) {
  const y = Number(today.slice(0, 4));
  return [...String(s).matchAll(DATED_AHEAD)].some(([, mm, dd]) => `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` < today);
}
// 구매 행동 지시 — 독자는 기간별 입찰로 사므로 매수 타이밍을 쓰지 않는다(2026-10-03 사용자 확정). 리포트는 프롬프트로만 막고 있어 여기서 코드로 막는다
const BUY_ADVICE = /즉시\s*(발주|매입|구매)|선(발주|매입|구매)|분할\s*(발주|매입|구매)|재고(를)?\s*(확보|늘리|비축)|지금\s*사|구매\s*(유리|불리|적기|시점)|매수\s*(권고|추천|타이밍|시점)|매도\s*(권고|추천)/;
export const noBuyAdvice = (t) => !BUY_ADVICE.test(String(t));
// "모른다" 문장 — 확인되지 않음·근거 없음 같은 정보 없는 문장(2026-10-03 사용자 지시). "불확실하다"는 전망 판단이라 대상이 아니다
const UNKNOWN = /확인되지\s?않|확인할 수 없|확인된 (바|것)(가|은)? 없|근거[가는를]?[^.。]{0,15}없|(기사|자료|입력)(에서는?|에는?) 없|알 수 없|알려지지 않|파악되지 않|밝혀지지 않|언급(이|은)? 없|언급되지 않|나오지 않았|드러나지 않|(직접|바로) 이어지는 경로|경로가 (확인|보이)|(관련|연관)(성)?(이|은)? 없|(자료|정보|데이터)(가|는)? 없/;
// 달러 표기 통일(S2) — "US$1,200"·"$1,200"·"1,200 USD" → "1,200달러". 값은 그대로라 결정적으로 바꿔도 사실이 달라지지 않는다
export const localizeUsd = (s) => String(s)
  .replace(/(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)(\s?(?:백만|십억|만|억))?/g, (m, n, sc) => `${n}${(sc ?? '').trim()}달러`)
  .replace(/(\d[\d,]*(?:\.\d+)?)\s?USD\b/g, '$1달러').replace(/USD\s?\/\s?/g, '달러/').replace(/\bUSD\b/g, '달러')
  // 영어 무게 단위(2026-11-17 운영 첫 실행 "999,000 mt") — mt는 톤, Mt는 백만 톤(숫자 대조는 원문의 Mt와 맞는다)
  .replace(/(\d)\s?Mt\b/g, '$1백만 톤').replace(/(\d)\s?(?:mt|tonnes|tons)\b/gi, '$1톤');

const HEDGE = /전망|보인다|예상|가능성|여지|것으로|수 있/;
const KO = /[가-힣]{2,}/;
const clean = (s) => localizeUsd(String(s ?? '').trim());
const ENUM = { category: ['demand', 'supply', 'policy', 'logistics', 'other'], effect: ['up', 'down', 'unclear'], scale: ['large', 'medium', 'small'] };
const SCALE_RANK = { large: 0, medium: 1, small: 2 };

/** 작성 출력 검증 — 통과한 사안만. ctx: 게시 게이트 문맥(quality.auditContext), input: 작성 입력 전문(숫자·단위 대조용)
 * @returns {{ issues: any[], dropped: string[] }} */
export function sanitizeIssues(json, { articles, input, today, ctx }) {
  const allowed = allowedNumbers(input);
  const dropped = [];
  const gateH = (s, where) => sentenceIssues(s, where, ctx).some(id => SEV[id] === 'H');
  const common = (s, where) => {
    const why = !KO.test(s) ? '한국어 아님' : UNKNOWN.test(s) ? '모른다는 문장' : !noCny(s) ? '위안 표기' : !noBuyAdvice(s) ? '구매 지시'
      : pastDateAhead(s, today) ? '지난 날짜 예고' : gateH(s, where) ? '게시 게이트' : null;
    if (why) dropped.push(`${where}: ${why} — ${s.slice(0, 70)}`);
    return !why;
  };
  const infer = (text, where, needHedge) => sentencesOf(clean(text)).filter((s) => {
    if (!common(s, where)) return false;
    const why = hasNumber(s) ? '추론 문장에 숫자' : needHedge && !HEDGE.test(s) ? '추정 표현 아님' : null;
    if (why) dropped.push(`${where}: ${why} — ${s.slice(0, 70)}`);
    return !why;
  }).slice(0, 2).join(' ');

  const issues = [];
  (json?.issues ?? []).forEach((it, i) => {
    const w = `world.issues[${i}]`;
    // 낯선 출력 하나가 던져도 나머지 사안은 계속 — 그 사안만 탈락
    try {
      const a = articles[Number(it.article) - 1];
      if (!a) { dropped.push(`${w}: 없는 기사 번호 ${it.article}`); return; }
      if (issues.some(x => x.url === a.url)) { dropped.push(`${w}: 같은 기사 중복`); return; }
      const title = clean(it.title);
      if (!common(title, `${w}.title`) || !numbersOk(title, allowed) || !unitsOk(title, input) || hasNumber(title) && !koNumbersBacked(title, [String(it.article)], articles)) {
        dropped.push(`${w}: 제목 탈락 — ${title.slice(0, 50)}`); return;
      }
      const what = (it.what ?? []).map(x => ({ text: clean(x?.text), cite: x?.cite ?? [] })).filter(({ text, cite }) => {
        if (!text || !common(text, `${w}.what`)) return false;
        const c = citeCheck(text, cite, { articles, codeNumbers: new Set(), requireCite: true });
        const why = c.ok === false ? c.reason : !c.articles.includes(Number(it.article)) ? '다른 기사 인용' : !koNumbersBacked(text, cite, articles) ? '만·억·백만 단위 수가 인용 문장에 없음'
          : !smallNumbersBacked(text, cite, articles) ? '단위 붙은 작은 수가 인용 문장에 없음'
          : !numbersOk(text, allowed) ? '입력에 없는 숫자' : !unitsOk(text, input) ? '단위 다름' : null;
        if (why) dropped.push(`${w}.what: ${why} — ${text.slice(0, 70)}`);
        return !why;
      }).map(x => x.text).slice(0, 4);
      const relation = infer(it.relation, `${w}.relation`, false), reach = infer(it.reach, `${w}.reach`, true), outlook = infer(it.outlook, `${w}.outlook`, true);
      if (!what.length) { dropped.push(`${w}: 사실 문장 없음 — ${title}`); return; }
      if (!relation && !reach && !outlook) { dropped.push(`${w}: 분석 문장 없음 — ${title}`); return; }
      const pick = (k, d) => (ENUM[k].includes(it[k]) ? it[k] : d);
      const uses = clean(it.uses);
      issues.push({
        title, region: clean(it.region).slice(0, 20), category: pick('category', 'other'), effect: pick('effect', 'unclear'), scale: pick('scale', 'small'),
        markets: [...new Set((it.markets ?? []).filter(m => MARKET_ENUM.includes(m)))],
        // 용도 칸도 화면에 나간다 — 숫자·위안이 들면 비운다
        uses: !hasNumber(uses) && noCny(uses) ? uses.slice(0, 30) : '',
        published: a.published, what, relation, reach, outlook, url: a.url, source: a.source, src_title: a.title,
      });
    } catch (e) {
      dropped.push(`${w}: 검증 중 오류(${String(e.message).slice(0, 80)})`);
    }
  });
  issues.sort((x, y) => (SCALE_RANK[x.scale] - SCALE_RANK[y.scale]) || y.published.localeCompare(x.published));
  return { issues, dropped };
}

// 어제도 다룬 사안이면 처음 본 날짜를 이어 받는다 — 화면의 "N일째"
export function carryFirstSeen(issues, previous, today) {
  return issues.map((it) => {
    const old = (previous ?? []).find(p => p.url === it.url || titleSimilarity(p.src_title ?? '', it.src_title ?? '') >= 0.6);
    return { ...it, first_seen: old?.first_seen ?? today };
  });
}
