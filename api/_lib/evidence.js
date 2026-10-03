// api/_lib/evidence.js — 시장별 근거 묶음 수집 (2단계: 신뢰 소스 화이트리스트 + 코드 필터)
// 원칙: 출처·날짜·URL은 원본 메타 그대로(LLM 미경유). 화이트리스트 밖 매체·제목 무관 기사·오래된 기사는 버린다.
// 해석(3단계)은 여기서 모은 본문만 근거로 쓴다.

import { parseRssItems, decodeEntities } from './rss-news.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const MAX_AGE_H = 72;          // 주말 직후에도 직전 거래일 리포트가 들어오도록
const WIDE_AGE_H = 168;        // 중국 연휴 등으로 72시간 안에 2건도 없으면 7일까지 넓힌다(날짜는 화면에 그대로 표시)
const PER_MARKET = 6;
const PER_DOMAIN = 3;
const BODY_MAX = 1800;
const BODY_MIN = 150;          // 이보다 짧으면 제목·첫 문단뿐인 기사 — 근거로 쓰지 않는다 (국내 단신은 150~400자로 완결)
const FOCUS_MIN = 60;            // 중국어 발췌는 글자당 정보량이 커서 60자로도 수치 2~3개가 들어간다
const BODY_HITS_MIN = 3;       // 종합 리포트가 이 품목 근거가 되려면 본문에 품목어가 3번 이상

const GN_LOCALE = {
  zh: 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  en: 'hl=en-US&gl=US&ceid=US:en',
};

// 본문을 받을 수 있는 매체만 (2026-10-03 본문 확보 확인). titleOnly는 제목만 쓰는 유료 매체.
export const DOMAINS = {
  'finance.sina.com.cn': { name: '신랑재경', body: /id="artibody"/ },
  'finance.sina.cn': { name: '신랑재경', body: /class="[^"]*art_content[^"]*"/ },
  'news.mysteel.com': { name: '마이스틸', body: /id="text"/ },
  'www.alcircle.com': { name: 'AL Circle' },
  'news.metal.com': { name: 'SMM' },
  'aluminiumtoday.com': { name: 'Aluminium Today', body: /class="[^"]*article-body[^"]*"/ },
  'en.portnews.ru': { name: 'PortNews' },
  'www.themoscowtimes.com': { name: 'Moscow Times' },
  'gmk.center': { name: 'GMK Center' },
  'www.steeldaily.co.kr': { name: '스틸데일리', body: /id="article-view-content-div"/ },
  'www.ferrotimes.com': { name: '페로타임즈', body: /id="article-view-content-div"/ },
  'www.snmnews.com': { name: '철강금속신문', titleOnly: true },
};

const KR_FEEDS = [
  { name: '스틸데일리', url: 'https://www.steeldaily.co.kr/rss/allArticle.xml' },
  { name: '페로타임즈', url: 'https://www.ferrotimes.com/rss/allArticle.xml' },
  { name: '철강금속신문', url: 'https://www.snmnews.com/rss/allArticle.xml' },
];

