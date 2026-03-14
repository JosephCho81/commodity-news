import admin from 'firebase-admin';
import Parser from 'rss-parser';

// 1. Firebase Admin SDK 초기화 (Vercel 환경 변수 사용)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const parser = new Parser();

export default async function handler(req, res) {
  try {
    // 2. RSS 피드 수집 (예시: 구글 뉴스)
    const feed = await parser.parseURL('https://news.google.com/rss/search?q=알루미늄+LME&hl=ko&gl=KR&ceid=KR:ko');
    
    const newsData = {
      date: new Date().toISOString(),
      articles: feed.items.slice(0, 5).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate
      }))
    };

    // 3. Firestore 'daily_news' 컬렉션에 저장
    await db.collection('daily_news').doc('latest').set(newsData);

    res.status(200).json({ success: true, data: newsData });
  } catch (error) {
    console.error("Firebase Error:", error);
    res.status(500).json({ error: error.message });
  }
}
