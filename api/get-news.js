import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Firebase 초기화 (모듈 레벨 — cold start 시 1회만 실행) ────────────────
let db;
function getDB() {
  if (db) return db;
  const configPath = path.resolve(__dirname, "../firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const dbId =
    firebaseConfig.firestoreDatabaseId === "(default)"
      ? undefined
      : firebaseConfig.firestoreDatabaseId;
  db = getFirestore(app, dbId);
  return db;
}

// ── RSS 수집 ──────────────────────────────────────────────────────────────
async function fetchRSS(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.split("<item>").slice(1, 40);
    return items
      .map((item) => {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
        const link =
          item.match(/<link>(.*?)<\/link>/)?.[1] ||
          item.match(/<link\s*\/>(.*?)<\/link>/)?.[1] ||
          "";
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
        const cleanTitle = title
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
          .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
          .replace(/<[^>]+>/g, "").trim();
        const cleanLink = link.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
        return { title: cleanTitle, url: cleanLink, pubDate };
      })
      .filter((i) => i.title && i.url && i.url.startsWith("http"));
  } catch (e) {
    console.error(`RSS fetch error [${url}]:`, e.message);
    return [];
  }
}

// ── 뉴스 생성 (RSS + Gemini + Firestore 저장) ─────────────────────────────
async function generateAndSave(today) {
  const database = getDB();

  // 1. RSS 수집
  const feeds = [
    "https://news.google.com/rss/search?q=aluminum+market+LME&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=copper+market+LME&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=zinc+market+LME&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=nickel+market+LME&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=raw+material+commodity+price&hl=en&gl=US&ceid=US:en",
  ];

  let rawNews = [];
  for (const f of feeds) {
    rawNews = rawNews.concat(await fetchRSS(f));
  }

  // 중복 제거
  const seen = new Set();
  const processedNews = rawNews
    .filter((n) => {
      if (!n.title || seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    })
    .slice(0, 25)
    .map((n, index) => {
      let source = "News";
      try { source = new URL(n.url).hostname.replace("www.", ""); } catch {}
      return { id: index, title: n.title, url: n.url, source, pubDate: n.pubDate };
    });

  if (processedNews.length === 0) {
    throw new Error("RSS 수집 실패 — 뉴스 없음");
  }

  // 2. Gemini 분석 — title만 전달, URL 절대 포함 안 함
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const titlesForAI = processedNews
    .map((n) => `[${n.id}] ${n.title} — ${n.source}`)
    .join("\n");

  const prompt = `당신은 원자재 시장 전문 애널리스트입니다.
아래는 오늘 수집된 원자재 관련 뉴스 헤드라인입니다.

[중요 규칙]
- URL, 링크, 웹주소를 절대로 생성하거나 포함하지 마세요.
- 뉴스를 참조할 때는 반드시 [숫자] 형식만 사용하세요. 예: [0], [3]
- 없는 정보를 추측하거나 만들어내지 마세요.

[뉴스 헤드라인]
${titlesForAI}

[작성 형식]
다음 형식으로 한국어 시황 브리핑을 작성해주세요:

## 오늘의 원자재 시황 요약
(전체 2~3문장 요약)

## 금속별 동향
### 알루미늄
(관련 뉴스 [번호] 인용하며 동향 설명)

### 구리
(관련 뉴스 [번호] 인용하며 동향 설명)

### 아연 / 니켈
(관련 뉴스 [번호] 인용하며 동향 설명)

## 주요 이슈
(시장에 영향을 줄 핵심 이슈 2~3개, 각 이슈에 관련 뉴스 [번호] 포함)`;

  let analysisText = "";
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
        }),
      }
    );
    if (!geminiRes.ok) throw new Error(`Gemini HTTP ${geminiRes.status}`);
    const geminiData = await geminiRes.json();
    analysisText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!analysisText) throw new Error("Gemini 응답 비어있음");
  } catch (e) {
    console.error("Gemini error:", e.message);
    analysisText = `${today} 원자재 뉴스 ${processedNews.length}건 수집 완료. AI 분석 일시 오류.`;
  }

  // 3. [번호] → [[번호]](실제URL) 후처리 — AI가 만든 번호를 실제 링크로 교체
  const linkedAnalysis = analysisText.replace(/\[(\d+)\]/g, (match, idxStr) => {
    const item = processedNews[parseInt(idxStr, 10)];
    return item ? `[[${idxStr}]](${item.url})` : match;
  });

  // 4. Firestore 저장
  const docData = {
    date: today,
    analysis: linkedAnalysis,
    news: processedNews,
    newsCount: processedNews.length,
    generatedAt: new Date().toISOString(),
  };

  await setDoc(doc(database, "commodity-news", today), docData);
  console.log(`✅ ${today} 브리핑 저장 완료 — ${processedNews.length}건`);

  return docData;
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const database = getDB();

    // ── STEP 1: Firestore에서 오늘 데이터 먼저 조회 ──────────────────────
    const docSnap = await getDoc(doc(database, "commodity-news", today));

    if (docSnap.exists()) {
      // ✅ 캐시 히트 — RSS·Gemini 호출 없음, 비용 0
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      return res.json({
        status: "cached",
        date: today,
        ...docSnap.data(),
      });
    }

    // ── STEP 2: 캐시 미스 — 생성 후 저장하고 반환 ────────────────────────
    // 첫 번째 접속자만 이 경로를 탐. 이후 접속자는 항상 STEP 1에서 끝남.
    // ⚠️  Vercel Hobby 플랜은 함수 타임아웃 10초 → vercel.json에서 maxDuration 설정 필요
    console.log(`📰 ${today} 브리핑 없음 — 첫 번째 접속자, 생성 시작`);
    const docData = await generateAndSave(today);

    return res.json({
      status: "generated",
      date: today,
      ...docData,
    });

  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
}
