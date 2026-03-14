import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

export default async function handler(req, res) {

const today = new Date().toISOString().slice(0,10)

const firebaseConfig = {
 apiKey: "YOUR_FIREBASE_API_KEY",
 authDomain: "YOUR_PROJECT.firebaseapp.com",
 projectId: "YOUR_PROJECT_ID",
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

const docRef = doc(db,"daily_news",today)
const docSnap = await getDoc(docRef)

if (!docSnap.exists()) {
 return res.json({status:"no-news"})
}

res.setHeader("Cache-Control", "s-maxage=3600")

res.json(docSnap.data())

}
