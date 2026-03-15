import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import generateNewsHandler from "./api/collect-news.js";
import getNewsHandler from "./api/get-news.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Use the handlers from the /api folder as requested
  app.get("/api/collect-news", (req, res) => generateNewsHandler(req, res));
  app.get("/api/generate-news", (req, res) => generateNewsHandler(req, res));
  app.get("/api/get-news", (req, res) => getNewsHandler(req, res));

  // Legacy endpoint for backward compatibility with frontend
  app.get("/api/generate-report", (req, res) => generateNewsHandler(req, res));

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