// title: 제목에 있으면 바로 관련 기사. body: 제목에 품목명이 없는 종합 리포트를 본문으로 판정할 때 쓰는 품목어.
export const MARKETS = {
  ferro: {
    gn: [['zh', '硅铁'], ['zh', '锰硅'], ['zh', '铁合金']],
    title: /硅铁|锰硅|硅锰|铁合金|双硅|锰矿|ferro|silico|mangan|합금철|페로실리콘|실리콘망간|실리망간|페로망간|망간/i,
    body: /硅铁|锰硅|硅锰|铁合金|双硅|锰矿|ferrosilicon|silicomanganese|합금철|페로실리콘|실리콘망간/gi,
  },
  al1: {
    gn: [['en', 'aluminium price'], ['zh', '沪铝']],
    title: /alumin|沪铝|电解铝|铝锭|铝价|알루미늄/i,
    body: /alumin|沪铝|电解铝|铝锭|铝价|알루미늄/gi,
  },
  al2: {
    gn: [['en', 'aluminium scrap'], ['en', 'ADC12'], ['zh', '再生铝']],
    // 철스크랩 기사가 섞이지 않게 알루미늄 단어와 함께일 때만
    title: /(alumin.*(scrap|secondary|recycl|alloy))|((scrap|secondary|recycl).*alumin)|ADC12|再生铝|废铝|铝合金|알루미늄 ?스크랩|드로스|탈산제/i,
    body: /aluminium scrap|aluminum scrap|ADC12|secondary alumin|再生铝|废铝|铝合金|알루미늄 스크랩|드로스/gi,
  },
  recarb: {
    gn: [['zh', '焦煤 焦炭'], ['zh', '无烟煤'], ['en', 'Russian coal export']],
    title: /coal|anthracite|coke|无烟|焦煤|焦炭|煤炭|무연탄|가탄|코크스|석탄/i,
    body: /coal|anthracite|无烟|焦煤|焦炭|煤炭|무연탄|코크스|석탄/gi,
  },
  steel: {
    gn: [['zh', '螺纹钢 钢厂']],
    title: /钢厂|螺纹|粗钢|steel|철강|제강|전기로|철근|봉형강|열연|후판|철스크랩|포스코|현대제철|동국|세아/i,
    body: /钢厂|螺纹|粗钢|steel|철강|제강|전기로|철근|열연/gi,
  },
};

// 제목에 품목명이 없는 종합 리포트(선물사 일보·주간 등)
const REPORT_TITLE = /日报|早报|晚报|周报|月报|季报|聚焦|黑色|煤焦|矿钢|期市|daily review|weekly|시황/i;
// 본문 중간 광고·관련기사 안내 문단
const PROMO_LINE = /^(Metrix|Data Source Statement|Images in this article|Explore:|Connect with|Also read|Read more|Read also|Subscribe|Click here|Download|相关阅读|推荐阅读|관련기사)/i;
const BOILERPLATE = /(免责声明|资讯编辑|责任编辑|风险提示|本文来源|版权声明|저작권자|무단전재|Copyright ©|All rights reserved)/;
const TITLE_STOP = new Set(['from', 'after', 'with', 'that', 'this', 'will', 'have', 'been', 'into', 'over', 'amid', 'aluminium', 'aluminum', 'price', 'prices', 'market', 'expected', 'news']);

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const clip = (t, max = BODY_MAX) => (t.length > max ? t.slice(0, max) + '…' : t);
const ageH = (iso, now) => (now - Date.parse(iso)) / 3600000;
const relevantTitle = (spec, title) => spec.title.test(title) || REPORT_TITLE.test(title);

// ─── 순수 함수 (테스트 대상) ────────────────────────────────────────────────

