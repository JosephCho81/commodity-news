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

// ── KST 기준 오늘 날짜 (YYYY-MM-DD) ──────────────────────────────────────
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
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
          .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
          .replace(/<[^>]+>/g, "").trim();
        const cleanLink = link.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
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

  // 1. RSS 수집 — 비철/부원료 특화 피드
  const feeds = [
    "https://news.google.com/rss/search?q=aluminum+LME+market&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+scrap+market&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=ferro+silicon+market&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=petroleum+coke+carburizer+market&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=LME+copper+zinc+nickel&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=shipping+freight+commodity&hl=en&gl=US&ceid=US:en",
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
      try { source = new URL(n.url).hostname.replace("www.", ""); } catch (e) {}
      return { id: index, title: n.title, url: n.url, source, pubDate: n.pubDate };
    });

  if (allNews.length === 0) throw new Error("RSS 수집 실패 — 뉴스 없음");

  // 분석용 5개 / 표시용 전체
  const newsForAnalysis = allNews.slice(0, 5);
  const allNewsForDisplay = allNews.slice(0, 25);

  console.log("RSS 수집 완료: 분석용 " + newsForAnalysis.length + "건 / 표시용 " + allNewsForDisplay.length + "건");

  // 2. Gemini 호출 — 메타프롬프트 적용
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const newsForAI = newsForAnalysis.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
  }));

  // ── 메타프롬프트 (할루시네이션 방지 설계) ──────────────────────────────
  const systemPrompt =
    "너는 비철금속 및 제강 부원료 시장 전문 브리핑 작성 보조 AI야.\n" +
    "주요 독자는 알루미늄 탈산제, 알루미늄 드로스, 가탄제, 페로실리콘, 알루미늄 스크랩을 취급하는 국내 업계 실무자 및 제강사 구매팀이야.\n\n" +
    "## 절대 규칙\n\n" +
    "### [규칙 1] 모르면 null로 처리해\n" +
    "- 입력된 뉴스 데이터에 없는 내용은 절대 만들어내지 마.\n" +
    "- 확인되지 않은 가격, 수치, 업체명, 사건은 절대 언급하지 마.\n" +
    "- 정보가 부족한 필드는 null로 두고 절대 임의로 채우지 마.\n\n" +
    "### [규칙 2] 숫자와 가격은 출처가 있을 때만 써\n" +
    "- 가격 수치는 반드시 입력 데이터에서 나온 것만 사용해.\n" +
    "- 입력 데이터에 가격이 없으면 절대 추정하거나 예시로 넣지 마.\n" +
    "- lme_summary의 price/change 필드: 입력 뉴스에 LME 가격이 없으면 반드시 null.\n\n" +
    "### [규칙 3] 예측은 범위로, 단정하지 마\n" +
    "- '~할 것이다' 대신 '~가능성이 있다', '~우려가 있다'로 표현해.\n" +
    "- 납품 단가나 입찰가는 절대 예측하지 마.\n" +
    "- 시장 방향성은 '상방 압력', '하방 압력' 수준까지만 표현해.\n\n" +
    "### [규칙 4] 관련 없는 내용은 포함하지 마\n" +
    "- 알루미늄, 구리, 아연, 니켈, 가탄제, 페로실리콘, 해상운임과 무관한 뉴스는 제외해.\n" +
    "- 철근, 열연 등 철강 완제품 가격은 다루지 마.\n" +
    "- 주식, 부동산, 일반 경제 뉴스는 절대 포함하지 마.\n\n" +
    "### [규칙 5] supply_chain_risk.level 판단 기준\n" +
    "- '원활': 특별한 공급망 이슈 없음\n" +
    "- '주의': 잠재적 리스크 뉴스 있음\n" +
    "- '경고': 실제 공급 차질 뉴스 있음\n" +
    "- 근거 뉴스가 없으면 null\n\n" +
    "## 출력 규칙\n" +
    "- 반드시 순수 JSON만 출력해. { 로 시작해서 } 로 끝나야 해.\n" +
    "- 모든 텍스트는 한국어로 작성해.\n" +
    "- 전문 용어는 업계 용어 그대로 사용해 (탈산제, 드로스, 소괴탄, 분탄 등).\n" +
    "- news 배열의 각 항목에는 반드시 입력 데이터의 id 값을 그대로 포함해.\n" +
    "- url 필드는 포함하지 마. id만 포함하면 돼.\n\n" +
    "## 출력 JSON 구조\n" +
    "{\n" +
    '  "lme_summary": {\n' +
    '    "aluminum": { "price": null, "change": null, "source": null },\n' +
    '    "copper": { "price": null, "change": null, "source": null },\n' +
    '    "zinc": { "price": null, "change": null, "source": null }\n' +
    "  },\n" +
    '  "key_news": [\n' +
    '    { "id": 0, "title": "한국어 번역 제목", "summary": "핵심 내용 1~2문장. 입력 뉴스 내용만.", "relevance": "왜 비철/부원료 취급자에게 중요한지 한 문장. 없으면 null", "source": "출처" }\n' +
    "  ],\n" +
    '  "supply_chain_risk": { "level": "원활 또는 주의 또는 경고 또는 null", "reason": "판단 근거. 없으면 null" },\n' +
    '  "sub_materials": {\n' +
    '    "carburizer": "가탄제 관련 뉴스 요약. 없으면 null",\n' +
    '    "ferro_silicon": "페로실리콘 관련 뉴스 요약. 없으면 null",\n' +
    '    "al_scrap": "알루미늄 스크랩 관련 뉴스 요약. 없으면 null"\n' +
    "  },\n" +
    '  "logistics": {\n' +
    '    "freight": "해상운임 관련 뉴스. 없으면 null",\n' +
    '    "customs": "관세/통관 관련 뉴스. 없으면 null"\n' +
    "  },\n" +
    '  "disclaimer": "이 브리핑은 공개된 뉴스 데이터를 AI가 요약한 것입니다. 실제 거래 의사결정은 반드시 현장 전문가의 판단을 따르십시오."\n' +
    "}";

  const userPrompt =
    "오늘 날짜: " + today + "\n\n" +
    "아래 뉴스 헤드라인을 분석해서 비철금속 및 부원료 업계 실무자를 위한 브리핑을 작성해줘.\n" +
    "입력 데이터에 없는 내용은 절대 만들어내지 마. 없으면 null.\n\n" +
    "[뉴스 데이터]\n" +
    JSON.stringify(newsForAI, null, 2);

  let briefingData = null;

  try {
    console.log("Gemini 2.5 Flash 호출 시작...");

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
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

    // id 기반으로 원본 url 복원
    const urlById = new Map(newsForAnalysis.map((n) => [n.id, n.url]));
    if (briefingData.key_news && Array.isArray(briefingData.key_news)) {
      briefingData.key_news = briefingData.key_news.map((item) => {
        const originalUrl = urlById.get(item.id) || "";
        return Object.assign({}, item, { url: originalUrl });
      });
    }

  } catch (e) {
    console.error("Gemini 처리 오류:", e.message);
    briefingData = {
      lme_summary: {
        aluminum: { price: null, change: null, source: null },
        copper: { price: null, change: null, source: null },
        zinc: { price: null, change: null, source: null },
      },
      key_news: newsForAnalysis.map((n) => ({
        id: n.id,
        title: n.title,
        summary: "",
        relevance: null,
        url: n.url,
        source: n.source,
      })),
      supply_chain_risk: { level: null, reason: null },
      sub_materials: { carburizer: null, ferro_silicon: null, al_scrap: null },
      logistics: { freight: null, customs: null },
      disclaimer: "AI 분석 일시 오류. 원본 뉴스를 확인하세요.",
    };
  }

  // 3. Firestore 저장
  const docData = Object.assign({}, briefingData, {
    date: today,
    updatedAt: new Date().toISOString(),
    allNews: allNewsForDisplay,
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
