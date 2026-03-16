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
    // LME 알루미늄/비철
    "https://news.google.com/rss/search?q=LME+aluminum+aluminium+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+Middle+East+supply+disruption&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=LME+copper+zinc+nickel+price&hl=en&gl=US&ceid=US:en",
    // 가탄제 — 러시아 석탄
    "https://news.google.com/rss/search?q=Russia+coal+export+shipment+Asia&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Russian+coal+sanctions+India+China&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=petroleum+coke+calcined+coke+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=coal+anthracite+China+export+price&hl=en&gl=US&ceid=US:en",
    // 페로실리콘 — 탈중국화
    "https://news.google.com/rss/search?q=ferro+silicon+ferrosilicon+price+market&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=ferrosilicon+Norway+Kazakhstan+Malaysia&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=China+ferrosilicon+export+restriction+tariff&hl=en&gl=US&ceid=US:en",
    // 알루미늄 스크랩 — MJP/ISRI
    "https://news.google.com/rss/search?q=aluminium+scrap+secondary+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminum+scrap+ISRI+price+US&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Japan+aluminium+premium+MJP&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+premium+Midwest+Europe+duty+paid&hl=en&gl=US&ceid=US:en",
    // 컨테이너 운임
    "https://news.google.com/rss/search?q=SCFI+container+freight+rate+Asia&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=container+shipping+rate+Busan+China+US+Europe&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=container+freight+index+CCFI+WCI&hl=en&gl=US&ceid=US:en",
    // 벌크선 운임 — 러시아/석탄
    "https://news.google.com/rss/search?q=BDI+Baltic+dry+index+bulk+carrier&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Russia+coal+bulk+shipping+Korea+China&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Panamax+Supramax+bulk+freight+coal&hl=en&gl=US&ceid=US:en",
    // 관세
    "https://news.google.com/rss/search?q=metal+tariff+customs+trade+policy&hl=en&gl=US&ceid=US:en",
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
    "당신은 20년 경력의 비철금속·제강 부원료·해운 시장 전문 애널리스트입니다.\n" +
    "알루미늄 탈산제, 가탄제(소괴탄/분탄), 페로실리콘(FeSi60/75), 알루미늄 스크랩을\n" +
    "동국제강·포스코·현대제철에 납품하는 실무자를 위한 전문 시황 브리핑을 작성하세요.\n\n" +

    "## 가격 규칙\n" +
    "뉴스에 가격 없으면 최신 시장 지식 기반 추정값 + '(추정)' 표시. null 절대 금지.\n\n" +

    "## 부원료 분석 필수 항목\n\n" +

    "### carburizer (가탄제)\n" +
    "- 러시아 석탄 수출 물동량: 유럽향 감소분이 아시아(한국/인도/중국)로 얼마나 전환됐는지\n" +
    "- 러시아-한국 석탄 수입 현황 및 제재 리스크\n" +
    "- 중국 내륙 석탄가·수출 관세·전력 규제 현황\n" +
    "- 국내 가탄제 조달 영향 (러시아산 vs 중국산 비중)\n\n" +

    "### ferro_silicon (페로실리콘)\n" +
    "- 국내 제강사 탈중국화 현황 — 중국산 비중 감소 추세와 이유\n" +
    "- 대안 공급국: 노르웨이(Elkem), 카자흐스탄(ENRC), 말레이시아 공급 가격 및 동향\n" +
    "- 중국 윈난성 수력발전 시즌 영향, 수출 관세/제한 현황\n" +
    "- 비중국산 프리미엄: 중국산 대비 톤당 얼마나 비싼지\n\n" +

    "### al_scrap (알루미늄 스크랩)\n" +
    "- MJP (일본): 현재 분기 수준 ($/mt), Midwest 프리미엄, 유럽 duty paid 프리미엄 비교\n" +
    "- 지역별 프리미엄 차이 원인 (수급 불균형, 환경 규제, 수요 차이 등)\n" +
    "- ISRI 등급별 단가: Taint/Tabor, Twitch, Zorba, Tensor 등 주요 등급 현재 가격·등락·이유\n" +
    "- 미국/유럽 스크랩 수출이 아시아 수급에 미치는 영향\n\n" +

    "## 물류 분석 필수 항목\n\n" +

    "### container (컨테이너)\n" +
    "index: SCFI 또는 WCI 현재 수준과 전주 대비 등락\n" +
    "outlook: 향후 1~2주 운임 방향성 예측과 근거\n" +
    "routes: 아래 6개 항로 각각 40피트 컨테이너 기준 FOB 부산 운임\n" +
    "  1) 부산 → 상해 ($/FEU)\n" +
    "  2) 부산 → 칭다오 ($/FEU)\n" +
    "  3) 부산 → 미국 서부 ($/FEU)\n" +
    "  4) 부산 → 유럽 ($/FEU)\n" +
    "  5) 부산 → 동남아 ($/FEU)\n" +
    "  6) 부산 → 아프리카/중동 ($/FEU)\n" +
    "  각 항로마다: 현재 운임(추정 포함), 전월 대비 변동, 변동 원인\n\n" +

    "### bulk (벌크선)\n" +
    "index: BDI (Baltic Dry Index) 현재 수준과 등락\n" +
    "outlook: 향후 벌크 운임 방향성\n" +
    "routes: 아래 5개 항로 벌크선 운임 (5만톤급 Supramax/Panamax 기준)\n" +
    "  1) 러시아(보스토치니) → 한국 부산 ($/mt)\n" +
    "  2) 러시아(보스토치니) → 중국 ($/mt)\n" +
    "  3) 호주 → 한국 ($/mt)\n" +
    "  4) 인도네시아 → 한국 ($/mt)\n" +
    "  5) 러시아 → 인도 ($/mt)\n" +
    "  각 항로마다: 현재 운임(추정 포함), 변동 추이, 변동 원인\n\n" +

    "## 출력 형식\n" +
    "반드시 순수 JSON만 출력. { 로 시작 } 로 끝. 모든 텍스트 한국어.\n" +
    "news 각 항목에 id 포함. url 필드 포함하지 말 것.\n\n" +

    "{\n" +
    '  "lme_summary": {\n' +
    '    "aluminum": { "price": "...(추정)", "change": "...", "change_reason": "수치 포함 원인", "source": "..." },\n' +
    '    "copper": { "price": "...", "change": "...", "change_reason": "...", "source": "..." },\n' +
    '    "zinc": { "price": "...", "change": "...", "change_reason": "...", "source": "..." }\n' +
    "  },\n" +
    '  "key_news": [\n' +
    '    { "id": 0, "title": "한국어 제목", "summary": "요약", "relevance": "국내 납품 영향 — 수치 포함", "source": "출처" }\n' +
    "  ],\n" +
    '  "supply_chain_risk": { "level": "원활/주의/경고", "reason": "수치와 인과관계 2~3문장" },\n' +
    '  "sub_materials": {\n' +
    '    "carburizer": "러시아 물동량 유럽→아시아 전환 현황, 중국 석탄가/관세, 국내 조달 영향. 최소 4문장",\n' +
    '    "ferro_silicon": "탈중국화 현황, 노르웨이/카자흐스탄/말레이시아 대안 공급 가격, 비중국산 프리미엄. 최소 4문장",\n' +
    '    "al_scrap": "MJP/Midwest/유럽 프리미엄 각각 수준·차이 원인, ISRI 등급별 단가·등락·이유. 최소 4문장"\n' +
    "  },\n" +
    '  "logistics": {\n' +
    '    "container": {\n' +
    '      "index": "SCFI XXX pt (전주 대비 ±X%)",\n' +
    '      "outlook": "향후 운임 방향성 및 근거",\n' +
    '      "routes": [\n' +
    '        { "route": "부산 → 상해", "rate": "$XXX/FEU (추정)", "change": "전월 대비 ±X%", "reason": "변동 원인" },\n' +
    '        { "route": "부산 → 칭다오", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 미국 서부", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 유럽", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 동남아", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 아프리카/중동", "rate": "...", "change": "...", "reason": "..." }\n' +
    "      ]\n" +
    "    },\n" +
    '    "bulk": {\n' +
    '      "index": "BDI XXX pt (전주 대비 ±X%)",\n' +
    '      "outlook": "향후 벌크 운임 방향성 및 근거",\n' +
    '      "routes": [\n' +
    '        { "route": "러시아(보스토치니) → 부산", "vessel": "Supramax 5만톤", "rate": "$XX/mt (추정)", "change": "...", "reason": "..." },\n' +
    '        { "route": "러시아(보스토치니) → 중국", "vessel": "Supramax 5만톤", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "호주 → 한국", "vessel": "Panamax", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "인도네시아 → 한국", "vessel": "Supramax", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "러시아 → 인도", "vessel": "Supramax 5만톤", "rate": "...", "change": "...", "reason": "..." }\n' +
    "      ]\n" +
    "    },\n" +
    '    "customs": "관세/통관 최근 동향"\n' +
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
      logistics: {
        container: { index: null, outlook: null, routes: [] },
        bulk: { index: null, outlook: null, routes: [] },
        customs: null,
      },
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
