import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // JSON 임포트 에러 방지를 위해 fs 사용
    const configPath = path.resolve(__dirname, "../firebase-applet-config.json");
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // Firebase 초기화 (중복 방지)
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const dbId = firebaseConfig.firestoreDatabaseId === "(default)" ? undefined : firebaseConfig.firestoreDatabaseId;
    const db = getFirestore(app, dbId);

    // 1. 오늘 브리핑이 이미 있는지 확인
    try {
      const todayDoc = await getDoc(doc(db, "commodity-news", today));
      if (todayDoc.exists()) {
        return res.json({
          status: "already-exists",
          data: todayDoc.data()
        });
      }
    } catch (e) {
      console.error("Firestore check error:", e);
    }

    // 2. 뉴스 수집
    async function fetchRSS(url) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return [];
        const xml = await r.text();
        const items = xml.split("<item>").slice(1, 40);
        return items.map(item => {
          const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
          const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
          // HTML 엔티티 간단 해제
          const cleanTitle = title.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
          return { title: cleanTitle, url: link };
        }).filter(i => i.title && i.url);
      } catch (e) {
        console.error(`Fetch error for ${url}:`, e);
        return [];
      }
    }

    const feeds = [
      "https://news.google.com/rss/search?q=aluminum+market+news&hl=ko&gl=KR&ceid=KR:ko",
      "https://news.google.com/rss/search?q=copper+market+news&hl=ko&gl=KR&ceid=KR:ko",
      "https://news.google.com/rss/search?q=zinc+market+news&hl=ko&gl=KR&ceid=KR:ko",
      "https://news.google.com/rss/search?q=LME+metal+market&hl=ko&gl=KR&ceid=KR:ko"
    ];

    let news = [];
    for (const f of feeds) {
      const r = await fetchRSS(f);
      news = news.concat(r);
    }

    // 중복 제거 및 필터링
    const seen = new Set();
    const uniqueNews = news.filter(n => {
      if (!n.title || seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    });

    // 출처 추가
    const processedNews = uniqueNews.slice(0, 20).map(n => {
      try {
        const hostname = new URL(n.url).hostname.replace("www.", "");
        return { ...n, source: hostname };
      } catch {
        return { ...n, source: "News" };
      }
    });

    res.json({
      status: "need-generation",
      date: today,
      news: processedNews
    });
  } catch (error) {
    console.error("Global API Error:", error);
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: error.message 
    });
  }
}
