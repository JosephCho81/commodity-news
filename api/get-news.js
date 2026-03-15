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

// ── JSON 추출 헬퍼 ────────────────────────────────────────────────────────
function extractJSON(text) {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const fenceMatch2 = text.match(/```\s*([\s\S]*?)```/);
  if (fenceMatch2) {
    return JSON.parse(fenceMatch2[1].trim());
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("JSON을 찾을 수 없음");
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

  // 중복 제거
  const seen = new Set();
  const processedNews = rawNews
    .filter((n) => {
      if (!n.title || seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    })
    .slice(0, 10)
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

  // 2. Gemini 1.5 Pro 호출
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const newsForAI = processedNews.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
    url: n.url,
  }));

  const prompt = "당신은 글로벌 원자재 시장 전략가입니다.\n"
    + "아래 뉴스 데이터를 분석하여 한국 제강사 원료구매팀 임원 보고용 시장 리포트를 JSON으로 작성하십시오.\n\n"
    + "[절대 규칙]\n"
    + "- 반드시 순수 JSON만 출력하십시오. 설명이나 마크다운 없이 { 로 시작해서 } 로 끝나야 합니다.\n"
    + "- news 배열의 url은 아래 입력 데이터의 url을 절대 변경하지 말고 그대로 복사하십시오.\n"
    + "- url을 새로 만들거나 추측하지 마십시오.\n\n"
    + "[가격 정보]\n"
    + "최신 시장 데이터를 기반으로 아래 4가지 가격을 추정하여 기입하십시오:\n"
    + "1. LME Aluminum Cash Bid (약 $3,500대)\n"
    + "2. 조달청 알루미늄 서구산 (원화, 부가세 포함)\n"
    + "3. LME Copper Cash Bid (약 $12,700대)\n"
    + "4. LME Zinc Cash Bid\n\n"
    + "[출력 JSON 구조]\n"
    + "{\n"
    + '  "prices": [\n'
    + '    { "item": "LME Aluminum", "price": "$3,519", "note": "재고 감소로 인한 상승세" },\n'
    + '    { "item": "조달청 알루미늄\\n(서구산)", "price": "3,450,000원\\n(부가세 포함)", "note": "환율 상승 반영" },\n'
    + '    { "item": "LME Copper", "price": "$12,757", "note": "공급 부족 우려 심화" },\n'
    + '    { "item": "LME Zinc", "price": "$2,450", "note": "공급 과잉 우려로 하락" }\n'
    + "  ],\n"
    + '  "news": [\n'
    + '    { "title": "한국어로 번역된 제목", "summary": "핵심 내용 1~2문장", "url": "입력 데이터 url 그대로", "source": "출처" }\n'
    + "  ],\n"
    + '  "snapshot": ["이슈1", "이슈2", "이슈3", "이슈4", "이슈5"],\n'
    + '  "priceDrivers": "가격 변동 동인 설명",\n'
    + '  "aluminumOutlook": "알루미늄 시장 전망",\n'
    + '  "copperOutlook": "구리 시장 전망",\n'
    + '  "zincOutlook": "아연 시장 전망",\n'
    + '  "riskSignals": "1. 중동 분쟁 장기화에 따른 물류비 급증\\n2. 미국발 관세 전쟁 본격화\\n3. 고금리 장기화에 따른 실물 수요 위축 가능성\\n4. 중국의 전격적인 수출 제한 조치 가능성",\n'
    + '  "procurementStrategy": "구매 전략 인사이트"\n'
    + "}\n\n"
    + "[뉴스 데이터]\n"
    + "오늘 날짜: " + today + "\n"
    + JSON.stringify(newsForAI, null, 2);

  let briefingData = null;

  try {
    console.log("Gemini 1.5 Pro 호출 시작...");

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 16384,
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

    briefingData = extractJSON(rawText);
    console.log("JSON 파싱 성공");

    // 링크 검증 — AI가 url을 바꿨으면 원본으로 복원
    const urlByTitle = new Map(newsForAI.map((n) => [n.title, n.url]));
    const validUrls = new Set(newsForAI.map((n) => n.url));

    if (briefingData.news && Array.isArray(briefingData.news)) {
      briefingData.news = briefingData.news.map((item) => {
        if (!item.url || !validUrls.has(item.url)) {
          const restored = urlByTitle.get(item.title) || "";
          console.log("URL 복원: " + item.title + " -> " + restored);
          return Object.assign({}, item, { url: restored });
        }
        return item;
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
