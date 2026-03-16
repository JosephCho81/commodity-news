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

  // ── RSS 피드 — 카테고리별 특화 ──────────────────────────────────────
  const feedGroups = {
    // LME 알루미늄
    aluminum: [
      "https://news.google.com/rss/search?q=LME+aluminum+aluminium+price&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=aluminium+Middle+East+supply+disruption&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=LME+copper+zinc+nickel+price&hl=en&gl=US&ceid=US:en",
    ],
    // 가탄제 — 러시아 석탄 + 중국 코크스
    carburizer: [
      "https://news.google.com/rss/search?q=Russia+coal+export+shipment+Asia&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=Russian+coal+sanctions+India+China&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=petroleum+coke+calcined+coke+price&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=coal+anthracite+China+export+price&hl=en&gl=US&ceid=US:en",
    ],
    // 페로실리콘 — 탈중국화 + 대안 공급국
    ferrosilicon: [
      "https://news.google.com/rss/search?q=ferro+silicon+ferrosilicon+price+market&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=ferrosilicon+Norway+Kazakhstan+Malaysia&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=China+ferrosilicon+export+restriction+tariff&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=ferrosilicon+non+China+alternative+supply&hl=en&gl=US&ceid=US:en",
    ],
    // 알루미늄 스크랩 — MJP + ISRI + 미국/유럽 프리미엄
    scrap: [
      "https://news.google.com/rss/search?q=aluminium+scrap+secondary+aluminium+price&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=aluminum+scrap+ISRI+price+US&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=Japan+aluminium+premium+MJP+scrap&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=aluminium+premium+Midwest+Europe+duty+paid&hl=en&gl=US&ceid=US:en",
    ],
    // 물류/관세
    logistics: [
      "https://news.google.com/rss/search?q=shipping+freight+SCFI+BDI+commodity&hl=en&gl=US&ceid=US:en",
      "https://news.google.com/rss/search?q=metal+tariff+customs+trade+policy&hl=en&gl=US&ceid=US:en",
    ],
  };

  let rawNews = [];
  for (const group of Object.values(feedGroups)) {
    for (const url of group) {
      rawNews = rawNews.concat(await fetchRSS(url));
    }
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

  const newsForAnalysis = allNews.slice(0, 20);
  const allNewsForDisplay = allNews.slice(0, 30);
  console.log("RSS 수집: 분석용 " + newsForAnalysis.length + "건 / 표시용 " + allNewsForDisplay.length + "건");

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 없음");

  const newsForAI = newsForAnalysis.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
  }));

  const prompt =
    "당신은 20년 경력의 비철금속 및 제강 부원료 시장 전문 애널리스트입니다.\n" +
    "알루미늄 탈산제(Al 30~90%), 알루미늄 드로스, 가탄제(소괴탄/분탄 FC80~84%),\n" +
    "페로실리콘(FeSi60/75), 알루미늄 스크랩(12종)을 동국제강·포스코·현대제철에\n" +
    "납품하는 실무자들을 위한 전문 시황 브리핑을 작성하세요.\n\n" +

    "## 가격 데이터 규칙\n" +
    "- 뉴스에 구체적 가격 있으면 그대로 사용, source에 출처 명시\n" +
    "- 없으면 최신 시장 지식 기반 추정값 + '(추정)' 표시. null 절대 금지.\n\n" +

    "## 분석 품질 기준\n" +
    "단순 요약 금지. 인과관계 + 수치 + 국내 납품 영향까지 반드시 포함.\n\n" +

    "## 부원료별 필수 분석 항목\n\n" +

    "### 가탄제 (carburizer) — 반드시 아래 항목 포함\n" +
    "1. 러시아 석탄 동향: 현재 러시아 석탄 수출 물동량, 유럽향 vs 아시아향 물량 흐름\n" +
    "   (러시아산 석탄이 서방 제재로 유럽 감소 → 아시아 전환 여부, 인도/중국 수입량)\n" +
    "2. 중국 내륙 석탄 가격 및 수출 관세 현황\n" +
    "3. 내몽골/산시성 전력 규제로 인한 생산 영향\n" +
    "4. 국내 가탄제 수급 영향: 러시아산 원료 비중, 대안 조달 가능성\n\n" +

    "### 페로실리콘 (ferro_silicon) — 반드시 아래 항목 포함\n" +
    "1. 탈중국화 동향: 국내 제강사들의 중국산 페로실리콘 의존도 감소 추세\n" +
    "2. 대안 공급국 현황: 노르웨이(Elkem), 카자흐스탄, 말레이시아 공급 동향 및 가격\n" +
    "3. 중국 생산 현황: 윈난성 수력발전 시즌 영향, 중국 수출 관세/제한 정책\n" +
    "4. 비중국산 페로실리콘 프리미엄 수준 (중국산 대비 얼마나 비싼지)\n\n" +

    "### 알루미늄 스크랩 (al_scrap) — 반드시 아래 항목 포함\n" +
    "1. MJP (일본 프리미엄): 현재 분기 MJP 수준, 미국 Midwest 프리미엄, 유럽 duty paid 프리미엄\n" +
    "   각 지역 프리미엄 차이 원인과 국내 조달에 미치는 영향\n" +
    "2. ISRI 스크랩 단가: 주요 등급(Taint/Tabor, Twitch, Zorba 등) 현재 단가 및 등락 원인\n" +
    "3. 미국/유럽 스크랩 수출 동향이 아시아 수급에 미치는 영향\n" +
    "4. 국내 재생 알루미늄 수급 온도\n\n" +

    "## 출력 형식\n" +
    "반드시 순수 JSON만 출력. { 로 시작 } 로 끝. 모든 텍스트 한국어.\n" +
    "news 각 항목에 id 포함. url 필드 포함하지 말 것.\n\n" +

    "{\n" +
    '  "lme_summary": {\n' +
    '    "aluminum": {\n' +
    '      "price": "$X,XXX (추정 또는 출처)",\n' +
    '      "change": "+X.X% 또는 -X.X%",\n' +
    '      "change_reason": "구체적 변동 원인 — 수치 포함 1~2문장",\n' +
    '      "source": "출처"\n' +
    "    },\n" +
    '    "copper": { "price": "...", "change": "...", "change_reason": "...", "source": "..." },\n' +
    '    "zinc": { "price": "...", "change": "...", "change_reason": "...", "source": "..." }\n' +
    "  },\n" +
    '  "key_news": [\n' +
    '    { "id": 0, "title": "한국어 제목", "summary": "요약", "relevance": "국내 영향 — 수치 포함", "source": "출처" }\n' +
    "  ],\n" +
    '  "supply_chain_risk": {\n' +
    '    "level": "원활 또는 주의 또는 경고",\n' +
    '    "reason": "수치와 인과관계 포함 2~3문장"\n' +
    "  },\n" +
    '  "sub_materials": {\n' +
    '    "carburizer": "가탄제 분석 — 러시아 물동량(유럽향/아시아향), 중국 석탄가/관세, 전력규제, 국내 영향 포함. 최소 4문장",\n' +
    '    "ferro_silicon": "페로실리콘 분석 — 탈중국화 현황, 노르웨이/카자흐스탄/말레이시아 대안 공급, 중국 윈난성 전력, 비중국산 프리미엄 수준. 최소 4문장",\n' +
    '    "al_scrap": "알루미늄 스크랩 분석 — MJP/Midwest/유럽 프리미엄 각각 수준 및 차이 원인, ISRI 주요 등급 단가 및 등락, 아시아 수급 영향. 최소 4문장"\n' +
    "  },\n" +
    '  "logistics": {\n' +
    '    "freight": "해상운임 — SCFI/BDI 수준, 주요 항로 운임 포함",\n' +
    '    "customs": "관세/통관 — 최근 정책 변화 또는 현황"\n' +
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
