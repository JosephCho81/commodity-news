import admin from 'firebase-admin';

// Firebase Admin SDK 초기화 (중복 초기화 방지)
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

export default async function handler(req, res) {
  // CORS 처리 (프론트엔드에서 호출 가능하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Firestore 'daily_news' 컬렉션에서 가장 최신 문서 1개 가져오기
    const snapshot = await db.collection('daily_news')
      .orderBy('date', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: "저장된 뉴스가 없습니다." });
    }

    const newsData = snapshot.docs[0].data();
    res.status(200).json(newsData);
  } catch (error) {
    console.error("Firestore Get Error:", error);
    res.status(500).json({ error: error.message });
  }
}
