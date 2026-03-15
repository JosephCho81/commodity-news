import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

export default async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  try {
    const docRef = doc(db, "commodity-news", today);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return res.json({ status: "no-news" });
    }

    res.setHeader("Cache-Control", "s-maxage=3600");
    res.json(docSnap.data());
  } catch (e) {
    console.error("Firestore get error:", e);
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