// Google News RSS → [{title, gnLink, publisher, published}]
export function parseGnRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => decodeEntities((new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(m[1])?.[1] ?? '').trim());
    const raw = pick('title');
    const publisher = pick('source');
    const title = publisher && raw.endsWith(` - ${publisher}`) ? raw.slice(0, -publisher.length - 3) : raw;
    const t = Date.parse(pick('pubDate'));
    out.push({ title, gnLink: pick('link'), publisher, published: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  return out;
}

// batchexecute 응답에서 원문 URL 추출 (JSON 안의 이중 이스케이프를 푼다)
export function parseGnDecodeResponse(text) {
  const m = /\[\\"garturlres\\",\\"(.*?)\\"/.exec(String(text));
  return m ? m[1].replace(/\\+/g, '').replace(/u003d/g, '=').replace(/u0026/g, '&') : null;
}

function cutBoilerplate(text) {
  const i = text.search(BOILERPLATE);
  return (i > 0 ? text.slice(0, i) : text).trim();
}

// HTML → 본문 텍스트(문단은 줄바꿈). 매체 선택자가 있으면 그 영역, 없으면 가장 긴 연속 문단 묶음.
export function extractBody(html, bodyRe = null, maxLen = BODY_MAX) {
  let h = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  if (bodyRe) {
    const at = h.search(bodyRe);
    if (at >= 0) h = h.slice(at, at + 60000);
  }
  const paras = [];
  for (const m of h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (text.length >= 25 && !PROMO_LINE.test(text)) paras.push({ text, at: m.index });
  }
  if (!paras.length && bodyRe) {
    // 문단 태그 없이 줄바꿈으로 쓴 본문(ndsoft 일부)
    const lines = decodeEntities(h.slice(0, 20000).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' '))
      .split('\n').map(s => s.replace(/[ \t]+/g, ' ').trim()).filter(s => s.length >= 25 && !PROMO_LINE.test(s));
    return clip(cutBoilerplate(lines.join('\n')), maxLen);
  }
  // 문단 사이 마크업 간격이 크면 다른 영역(목록·추천기사)으로 보고 끊는다
  const len = (run) => run.reduce((a, x) => a + x.text.length, 0);
  let best = [], run = [];
  for (const p of paras) {
    if (run.length && p.at - run[run.length - 1].at > 3000) run = [];
    run.push(p);
    if (len(run) > len(best)) best = [...run];
  }
  return clip(cutBoilerplate(best.map(p => p.text).join('\n')), maxLen);
}

// 종합 리포트에서 해당 품목이 나오는 문단(과 바로 다음 문단)만 남긴다
export function focusBody(body, kwRe) {
  const re = new RegExp(kwRe.source, kwRe.flags.replace('g', ''));
  const paras = String(body).split('\n');
  const keep = new Set();
  paras.forEach((p, i) => { if (re.test(p)) { keep.add(i); if (i + 1 < paras.length) keep.add(i + 1); } });
  return [...keep].sort((a, b) => a - b).map(i => paras[i]).join('\n');
}

// 본문이 제목의 기사인지 확인 — 제목 핵심 토큰(흔한 단어 제외 영문 4자+, 한중 2-gram)의 40% 이상이 본문에 있어야 한다.
// 리다이렉트·옆 칸 기사를 본문으로 잡는 오인식을 막는다.
export function bodyMatchesTitle(title, body) {
  const t = String(title).toLowerCase();
  const b = String(body).toLowerCase();
  const words = (t.match(/[a-z]{4,}/g) ?? []).filter(w => !TITLE_STOP.has(w));
  const cjk = (t.match(/[\p{Script=Han}\p{Script=Hangul}]+/gu) ?? [])
    .flatMap(w => Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2)));
  const tokens = [...new Set([...words, ...cjk])];
  if (tokens.length < 3) return true;
  return tokens.filter(x => b.includes(x)).length / tokens.length >= 0.4;
}

