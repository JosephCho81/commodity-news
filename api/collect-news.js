import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

export default async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  // 1. 오늘 브리핑이 이미 있는지 확인
  try {
    const todayDoc = await getDoc(doc(db, "daily_news", today));
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
      const r = await fetch(url);
      const xml = await r.text();
      const items = xml.split("<item>").slice(1, 40);
      return items.map(item => {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
        const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
        return { title, url: link };
      });
    } catch (e) {
      return [];
    }
  }

  const feeds = [
    "https://news.google.com/rss/search?q=aluminum+market",
    "https://news.google.com/rss/search?q=copper+market",
    "https://news.google.com/rss/search?q=zinc+market",
    "https://news.google.com/rss/search?q=LME+metals+news"
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
}
