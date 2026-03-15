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

  // 중복 제거 + 상위 8개
  const seen = new Set();
  const processedNews = rawNews
    .filter((n) => {
      if (!n.title || seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    })
    .slice(0, 8)
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

  if (processedNews.length === 0) {
    throw new Error("RSS 수집 실패 — 뉴스 없음");
  }

  console.log("RSS 수집 완료: " + processedNews.length + "건");

  // 2. Gemini 호출 — url은 AI에 전달 안 함, id로 나중에 복원
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const newsForAI = processedNews.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
  }));

  const prompt = "당신은 글로벌 원자재 시장 전략가입니다.\n"
    + "아래 뉴스 헤드라인을 분석하여 한국 제강사 원료구매팀 임원 보고용 시장 리포트를 작성하십시오.\n\n"
    + "[절대 규칙]\n"
    + "- news 배열의 각 항목에는 반드시 입력 데이터의 id 값을 그대로 포함하십시오.\n"
    + "- url 필드는 포함하지 마십시오.\n\n"
    + "[가격 정보 — 최신 시장 추정값 기입]\n"
    + "1. LME Aluminum Cash Bid\n"
    + "2. 조달청 알루미늄 서구산 (원화, 부가세 포함)\n"
    + "3. LME Copper Cash Bid\n"
    + "4. LME Zinc Cash Bid\n\n"
    + "[응답 스키마]\n"
    + "prices: 배열, 각 항목은 item(string), price(string), note(string)\n"
    + "news: 배열, 각 항목은 id(number), title(string 한국어), summary(string 한국어 1~2문장), source(string)\n"
    + "snapshot: 문자열 배열 5개\n"
    + "priceDrivers: string\n"
    + "aluminumOutlook: string\n"
    + "copperOutlook: string\n"
    + "zincOutlook: string\n"
    + "riskSignals: string (줄바꿈 포함 4가지 리스크)\n"
    + "procurementStrategy: string\n\n"
    + "[뉴스 데이터]\n"
    + "오늘 날짜: " + today + "\n"
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
            maxOutputTokens: 4096,
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

    // responseMimeType: application/json 으로 받으면 바로 파싱 가능
    briefingData = JSON.parse(rawText);
    console.log("JSON 파싱 성공");

    // id 기반으로 원본 url 복원
    const urlById = new Map(processedNews.map((n) => [n.id, n.url]));
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
      news: processedNews.map((n) => ({
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
  const docData = Object.assign({}, briefingData, {
    date: today,
    updatedAt: new Date().toISOString(),
  });

  await setDoc(doc(database, "commodity-news", today), docData);
  console.log(today + " Firestore 저장 완료");

  return docData;
}

// ── 핸들러 ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const database = getDB();

    // STEP 1: Firestore 캐시 확인
    const docSnap = await getDoc(doc(database, "commodity-news", today));

    if (docSnap.exists()) {
      console.log(today + " 캐시 히트");
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      return res.json(
        Object.assign({ status: "cached" }, docSnap.data())
      );
    }

    // STEP 2: 없으면 생성
    console.log(today + " 캐시 미스 — 생성 시작");
    const docData = await generateAndSave(today);

    return res.json(
      Object.assign({ status: "generated" }, docData)
    );

  } catch (error) {
    console.error("핸들러 오류:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
}
