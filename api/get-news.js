import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Firebase 초기화 ───────────────────────────────────────────────────────
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

// ── KST 기준 오늘 날짜 반환 (YYYY-MM-DD) ─────────────────────────────────
function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
          .replace(/<[^>]+>/g, "")
          .trim();
        const cleanLink = link
          .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
          .trim();
        return { title: cleanTitle, url: cleanLink, pubDate };
      })
      .filter((i) => i.title && i.url && i.url.startsWith("http"));
  } catch (e) {
    console.error("RSS fetch error [" + url + "]:", e.message);
    return [];
  }
}

// ── 뉴스 생성 메인 함수 ───────────────────────────────────────────────────
async function generateAndSave(today) {
  const database = getDB();

  // 1. RSS 수집 — 분석용 5개 + 표시용 전체 따로 관리
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
  const allNews = rawNews
    .filter((n) => {
      if (!n.title || seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    })
    .map((n, index) => {
      let source = "News";
      try {
        source = new URL(n.url).hostname.replace("www.", "");
      } catch (e) {}
      return {
        id: index,
        title: n.title,
        url: n.url,
        source: source,
        pubDate: n.pubDate,
      };
    });

  if (allNews.length === 0) {
    throw new Error("RSS 수집 실패 — 뉴스 없음");
  }

  // 분석용: 상위 5개만 Gemini에 전달 (토큰 절약)
  const newsForAnalysis = allNews.slice(0, 5);
  // 표시용: 전체 뉴스 (최대 25개) Firestore에 저장
  const allNewsForDisplay = allNews.slice(0, 25);

  console.log("RSS 수집 완료: 분석용 " + newsForAnalysis.length + "건 / 표시용 " + allNewsForDisplay.length + "건");

  // 2. Gemini 호출 — 분석용 5개만 전달
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const newsForAI = newsForAnalysis.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
  }));

  const prompt = "당신은 글로벌 원자재 시장 전략가입니다.\n"
    + "오늘 날짜: " + today + "\n\n"
    + "아래 뉴스 헤드라인을 분석하여 한국 제강사 원료구매팀 임원 보고용 시장 리포트를 작성하십시오.\n\n"
    + "[가격 입력 규칙]\n"
    + "현재 시장의 추정 가격을 기입하고, note에 반드시 (추정치) 라고 명시하십시오.\n"
    + "- LME Aluminum: 현재 Cash Bid 가격 (예: $2,650.50)\n"
    + "- 조달청 알루미늄 서구산: 현재 방출 가격 (예: 3,200,000원\\n(부가세 포함))\n"
    + "- LME Copper: 현재 Cash Bid 가격 (예: $9,850.00)\n"
    + "- LME Zinc: 현재 Cash Bid 가격 (예: $2,850.00)\n\n"
    + "[prices 항목명 — 정확히 아래와 같이 작성]\n"
    + "item[0]: LME Aluminum\n"
    + "item[1]: 조달청 알루미늄\\n(서구산)\n"
    + "item[2]: LME Copper\n"
    + "item[3]: LME Zinc\n\n"
    + "[모든 필드 필수 — 빈 문자열 금지]\n"
    + "snapshot: 반드시 5개 항목\n"
    + "priceDrivers: 200자 이상\n"
    + "aluminumOutlook: 100자 이상\n"
    + "copperOutlook: 100자 이상\n"
    + "zincOutlook: 100자 이상\n"
    + "riskSignals: 반드시 아래 4가지 포함\n"
    + "1. 중동 분쟁 장기화에 따른 물류비 급증\n"
    + "2. 미국발 관세 전쟁 본격화\n"
    + "3. 고금리 장기화에 따른 실물 수요 위축 가능성\n"
    + "4. 중국의 전격적인 수출 제한 조치 가능성\n"
    + "procurementStrategy: 100자 이상\n\n"
    + "[news 규칙]\n"
    + "- 각 항목에 입력 데이터의 id 값 그대로 포함\n"
    + "- title은 한국어로 번역\n"
    + "- summary는 한국어 1~2문장\n"
    + "- url 필드 포함하지 말 것\n\n"
    + "[뉴스 데이터]\n"
    + JSON.stringify(newsForAI, null, 2);

  let briefingData = null;

  try {
    console.log("Gemini 2.5 Flash 호출 시작...");

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    console.log("Gemini 응답 상태: " + geminiRes.status);

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      throw new Error("Gemini HTTP " + geminiRes.status + ": " + errBody);
    }

    const geminiData = await geminiRes.json();
    const rawText =
      geminiData &&
      geminiData.candidates &&
      geminiData.candidates[0] &&
      geminiData.candidates[0].content &&
      geminiData.candidates[0].content.parts &&
      geminiData.candidates[0].content.parts[0]
        ? geminiData.candidates[0].content.parts[0].text
        : "";

    console.log("Gemini 응답 길이: " + rawText.length + "자");
    if (!rawText) throw new Error("Gemini 응답 텍스트 비어있음");

    briefingData = JSON.parse(rawText);
    console.log("JSON 파싱 성공");

    // id 기반으로 원본 url 복원 (분석용 5개)
    const urlById = new Map(newsForAnalysis.map((n) => [n.id, n.url]));
    if (briefingData.news && Array.isArray(briefingData.news)) {
      briefingData.news = briefingData.news.map((item) => {
        const originalUrl = urlById.get(item.id) || "";
        return Object.assign({}, item, { url: originalUrl });
      });
    }

  } catch (e) {
    console.error("Gemini 처리 오류:", e.message);
    briefingData = {
      prices: [
        { item: "LME Aluminum", price: "N/A", note: "데이터 조회 실패" },
        { item: "조달청 알루미늄\n(서구산)", price: "N/A", note: "데이터 조회 실패" },
        { item: "LME Copper", price: "N/A", note: "데이터 조회 실패" },
        { item: "LME Zinc", price: "N/A", note: "데이터 조회 실패" },
      ],
      news: newsForAnalysis.map((n) => ({
        id: n.id,
        title: n.title,
        summary: "",
        url: n.url,
        source: n.source,
      })),
      snapshot: ["AI 분석 일시 오류 — 잠시 후 다시 시도해 주세요"],
      priceDrivers: "AI 분석 생성 중 오류가 발생했습니다.",
      aluminumOutlook: "",
      copperOutlook: "",
      zincOutlook: "",
      riskSignals: "",
      procurementStrategy: "",
    };
  }

  // 3. Firestore 저장
  // allNewsForDisplay: 전체 뉴스 목록 (url 포함) 별도 저장
  const docData = Object.assign({}, briefingData, {
    date: today,
    updatedAt: new Date().toISOString(),
    allNews: allNewsForDisplay,  // 전체 뉴스 목록
  });

  await setDoc(doc(database, "commodity-news", today), docData);
  console.log(today + " Firestore 저장 완료 (전체 뉴스 " + allNewsForDisplay.length + "건)");

  return docData;
}

// ── 핸들러 ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const today = getKSTDate();
    const database = getDB();

    const docSnap = await getDoc(doc(database, "commodity-news", today));

    if (docSnap.exists()) {
      console.log(today + " 캐시 히트");
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      return res.json(Object.assign({ status: "cached" }, docSnap.data()));
    }

    console.log(today + " 캐시 미스 — 생성 시작");
    const docData = await generateAndSave(today);

    return res.json(Object.assign({ status: "generated" }, docData));

  } catch (error) {
    console.error("핸들러 오류:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
}
