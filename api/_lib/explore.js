// api/_lib/explore.js — 세계 동향 탐색 실행: 신호 수집 → 관점 5개 웹 검색 → 원문 대조 → 사안 작성(검색 없음) → 문장 검증.
// 리포트 생성(collect-daily)과 따로 돈다 — 여기가 실패해도 리포트는 그대로 나가고, 화면은 직전 세계 동향을 발표일과 함께 보여 준다.
import { collectSignals, signalLines } from './signals.js';
import { FIND_INSTRUCTIONS, FIND_SCHEMA, LENSES, MAX_STEPS, SEARCH_TOOL, WRITE_INSTRUCTIONS, WRITE_SCHEMA, findInput } from './exploreLenses.js';
import { MAX_AGE_DAYS, carryFirstSeen, dedupeArticles, sanitizeIssues, verifyFound } from './exploreVerify.js';
import { numberedBody } from './cite.js';

const CONCURRENCY = 3;   // 동시 5개면 429(PLANNING.md), 3개는 glove-news 운영에서 통과. 2로 줄이면 3회차가 생겨 300초 한도가 빠듯하다
const MAX_ARTICLES = 8;  // 작성 입력 상한 — 비용·출력 길이
const MAX_ISSUES = 8;
const KEEP_DAYS = 3;     // 처음 다룬 날부터 이만큼은 새 사안 뒤에 이어 둔다
const LENS_TIMEOUT = 80000;
const WRITE_TIMEOUT = 75000;
const cost = (u) => u?.cost?.total_cost ?? 0;
const ageDays = (d, today) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

