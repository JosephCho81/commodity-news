import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  // GET 또는 POST만 허용
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Firebase config 로드
    const configPath = path.resolve(__dirname, "../firebase-applet-config.json");
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // Firebase 초기화 (중복 방지)
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const dbId =
      firebaseConfig.firestoreDatabaseId === "(default)"
        ? undefined
        : firebaseConfig.firestoreDatabaseId;
    const db = getFirestore(app, dbId);

    // ── 1. 오늘 브리핑이 이미 있으면 그대로 반환 ──────────────────────────
    try {
      const todayDoc = await getDoc(doc(db, "commodity-news", today));
      if (todayDoc.exists()) {
        return res.json({
          status: "already-exists",
          data: todayDoc.data(),
        });
      }
    } catch (e) {
      console.error("Firestore check error:", e);
      // 체크 실패해도 생성은 계속 진행
    }

    // ── 2. RSS 피드 수집 ──────────────────────────────────────────────────
    async function fetchRSS(url) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return [];
        const xml = await r.text();
        const items = xml.split("<item>").slice(1, 40);
        return items
          .map((item) => {
            const title =
              item.match(/<title>(.*?)<\/title>/)?.[1] || "";
            const link =
              item.match(/<link>(.*?)<\/link>/)?.[1] ||
              item.match(/<link\s*\/>(.*?)<\/link>/)?.[1] ||
              "";
            const pubDate =
              item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
            const cleanTitle = title
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
              .replace(/<[^>]+>/g, "")
              .trim();
            const cleanLink = link.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
            return { title: cleanTitle, url: cleanLink, pubDate };
          })
          .filter((i) => i.title && i.url && i.url.startsWith("http"));
      } catch (e) {
        console.error(`Fetch error for ${url}:`, e.message);
        return [];
      }
    }

    const feeds = [
      "https://news.google.com/rss/search?q=aluminum+market+LME&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=copper+market+LME&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=zinc+market+LME&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=nickel+market+LME&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=raw+material+commodity+price&hl=en&gl=US&ceid=US:en",
    ];

    let rawNews = [];
    for (const f of feeds) {
      const r = await fetchRSS(f);
      rawNews = rawNews.concat(r);
    }

    // 중복 제거 (title 기준)
    const seen = new Set();
    const uniqueNews = rawNews.filter((n) => {
      if (!n.title || seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    });

    // 출처(hostname) 추가 + 상위 25개
    const processedNews = uniqueNews.slice(0, 25).map((n, index) => {
      let source = "News";
      try {
        source = new URL(n.url).hostname.replace("www.", "");
      } catch {}
      return {
        id: index,          // AI가 참조할 인덱스 (URL 대신)
        title: n.title,
        url: n.url,         // RSS 원본 URL — AI에는 전달 안 함
        source,
        pubDate: n.pubDate,
      };
    });

    if (processedNews.length === 0) {
      return res.status(500).json({ error: "뉴스 수집 실패 — RSS 피드 응답 없음" });
    }

    // ── 3. Gemini 분석 — title만 전달, URL 절대 포함하지 않음 ──────────────
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" });
    }

    // AI에게는 인덱스 + 제목 + 출처만 전달 (URL 없음)
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
            generationConfig: {
              temperature: 0.3,   // 낮게 설정 — 할루시네이션 감소
              maxOutputTokens: 1500,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            ],
          }),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
      }

      const geminiData = await geminiRes.json();
      analysisText =
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!analysisText) {
        throw new Error("Gemini 응답이 비어있습니다");
      }
    } catch (e) {
      console.error("Gemini error:", e);
      // Gemini 실패 시 간단한 폴백 텍스트
      analysisText = `오늘(${today}) 원자재 뉴스 ${processedNews.length}건이 수집되었습니다. AI 분석 생성 중 오류가 발생했습니다.`;
    }

    // ── 4. [번호] → 실제 링크로 후처리 ────────────────────────────────────
    // AI가 출력한 [0], [3] 등을 실제 뉴스 title + url로 교체
    const linkedAnalysis = analysisText.replace(/\[(\d+)\]/g, (match, idxStr) => {
      const idx = parseInt(idxStr, 10);
      const item = processedNews[idx];
      if (!item) return match; // 해당 번호 없으면 그냥 둠
      // 마크다운 링크로 변환 — 프론트에서 렌더링
      return `[[${idx}]](${item.url})`;
    });

    // ── 5. Firestore 저장 ─────────────────────────────────────────────────
    const docData = {
      date: today,
      analysis: linkedAnalysis,      // [번호]가 실제 링크로 변환된 텍스트
      analysisRaw: analysisText,      // 원본 AI 텍스트 (디버깅용)
      news: processedNews,            // RSS 원본 URL 포함 전체 배열
      newsCount: processedNews.length,
      generatedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, "commodity-news", today), docData);
    console.log(`✅ ${today} 브리핑 생성 완료 — 뉴스 ${processedNews.length}건`);

    return res.json({
      status: "generated",
      data: docData,
    });
  } catch (error) {
    console.error("Global API Error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
}
