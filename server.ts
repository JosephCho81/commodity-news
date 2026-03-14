import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Generate and Validate News (RSS Based)
  app.get("/api/generate-report", async (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    
    // Check if already exists in Firestore
    try {
      const existingDoc = await getDoc(doc(db, "daily_news", date));
      if (existingDoc.exists()) {
        return res.json(existingDoc.data());
      }
    } catch (e) {
      console.error("Firestore check error:", e);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "API Key missing" });

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });

      // 1. Get LME Price from Yahoo Finance
      const getLME = async () => {
        try {
          const r = await fetch("https://query1.finance.yahoo.com/v7/finance/quote?symbols=ALI=F");
          const j: any = await r.json();
          return j.quoteResponse.result[0]?.regularMarketPrice || null;
        } catch (e) {
          return null;
        }
      };
      const lmePrice = await getLME();

      // 2. Collect News via RSS
      const fetchRSS = async (url: string) => {
        try {
          const r = await fetch(url);
          const xml = await r.text();
          const items = xml.split("<item>").slice(1, 25);
          return items.map(item => {
            const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
            const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
            return { title, url: link };
          });
        } catch (e) {
          return [];
        }
      };

      const feeds = [
        "https://news.google.com/rss/search?q=aluminum+market",
        "https://news.google.com/rss/search?q=steel+scrap",
        "https://news.google.com/rss/search?q=iron+ore",
        "https://news.google.com/rss/search?q=steel+industry"
      ];

      let allNews: any[] = [];
      for (const f of feeds) {
        const r = await fetchRSS(f);
        allNews = allNews.concat(r);
      }

      // 3. Deduplicate and Validate URLs
      const seen = new Set();
      const uniqueNews = allNews.filter(n => {
        if (seen.has(n.title)) return false;
        seen.add(n.title);
        return true;
      });

      const validatedNews = [];
      for (const n of uniqueNews.slice(0, 40)) {
        if (validatedNews.length >= 15) break;
        try {
          const check = await fetch(n.url, { method: "HEAD" });
          if (check.ok) {
            const source = new URL(n.url).hostname.replace("www.", "");
            let score = 1;
            if (source.includes("reuters")) score = 5;
            if (source.includes("bloomberg")) score = 5;
            if (source.includes("ft.com")) score = 4;
            if (source.includes("mining.com")) score = 3;
            validatedNews.push({ ...n, source, score });
          }
        } catch (e) {
          continue;
        }
      }
      validatedNews.sort((a, b) => b.score - a.score);

      // 4. AI Analysis using Gemini
      const briefingRes = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze the following global commodity news for ${date} and provide a strategic report for a steel company procurement team.
        
        News Data: ${JSON.stringify(validatedNews)}
        LME Aluminum Price: ${lmePrice}
        
        Provide the report in Korean.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              prices: { type: "array", items: { type: "object", properties: { item: { type: "string" }, price: { type: "string" }, note: { type: "string" } } } },
              snapshot: { type: "array", items: { type: "string" } },
              priceDrivers: { type: "string" },
              aluminumOutlook: { type: "string" },
              scrapOutlook: { type: "string" },
              ironOreMining: { type: "string" },
              riskSignals: { type: "string" },
              procurementStrategy: { type: "string" }
            }
          }
        }
      });

      const briefingData = JSON.parse(briefingRes.text || "{}");
      
      if (lmePrice && !briefingData.prices.some((p: any) => p.item.includes("Aluminum"))) {
        briefingData.prices.unshift({
          item: "LME Aluminum",
          price: `$${lmePrice}`,
          note: "Yahoo Finance Real-time"
        });
      }

      const result = { ...briefingData, news: validatedNews, date, updatedAt: new Date().toISOString() };
      
      // Save to Firestore
      try {
        await setDoc(doc(db, "daily_news", date), result);
      } catch (e) {
        console.error("Firestore save error:", e);
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
