import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

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

async function generateAndSave(today) {
  const database = getDB();

  const feeds = [
    "https://news.google.com/rss/search?q=LME+aluminum+aluminium+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+scrap+secondary+aluminium&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=ferro+silicon+ferrosilicon+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=petroleum+coke+calcined+coke&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=LME+copper+zinc+nickel+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=shipping+freight+SCFI+commodity&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=China+aluminium+aluminum+export&hl=en&gl=US&ceid=US:en",
  ];

  let rawNews = [];
  for (const f of feeds) {
    rawNews = rawNews.concat(await fetchRSS(f));
  }

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

  if (allNews.length === 0) throw new Error("RSS 수집 실패");

  const newsForAnalysis = allNews.slice(0, 15);
  const allNewsForDisplay = allNews.slice(0, 25);
  console.log("RSS 수집: 분석용 " + newsForAnalysis.length + "건 / 표시용 " + allNewsForDisplay.length + "건");

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 없음");

  const newsForAI = newsForAnalysis.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
  }));

  // 프롬프트를 하나로 통합 (system_instruction 미사용)
  const prompt =
    "당신은 20년 경력의 비철금속 및 제강 부원료 시장 전문 애널리스트입니다.\n" +
    "알루미늄 탈산제(Al 30~90%), 알루미늄 드로스(Al 20~65%), 가탄제(소괴탄/분탄 FC80~84%),\n" +
    "페로실리콘(FeSi60/75), 알루미늄 스크랩(12종)을 국내 제강사(동국제강, 포스코, 현대제철)에\n" +
    "납품하는 실무자들을 위한 전문 시황 브리핑을 작성하세요.\n\n" +

    "## 가격 데이터 규칙\n" +
    "- 뉴스에 구체적 가격 있으면: 그대로 사용, source에 출처 명시\n" +
    "- 뉴스에 가격 없으면: 최신 시장 지식 기반 추정값 기입 + 반드시 '(추정)' 표시\n" +
    "- 가격 필드를 절대 비워두지 마세요. null 금지.\n" +
    "- 예시: '$2,485 (추정)', '$9,842 (추정)', '$2,910 (추정)'\n\n" +

    "## 분석 품질 기준\n" +
    "나쁜 분석(금지): '중동 분쟁으로 알루미늄 공급 차질 우려'\n" +
    "좋은 분석(목표): 'UAE Qatalum, 바레인 Alba 물량 아시아 도착 지연 → LME 재고 감소 →\n" +
    "현물 프리미엄 상승. 국내 수입 알루미늄 원가 톤당 $30~50 추가 상승 가능성 있음'\n\n" +
    "반드시 포함할 것: 인과관계, 구체적 수치(%, 톤, 달러), 국내 납품 환경 연관성\n\n" +

    "## 부원료별 핵심 분석 변수\n" +
    "- 가탄제: 중국 내륙 석탄 가격, 수출 관세, 내몽골/산시성 전력 규제\n" +
    "- 페로실리콘: 중국 윈난성 수력발전 시즌, 노르웨이/카자흐스탄 생산량\n" +
    "- 알루미늄 스크랩: 일본 프리미엄(MJP), 미국 UBC 수출량, 국내 회수율\n" +
    "관련 뉴스가 없어도 현재 시장 상황 기반으로 각 품목 동향을 반드시 2문장 이상 작성\n\n" +

    "## 출력 형식\n" +
    "반드시 순수 JSON만 출력. 설명 없이 { 로 시작 } 로 끝.\n" +
    "모든 텍스트 한국어. url 필드 포함하지 말 것. 각 news 항목에 id 포함.\n\n" +

    "{\n" +
    '  "lme_summary": {\n' +
    '    "aluminum": {\n' +
    '      "price": "예: $2,485.50 (추정)",\n' +
    '      "change": "예: +1.2% 또는 -0.8%",\n' +
    '      "change_reason": "가격 변동 주요 원인 1~2문장. 반드시 구체적 사유 포함",\n' +
    '      "source": "뉴스 출처 또는 시장 추정"\n' +
    "    },\n" +
    '    "copper": {\n' +
    '      "price": "예: $9,842.00 (추정)",\n' +
    '      "change": "예: -0.8%",\n' +
    '      "change_reason": "가격 변동 주요 원인 1~2문장",\n' +
    '      "source": "뉴스 출처 또는 시장 추정"\n' +
    "    },\n" +
    '    "zinc": {\n' +
    '      "price": "예: $2,910.50 (추정)",\n' +
    '      "change": "예: +2.4%",\n' +
    '      "change_reason": "가격 변동 주요 원인 1~2문장",\n' +
    '      "source": "뉴스 출처 또는 시장 추정"\n' +
    "    }\n" +
    "  },\n" +
    '  "key_news": [\n' +
    '    {\n' +
    '      "id": 0,\n' +
    '      "title": "한국어 번역 제목",\n' +
    '      "summary": "핵심 내용 요약",\n' +
    '      "relevance": "국내 비철/부원료 취급자 영향 — 구체적 수치 포함",\n' +
    '      "source": "출처"\n' +
    "    }\n" +
    "  ],\n" +
    '  "supply_chain_risk": {\n' +
    '    "level": "원활 또는 주의 또는 경고",\n' +
    '    "reason": "구체적 수치와 인과관계 포함한 판단 근거 2~3문장"\n' +
    "  },\n" +
    '  "sub_materials": {\n' +
    '    "carburizer": "가탄제 동향 — 중국 석탄가격/수출관세/전력규제 현황 포함. 최소 2문장",\n' +
    '    "ferro_silicon": "페로실리콘 동향 — 중국 생산현황/윈난성 전력 포함. 최소 2문장",\n' +
    '    "al_scrap": "알루미늄 스크랩 동향 — MJP/UBC/국내 수급 포함. 최소 2문장"\n' +
    "  },\n" +
    '  "logistics": {\n' +
    '    "freight": "해상운임 동향 — SCFI/BDI 수준 또는 주요 항로 운임 포함",\n' +
    '    "customs": "관세/통관 동향 — 최근 변화사항 또는 현재 상황 요약"\n' +
    "  },\n" +
    '  "disclaimer": "이 브리핑은 공개된 뉴스와 시장 데이터를 AI가 분석한 것입니다. 가격은 추정치를 포함하며 실제 거래 의사결정은 반드시 현장 전문가의 판단을 따르십시오."\n' +
    "}\n\n" +

    "오늘 날짜: " + today + "\n" +
    "[분석할 뉴스 " + newsForAI.length + "건]\n" +
    JSON.stringify(newsForAI, null, 2);

  let briefingData = null;

  try {
    console.log("Gemini 호출 시작...");

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
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
    if (!rawText) throw new Error("Gemini 응답 비어있음");

    briefingData = JSON.parse(rawText);
    console.log("JSON 파싱 성공");

    // id 기반 url 복원
    const urlById = new Map(newsForAnalysis.map((n) => [n.id, n.url]));
    if (briefingData.key_news && Array.isArray(briefingData.key_news)) {
      briefingData.key_news = briefingData.key_news.map((item) => {
        return Object.assign({}, item, { url: urlById.get(item.id) || "" });
      });
    }

  } catch (e) {
    console.error("Gemini 처리 오류:", e.message);
    briefingData = {
      lme_summary: {
        aluminum: { price: null, change: null, change_reason: null, source: null },
        copper: { price: null, change: null, change_reason: null, source: null },
        zinc: { price: null, change: null, change_reason: null, source: null },
      },
      key_news: newsForAnalysis.slice(0, 5).map((n) => ({
        id: n.id, title: n.title, summary: "", relevance: null, url: n.url, source: n.source,
      })),
      supply_chain_risk: { level: null, reason: null },
      sub_materials: { carburizer: null, ferro_silicon: null, al_scrap: null },
      logistics: { freight: null, customs: null },
      disclaimer: "AI 분석 일시 오류. 잠시 후 다시 시도해 주세요.",
    };
  }

  const docData = Object.assign({}, briefingData, {
    date: today,
    updatedAt: new Date().toISOString(),
    allNews: allNewsForDisplay,
  });

  await setDoc(doc(database, "commodity-news", today), docData);
  console.log(today + " Firestore 저장 완료");
  return docData;
}

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
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
