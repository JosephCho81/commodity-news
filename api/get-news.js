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

  // 1. RSS 수집
  const feeds = [
    "https://news.google.com/rss/search?q=LME+aluminum+aluminium+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+Middle+East+supply+disruption&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=LME+copper+zinc+nickel+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Russia+coal+export+shipment+Asia&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Russian+coal+sanctions+India+China&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=petroleum+coke+calcined+coke+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=ferro+silicon+ferrosilicon+price+market&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=ferrosilicon+Norway+Kazakhstan+Malaysia&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=China+ferrosilicon+export+restriction&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+scrap+secondary+price&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminum+scrap+ISRI+price+US&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Japan+aluminium+premium+MJP&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=aluminium+premium+Midwest+Europe+duty+paid&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=SCFI+container+freight+rate+Asia&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=BDI+Baltic+dry+index+bulk+carrier&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Russia+coal+bulk+shipping+Korea+China&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=US+steel+tariff+Korea+Section232&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=China+steel+dumping+Korea+anti+dumping&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=China+steel+export+Southeast+Asia+redirect&hl=en&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Korea+steel+US+export+tariff+impact&hl=en&gl=US&ceid=US:en",
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

  // 2. Perplexity API 호출 (실시간 웹 검색 내장)
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY 환경변수 없음");

  const newsForAI = newsForAnalysis.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
  }));

  const prompt =
    "당신은 20년 경력의 비철금속·제강 부원료·해운·무역정책 전문 애널리스트입니다.\n" +
    "웹 검색을 통해 오늘(" + today + ") 기준 최신 실제 데이터를 조회하고,\n" +
    "알루미늄 탈산제·가탄제·페로실리콘·알루미늄 스크랩을 동국제강·포스코·현대제철에 납품하는\n" +
    "실무자를 위한 전문 시황 브리핑을 작성하세요.\n\n" +

    "## 실시간 검색 필수 항목\n" +
    "반드시 웹 검색으로 가장 최신 실제 데이터를 조회하세요.\n\n" +
    "### LME 가격 — 아래 검색어로 최신 Cash Bid 가격 조회 (최신 날짜 우선)\n" +
    "검색어 1: LME aluminium cash bid price today site:westmetall.com\n" +
    "검색어 2: LME aluminum cash bid price today site:investing.com\n" +
    "검색어 3: LME aluminium copper zinc cash price today site:tradingeconomics.com\n" +
    "- 알루미늄 Cash Bid ($/mt): 가장 최신 날짜 기준 실제값\n" +
    "- 구리 Cash Bid ($/mt): 가장 최신 날짜 기준 실제값\n" +
    "- 아연 Cash Bid ($/mt): 가장 최신 날짜 기준 실제값\n" +
    "- source 필드에 반드시 날짜 명시 (예: 2026-03-13 기준, westmetall.com)\n\n" +
    "### 나머지 검색 항목\n" +
    "- 알루미늄 MJP (일본 프리미엄) 현재 분기 실제 수준\n" +
    "- 미국 Midwest 프리미엄, 유럽 duty paid 프리미엄 실제 수준\n" +
    "- ISRI 스크랩 등급별 실제 단가 (Taint/Tabor, Twitch, Zorba)\n" +
    "- SCFI (상하이 컨테이너 운임 지수) 최신 수치\n" +
    "- BDI (발틱 건화물 지수) 최신 수치\n" +
    "- 러시아 석탄 아시아 수출 최신 물동량\n" +
    "- 페로실리콘 중국 수출가 및 노르웨이/카자흐스탄 공급가\n\n" +

    "## 분석 품질 기준\n" +
    "단순 요약 금지. 인과관계 + 실제 수치 + 국내 납품 영향까지 포함.\n" +
    "검색으로 찾은 실제 가격은 날짜·출처 명시. 찾지 못한 경우만 '(추정)' 표시.\n\n" +

    "## 부원료 분석 필수 항목\n\n" +
    "### carburizer: 러시아 석탄 아시아 전환 물동량, 중국 석탄가/관세, 국내 조달 영향. 최소 4문장\n" +
    "### ferro_silicon: 탈중국화, 노르웨이/카자흐스탄/말레이시아 대안 공급가, 비중국산 프리미엄. 최소 4문장\n" +
    "### al_scrap: MJP/Midwest/유럽 프리미엄 각각 실제 수준·차이 원인, ISRI 등급별 단가·등락. 최소 4문장\n\n" +

    "## 물류 분석\n" +
    "### 컨테이너: SCFI 실제 수치, 부산→상해/칭다오/미국서부/유럽/동남아/아프리카 6개 항로 운임\n" +
    "### 벌크선: BDI 실제 수치, 러시아→부산/중국, 호주→한국, 인도네시아→한국, 러시아→인도 5개 항로\n" +
    "### 관세: 미국 Section232 한국산 관세율·쿼터, 중국산 철강 한국 유입·반덤핑, 우회 수출 현황. 최소 5문장\n\n" +

    "## 출력 형식\n" +
    "반드시 순수 JSON만 출력. { 로 시작 } 로 끝. 모든 텍스트 한국어.\n" +
    "news 각 항목에 id 포함. url 필드 포함하지 말 것.\n\n" +

    "{\n" +
    '  "lme_summary": {\n' +
    '    "aluminum": { "price": "실제가격 또는 추정", "change": "등락%", "change_reason": "원인 수치포함", "source": "출처" },\n' +
    '    "copper": { "price": "...", "change": "...", "change_reason": "...", "source": "..." },\n' +
    '    "zinc": { "price": "...", "change": "...", "change_reason": "...", "source": "..." }\n' +
    "  },\n" +
    '  "key_news": [ { "id": 0, "title": "한국어제목", "summary": "요약", "relevance": "국내영향-수치포함", "source": "출처" } ],\n' +
    '  "supply_chain_risk": { "level": "원활/주의/경고", "reason": "수치와 인과관계 2~3문장" },\n' +
    '  "sub_materials": {\n' +
    '    "carburizer": "러시아 물동량, 중국 석탄가/관세, 국내 영향. 최소 4문장",\n' +
    '    "ferro_silicon": "탈중국화, 대안공급가, 비중국산 프리미엄. 최소 4문장",\n' +
    '    "al_scrap": "MJP/Midwest/유럽 실제수준·차이원인, ISRI 등급별 단가. 최소 4문장"\n' +
    "  },\n" +
    '  "logistics": {\n' +
    '    "container": {\n' +
    '      "index": "SCFI 실제수치 (전주대비 ±X%)",\n' +
    '      "outlook": "향후 운임 방향성",\n' +
    '      "routes": [\n' +
    '        { "route": "부산 → 상해", "rate": "실제 또는 추정$/FEU", "change": "±X%", "reason": "원인" },\n' +
    '        { "route": "부산 → 칭다오", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 미국 서부", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 유럽", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 동남아", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "부산 → 아프리카/중동", "rate": "...", "change": "...", "reason": "..." }\n' +
    "      ]\n" +
    "    },\n" +
    '    "bulk": {\n' +
    '      "index": "BDI 실제수치 (전주대비 ±X%)",\n' +
    '      "outlook": "향후 방향성",\n' +
    '      "routes": [\n' +
    '        { "route": "러시아(보스토치니) → 부산", "vessel": "Supramax 5만톤", "rate": "실제$/mt", "change": "...", "reason": "..." },\n' +
    '        { "route": "러시아(보스토치니) → 중국", "vessel": "Supramax 5만톤", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "호주 → 한국", "vessel": "Panamax", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "인도네시아 → 한국", "vessel": "Supramax", "rate": "...", "change": "...", "reason": "..." },\n' +
    '        { "route": "러시아 → 인도", "vessel": "Supramax 5만톤", "rate": "...", "change": "...", "reason": "..." }\n' +
    "      ]\n" +
    "    },\n" +
    '    "customs": "미국 Section232 한국산 관세율·쿼터, 중국산 철강 한국유입·반덤핑, 우회수출 현황, 국내 제강사 영향. 최소 5문장"\n' +
    "  },\n" +
    '  "expert_comment": "오늘 전체 시장을 종합한 핵심 한 문장 요약",\n' +
    '  "disclaimer": "이 브리핑은 공개된 뉴스와 실시간 웹 검색 데이터를 AI가 분석한 것입니다. 실제 거래 의사결정은 반드시 현장 전문가의 판단을 따르십시오."\n' +
    "}\n\n" +
    "오늘 날짜: " + today + "\n" +
    "[수집된 뉴스 " + newsForAI.length + "건]\n" +
    JSON.stringify(newsForAI, null, 2);

  let briefingData = null;

  try {
    console.log("Perplexity API 호출 시작...");

    const pplxRes = await fetch(
      "https://api.perplexity.ai/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + PERPLEXITY_API_KEY,
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            {
              role: "system",
              content: "당신은 비철금속·제강 부원료·해운 전문 애널리스트입니다. 반드시 웹 검색으로 최신 실제 데이터를 조회하고 순수 JSON만 출력하세요."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 8000,
          temperature: 0.2,
          return_citations: true,
        }),
      }
    );

    console.log("Perplexity 응답 상태: " + pplxRes.status);

    if (!pplxRes.ok) {
      const errBody = await pplxRes.text();
      throw new Error("Perplexity HTTP " + pplxRes.status + ": " + errBody);
    }

    const pplxData = await pplxRes.json();
    const rawText = pplxData?.choices?.[0]?.message?.content || "";

    console.log("Perplexity 응답 길이: " + rawText.length + "자");
    if (!rawText) throw new Error("Perplexity 응답 비어있음");

    // JSON 추출
    const fenceMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    const fenceMatch2 = rawText.match(/```\s*([\s\S]*?)```/);
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");

    if (fenceMatch) {
      briefingData = JSON.parse(fenceMatch[1].trim());
    } else if (fenceMatch2) {
      briefingData = JSON.parse(fenceMatch2[1].trim());
    } else if (start !== -1 && end !== -1) {
      briefingData = JSON.parse(rawText.slice(start, end + 1));
    } else {
      throw new Error("JSON 추출 실패");
    }

    console.log("JSON 파싱 성공");

    // id 기반 url 복원
    const urlById = new Map(newsForAnalysis.map((n) => [n.id, n.url]));
    if (briefingData.key_news && Array.isArray(briefingData.key_news)) {
      briefingData.key_news = briefingData.key_news.map((item) => {
        return Object.assign({}, item, { url: urlById.get(item.id) || "" });
      });
    }

    // expert_comment 문자열 → 객체 변환
    if (briefingData.expert_comment && typeof briefingData.expert_comment === "string") {
      briefingData.expert_comment = {
        text: briefingData.expert_comment,
        updatedAt: new Date().toISOString(),
      };
    }

  } catch (e) {
    console.error("Perplexity 처리 오류:", e.message);
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
      expert_comment: null,
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