async function pool(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

// 작성 입력 — 기사 번호·문장 번호는 cite.js와 같은 함수로 매긴다(번호가 어긋나면 사실 문장이 전부 탈락)
export function writeInput(date, articles) {
  return [`기준일: ${date}`, '【기사】', ...articles.map((a, i) => `[${i + 1}] ${a.source} · ${a.published} — ${a.title}\n${numberedBody(a, i)}`)].join('\n\n');
}

/**
 * @param {{ date: string, callAgent: Function, fetchText: (url: string) => Promise<string>, previous?: any, ctx: any, budgetMs?: number,
 *   signalsFn?: Function, now?: () => number }} o
 */
export async function runExplore({ date, callAgent, fetchText, previous = null, ctx, budgetMs = 270000, signalsFn = collectSignals, now = Date.now }) {
  const t0 = now();
  const left = () => budgetMs - (now() - t0);
  const log = { lenses: {}, rejected: [], dropped: [], cost_usd: 0 };

  const sig = await signalsFn({ today: date }).catch(e => ({ signals: [], notices: [], errors: [`신호 수집 실패: ${e.message}`] }));
  log.signal_errors = sig.errors;
  const covered = (previous?.issues ?? []).map(i => i.title).slice(0, 10);

  // 1) 관점별 탐색 — 한 관점이 실패해도 나머지는 계속
  const found = await pool(LENSES, CONCURRENCY, async (lens) => {
    try {
      const res = await callAgent({
        instructions: FIND_INSTRUCTIONS, schema: FIND_SCHEMA, tools: [SEARCH_TOOL], maxSteps: MAX_STEPS, maxOutputTokens: 2500, timeoutMs: LENS_TIMEOUT,
        input: findInput({ lens, date, signals: signalLines(sig.signals), notices: sig.notices, covered }), label: `explore-${lens.key}`,
      });
      const items = (res.json?.items ?? []).filter(x => /^https?:\/\//.test(x?.url ?? '')).slice(0, 3);
      log.lenses[lens.key] = { found: items.length, cost_usd: cost(res.usage) };
      log.cost_usd += cost(res.usage);
      return { lens: lens.key, items, search: res.search ?? [] };
    } catch (e) {
      log.lenses[lens.key] = { error: String(e.message).slice(0, 200) };
      return { lens: lens.key, items: [], search: [] };
    }
  });

  // 2) 원문 대조 — 찾은 주소를 코드가 직접 연다
  const items = found.flatMap(f => f.items.map(it => ({ ...it, lens: f.lens })));
  const searchDates = Object.fromEntries(found.flatMap(f => f.search).filter(s => s.date && s.url).map(s => [s.url, String(s.date).slice(0, 10)]));
  const urls = [...new Set(items.flatMap(it => [it.url, it.second_url]).filter(u => /^https?:\/\//.test(u ?? '')))];
  const pages = Object.fromEntries((await pool(urls, 6, async (u) => [u, await fetchText(u).catch(() => null)])).filter(([, h]) => h));
  let articles = [];
  for (const it of items) {
    // 낯선 페이지 하나가 던져도 나머지 사안은 계속 — 탐색은 처음 보는 사이트를 연다
    let v;
    try { v = verifyFound(it, { pages, today: date, searchDates }); } catch (e) { v = { error: `검증 중 오류(${String(e.message).slice(0, 80)}) — ${it.url}` }; }
    if (v.article) articles.push({ ...v.article, lens: it.lens });
    else log.rejected.push(`${it.lens}: ${v.error}`);
  }
  articles = dedupeArticles(articles).slice(0, MAX_ARTICLES);
  log.articles = articles.map(a => `${a.lens} · ${a.source} · ${a.published} — ${a.title.slice(0, 60)}`);

  // 3) 사안 작성(검색 없음) → 문장 검증
  let issues = [];
  if (articles.length && left() > 30000) {
    try {
      const input = writeInput(date, articles);
      const res = await callAgent({ instructions: WRITE_INSTRUCTIONS, schema: WRITE_SCHEMA, input, maxOutputTokens: 6000, timeoutMs: Math.min(WRITE_TIMEOUT, left() - 10000), label: 'explore-write' });
      log.cost_usd += cost(res.usage);
      if (!res.json) throw new Error('작성 출력을 읽지 못함');
      const s = sanitizeIssues(res.json, { articles, input, today: date, ctx });
      issues = carryFirstSeen(s.issues, previous?.issues, date).slice(0, MAX_ISSUES);
      log.dropped = s.dropped;
    } catch (e) {
      log.write_error = String(e.message).slice(0, 200);
    }
  } else if (articles.length) log.write_error = `남은 시간 ${Math.round(left() / 1000)}초 — 작성 건너뜀`;

  // 오늘 통과한 사안이 없으면 직전 사안 중 아직 최근인 것을 그대로 둔다(발표일이 화면에 나온다) — 빈 화면으로 덮지 않는다
  const carried = !issues.length;
  if (carried) issues = (previous?.issues ?? []).filter(i => ageDays(i.published, date) <= MAX_AGE_DAYS);
  // 새 사안이 있어도 최근 며칠 다룬 사안은 뒤에 이어 둔다 — 탐색은 "이미 다룬 사안"을 다시 찾지 않으므로, 덮어쓰면 진행 중인 일이
  // 하루 만에 화면에서 사라진다(glove-news 2026-11-17 같은 날 두 번 돌렸더니 진행 중 사안이 빠졌다)
  else {
    const kept = (previous?.issues ?? []).filter(p => !issues.some(i => i.url === p.url)
      && ageDays(p.first_seen ?? p.published, date) <= KEEP_DAYS && ageDays(p.published, date) <= MAX_AGE_DAYS);
    issues = [...issues, ...kept].slice(0, MAX_ISSUES);
  }
  log.cost_usd = +log.cost_usd.toFixed(4);
  log.seconds = Math.round((now() - t0) / 1000);
  return {
    date, generated_at: new Date(now()).toISOString(),
    issues_date: carried ? (previous?.issues_date ?? previous?.date ?? null) : date,
    signals: sig.signals.length ? sig.signals : (previous?.signals ?? []),
    issues, log,
  };
}

// 화면으로 내보내는 모양 — 근거(매체·주소)는 화면에 표시하지 않는다(핵심 원칙 4)
export function publicWorld(w) {
  if (!w || (!w.issues?.length && !w.signals?.length)) return null;
  return {
    date: w.date, issues_date: w.issues_date ?? w.date, signals: w.signals ?? [],
    issues: (w.issues ?? []).map(({ url, source, src_title, ...rest }) => rest),
  };
}