// 제목 정규화 후 2-gram 자카드 유사도 — 같은 사건의 매체별 중복 보도를 묶는다
export function titleSimilarity(a, b) {
  const grams = (s) => {
    const t = String(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    const g = new Set();
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// 후보 → 매체·이미 쓴 기사·관련성·날짜 필터 → 중복 제거 → 시장당 상한 (본문 받기 전 단계)
export function selectCandidates(cands, market, { now = Date.now(), seen = new Set(), maxAgeH = MAX_AGE_H } = {}) {
  const spec = MARKETS[market];
  const fresh = cands
    .filter(c => c.url && DOMAINS[hostOf(c.url)])
    .filter(c => relevantTitle(spec, c.title))
    .filter(c => c.published && ageH(c.published, now) <= maxAgeH && ageH(c.published, now) >= -1)
    // 처음 쓰는 기사 → 제목에 품목명이 직접 있는 기사 → 최신순. 이미 쓴 기사는 새 기사가 모자랄 때만 repeat 표시로 채운다
    .map(c => ({ ...c, repeat: seen.has(c.url) }))
    .sort((a, b) => (a.repeat - b.repeat) || (spec.title.test(b.title) - spec.title.test(a.title)) || (Date.parse(b.published) - Date.parse(a.published)));
  const picked = [];
  const perDomain = {};
  for (const c of fresh) {
    const host = hostOf(c.url);
    if ((perDomain[host] ?? 0) >= PER_DOMAIN) continue;
    if (picked.some(p => p.url === c.url || titleSimilarity(p.title, c.title) >= 0.5)) continue;
    picked.push(c);
    perDomain[host] = (perDomain[host] ?? 0) + 1;
    if (picked.length >= PER_MARKET) break;
  }
  return picked;
}

// 받은 본문을 시장 근거로 쓸지 판정·정리. 쓸 수 없으면 null.
export function finalizeArticle(c, rawBody, market) {
  const spec = MARKETS[market];
  const direct = spec.title.test(c.title);
  let body = rawBody;
  if (direct) {
    if (!bodyMatchesTitle(c.title, body)) return null;
  } else {
    if ((body.match(spec.body) ?? []).length < BODY_HITS_MIN) return null; // 종합 리포트인데 이 품목 비중이 낮음
    body = focusBody(body, spec.body);
  }
  body = clip(body);
  // 종합 리포트 발췌는 품목 문단만 남겨 짧아도 정보 밀도가 높다
  if (body.length < (direct ? BODY_MIN : FOCUS_MIN)) return null;
  return { ...c, body };
}

// ─── 네트워크 ────────────────────────────────────────────────────────────────

async function getText(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ko;q=0.7', ...(opts.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 3000).toString('latin1');
  return /charset=["']?gb/i.test(head) ? new TextDecoder('gbk').decode(buf) : buf.toString('utf8');
}

async function decodeGnLink(gnLink) {
  const id = new URL(gnLink).pathname.split('/').pop();
  const html = await getText(`https://news.google.com/rss/articles/${id}`);
  const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
  if (!sg || !ts) return null;
  const req = [[['Fbv4je', `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`, null, 'generic']]];
  const text = await getText('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify(req)),
  });
  return parseGnDecodeResponse(text);
}

async function gnCandidates(lang, q) {
  const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&${GN_LOCALE[lang]}`);
  return parseGnRss(xml).slice(0, 20).map(it => ({ ...it, lang, url: null }));
}

async function krCandidates() {
  const lists = await Promise.all(KR_FEEDS.map(f => getText(f.url).then(x => parseRssItems(x, f.name)).catch(() => [])));
  return lists.flat().map(it => ({
    title: it.title, url: it.url, publisher: it.source, lang: 'ko',
    // ndsoft pubDate는 날짜만 쓴다 — 그날 KST 정오로 간주
    published: it.date ? new Date(`${it.date}T03:00:00Z`).toISOString() : null,
  }));
}

async function withConcurrency(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

// 시장별 근거 묶음. seen: 최근 며칠간 이미 쓴 URL(빼지 않고 후순위 + repeat 표시).
export async function collectEvidence({ seen = new Set(), now = Date.now() } = {}) {
  const kr = await krCandidates();
  const markets = {};
  const stats = {};

  for (const market of Object.keys(MARKETS)) {
    const spec = MARKETS[market];
    const gnLists = await Promise.all(spec.gn.map(([lang, q]) => gnCandidates(lang, q).catch(() => [])));
    // 원문 해독은 요청 2번이 드니 제목·날짜로 먼저 거른 뒤 최신 18건만 해독
    const gnPre = gnLists.flat()
      .filter(c => relevantTitle(spec, c.title) && c.published && ageH(c.published, now) <= WIDE_AGE_H)
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
      .slice(0, 18);
    const decoded = (await withConcurrency(gnPre, 6, async c => ({ ...c, url: await decodeGnLink(c.gnLink) }))).filter(c => c?.url);
    const cands = [...decoded, ...kr];
    let picked = selectCandidates(cands, market, { now, seen });
    if (picked.length < 2) picked = selectCandidates(cands, market, { now, seen, maxAgeH: WIDE_AGE_H });

    const articles = await withConcurrency(picked, 6, async c => {
      const d = DOMAINS[hostOf(c.url)];
      const base = { title: c.title, url: c.url, source: d.name, lang: c.lang, published: c.published, ...(c.repeat ? { repeat: true } : {}) };
      // 제목만 쓰는 기사는 본문으로 관련성을 확인할 수 없으니 제목에 품목명이 직접 있어야 한다
      if (d.titleOnly) return spec.title.test(c.title) ? { ...base, body: '', title_only: true } : null;
      return finalizeArticle(base, extractBody(await getText(c.url), d.body ?? null, 20000), market);
    });
    markets[market] = articles.filter(Boolean);
    stats[market] = { gn: gnLists.flat().length, decoded: decoded.length, picked: picked.length, kept: markets[market].length };
  }
  console.log(`[Evidence] ${Object.entries(stats).map(([k, s]) => `${k} ${s.kept}/${s.picked}`).join(' · ')}`);
  return { markets, stats };
}
