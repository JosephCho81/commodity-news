import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Firebase 초기화 (모듈 레벨 — cold start 시 1회만) ─────────────────────
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

  // 2. Gemini 분석
  // ⚠️  핵심: AI에게 title + source + url만 전달
  //     url은 뉴스 본문 분석용 참고 데이터로만 제공하며,
  //     응답 JSON의 news[].url은 반드시 이 입력값 그대로 사용하도록 프롬프트에 명시
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const newsForAI = processedNews.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
    url: n.url,        // URL은 그대로 전달 — AI가 새로 만들지 못하도록 프롬프트에서 강제
  }));

  const systemInstruction = `당신은 글로벌 원자재 시장 전략가입니다.
다음 글로벌 원자재 뉴스 데이터를 분석하여 한국 제강사 원료구매팀 임원 보고용 시장 리포트를 작성하십시오.

[필수 가격 조사 항목]
1. LME Aluminum: Cash Bid 최신 가격 (약 $3,500대)
2. 조달청 알루미늄 (서구산): 최신 방출 가격
3. LME Copper: Cash Bid 최신 가격 (약 $12,700대)
4. LME Zinc: Cash Bid 최신 가격

[절대 규칙 — 링크 관련]
- news 배열의 각 항목 url은 반드시 입력 데이터에서 제공된 url을 그대로 복사하십시오.
- url을 절대 새로 만들거나 추측하거나 수정하지 마십시오.
- 입력 데이터에 없는 url은 빈 문자열("")로 두십시오.

[기타 지침]
1. 모든 응답은 반드시 한국어로 작성하십시오.
2. 해외 뉴스 제목과 요약은 반드시 한국어로 번역하십시오.
3. "prices" 섹션에는 위 4가지 항목만 포함하십시오.
4. 조달청 알루미늄 item 명칭은 "조달청 알루미늄\\n(서구산)", price는 "가격원\\n(부가세 포함)" 형식.
5. "note" 필드에는 가격 등락 원인을 한 문장으로 작성하십시오.
6. "snapshot" 섹션에는 현재 시장의 핵심 이슈 5가지를 작성하십시오.
7. "riskSignals"는 다음 4가지를 \\n으로 구분: 1. 중동 분쟁 장기화에 따른 물류비 급증\\n2. 미국발 관세 전쟁 본격화\\n3. 고금리 장기화에 따른 실물 수요 위축 가능성\\n4. 중국의 전격적인 수출 제한 조치 가능성
8. 반드시 아래 JSON 구조를 엄격히 지켜서 응답하십시오.

JSON 구조:
{
  "prices": [
    { "item": "LME Aluminum", "price": "$3,519", "note": "재고 감소로 인한 상승세" },
    { "item": "조달청 알루미늄\\n(서구산)", "price": "3,450,000원\\n(부가세 포함)", "note": "환율 상승 반영" },
    { "item": "LME Copper", "price": "$12,757", "note": "공급 부족 우려 심화" },
    { "item": "LME Zinc", "price": "$2,450", "note": "공급 과잉 우려로 하락" }
  ],
  "news": [
    { "title": "한국어로 번역된 제목", "summary": "핵심 내용 1~2문장 요약", "url": "입력 데이터의 url 그대로", "source": "출처" }
  ],
  "snapshot": ["이슈1", "이슈2", "이슈3", "이슈4", "이슈5"],
  "priceDrivers": "가격 변동 동인 내용",
  "aluminumOutlook": "알루미늄 전망 내용",
  "copperOutlook": "구리 전망 내용",
  "zincOutlook": "아연 전망 내용",
  "riskSignals": "1. 중동 분쟁...\\n2. 미국발...\\n3. 고금리...\\n4. 중국의...",
  "procurementStrategy": "구매 전략 인사이트 내용"
}`;

  const userPrompt = `오늘 날짜: ${new Date().toLocaleDateString('ko-KR')}

다음 뉴스 데이터를 분석하여 리포트를 작성하라.
news 배열의 url은 아래 입력 데이터의 url을 절대 변경하지 말고 그대로 복사하라.

뉴스 데이터:
${JSON.stringify(newsForAI, null, 2)}`;

  let briefingData = null;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) throw new Error(`Gemini HTTP ${geminiRes.status}`);
    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) throw new Error("Gemini 응답 비어있음");

    // JSON 파싱
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    briefingData = JSON.parse(cleaned);

    // ── 링크 검증: AI가 만든 url이 입력 데이터에 없으면 원본으로 교체 ──
    const urlMap = new Map(newsForAI.map((n) => [n.title, n.url]));
    if (briefingData.news && Array.isArray(briefingData.news)) {
      briefingData.news = briefingData.news.map((item) => {
        // url이 비어있거나 입력 데이터에 없는 url이면 title로 매칭해서 원본 url 복원
        if (!item.url || !newsForAI.some((n) => n.url === item.url)) {
          const matchedUrl = urlMap.get(item.title) || "";
          return { ...item, url: matchedUrl };
        }
        return item;
      });
    }
  } catch (e) {
    console.error("Gemini error:", e.message);
    // 폴백: Gemini 실패 시 최소한의 구조 반환
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
      snapshot: ["AI 분석 일시 오류 — 원본 뉴스 목록을 확인하세요"],
      priceDrivers: "AI 분석 생성 중 오류가 발생했습니다.",
      aluminumOutlook: "",
      copperOutlook: "",
      zincOutlook: "",
      riskSignals: "",
      procurementStrategy: "",
    };
  }

  // 3. Firestore 저장
  const docData = {
    ...briefingData,
    date: today,
    updatedAt: new Date().toISOString(),
  };

  await setDoc(doc(database, "commodity-news", today), docData);
  console.log(`✅ ${today} 브리핑 저장 완료`);

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

    // STEP 1: Firestore에서 오늘 데이터 조회
    const docSnap = await getDoc(doc(database, "commodity-news", today));

    if (docSnap.exists()) {
      // 캐시 히트 — RSS·Gemini 호출 없음, 비용 0
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      return res.json({
        status: "cached",
        ...docSnap.data(),
      });
    }

    // STEP 2: 없으면 생성 후 저장하고 반환
    console.log(`📰 ${today} 브리핑 없음 — 생성 시작`);
    const docData = await generateAndSave(today);

    return res.json({
      status: "generated",
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
