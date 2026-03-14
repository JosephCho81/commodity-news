import React, { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  ShieldCheck, 
  TrendingUp, 
  AlertCircle, 
  Loader2,
  Database,
  Zap,
  RefreshCw,
  FileText,
  BarChart4,
  Globe,
  Activity,
  Lightbulb,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarketBriefing, PriceData, NewsArticleInput } from './types';

const SAMPLE_PRICES: PriceData[] = [
  { commodity: "Aluminum (LME)", price: "$2,650", changePercent: "+1.2%" },
  { commodity: "Copper (LME)", price: "$9,820", changePercent: "-0.5%" },
  { commodity: "Iron Ore (62% Fe)", price: "$115", changePercent: "+2.1%" },
  { commodity: "Steel Scrap (HMS 1/2)", price: "$385", changePercent: "0.0%" }
];

const SAMPLE_NEWS: NewsArticleInput[] = [
  {
    title: "China Steel Demand Shows Signs of Recovery as Infrastructure Spending Picks Up",
    source: "Reuters",
    url: "https://www.reuters.com/markets/commodities/china-steel-demand-2026-03-14",
    published_at: new Date().toISOString(),
    content_snippet: "Beijing's latest stimulus measures are starting to impact the real economy, with steel consumption in the construction sector rising for the third consecutive week."
  },
  {
    title: "Major Iron Ore Mine in Brazil Faces Temporary Logistics Disruption",
    source: "Bloomberg",
    url: "https://www.bloomberg.com/news/articles/brazil-mine-logistics-2026-03-14",
    published_at: new Date().toISOString(),
    content_snippet: "Heavy rainfall has damaged a key rail link connecting Vale's northern system to the port, potentially delaying shipments of high-grade iron ore for up to 10 days."
  },
  {
    title: "European Aluminum Smelters Warn of Production Cuts Amid Rising Energy Costs",
    source: "Financial Times",
    url: "https://www.ft.com/content/europe-aluminum-energy-costs",
    published_at: new Date().toISOString(),
    content_snippet: "Natural gas price spikes are once again threatening the viability of energy-intensive aluminum smelting in Germany and France, raising supply tightness concerns."
  }
];

const SYSTEM_INSTRUCTION = `You are a senior global metals market strategist.
Your role is to analyze global metals market data and produce a daily executive briefing for raw material procurement executives working at Korean steel producers.

Target audience: Senior purchasing managers and executives at steel companies (integrated and EAF).

Focus commodities: Aluminum, Copper, Iron Ore, Steel Scrap, Ferrous raw materials, Global mining supply, Energy and logistics.

Analysis principles:
1. Identify macro drivers behind price movement.
2. Connect news events to supply-demand impact.
3. Identify potential risks to raw material supply.
4. Highlight short-term market direction.
5. Provide procurement insights for steel producers.

Prioritize: China steel demand, Global scrap flows, Mining disruptions, Energy prices, Geopolitics, Logistics, Production changes, Government policy.

Output structure (MUST follow this JSON format):
{
  "snapshot": ["bullet point 1", "bullet point 2", ...],
  "priceDrivers": "Explanation of price movements...",
  "aluminumOutlook": "Supply, demand, and direction...",
  "scrapOutlook": "Global flows and EAF demand...",
  "ironOreMining": "Mining production and Chinese demand...",
  "riskSignals": "Potential risks...",
  "procurementStrategy": "Recommendation for purchasing teams..."
}

Writing style: Professional, Analytical, Concise, Executive-level.
Language: Write in KOREAN.
Length: 400–700 Korean characters in total across all fields.
Avoid generic summaries. Focus on actionable insights.`;

export default function App() {
  const [priceInput, setPriceInput] = useState<string>(JSON.stringify(SAMPLE_PRICES, null, 2));
  const [newsInput, setNewsInput] = useState<string>(JSON.stringify(SAMPLE_NEWS, null, 2));
  const [briefing, setBriefing] = useState<MarketBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateBriefing = async () => {
    setLoading(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Analyze this data:\nPrices: ${priceInput}\nNews: ${newsInput}`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              snapshot: { type: Type.ARRAY, items: { type: Type.STRING } },
              priceDrivers: { type: Type.STRING },
              aluminumOutlook: { type: Type.STRING },
              scrapOutlook: { type: Type.STRING },
              ironOreMining: { type: Type.STRING },
              riskSignals: { type: Type.STRING },
              procurementStrategy: { type: Type.STRING },
            }
          }
        }
      });

      const data = JSON.parse(response.text || '{}');
      setBriefing(data);
    } catch (err) {
      console.error(err);
      setError("브리핑 생성에 실패했습니다. 입력 데이터를 확인해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-[#1F2937] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-[#111827] text-white border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">METALS STRATEGIST</h1>
              <p className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold">Executive Market Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium text-gray-400">Status</p>
              <p className="text-[10px] text-emerald-400 font-bold flex items-center justify-end gap-1">
                <Activity className="w-3 h-3" /> LIVE ANALYSIS
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Data Input */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold flex items-center gap-2 text-sm uppercase tracking-wider text-gray-500">
                  <Database className="w-4 h-4" />
                  Market Data Input
                </h2>
                <button 
                  onClick={() => {
                    setPriceInput(JSON.stringify(SAMPLE_PRICES, null, 2));
                    setNewsInput(JSON.stringify(SAMPLE_NEWS, null, 2));
                  }}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Reset
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Commodity Prices</label>
                  <textarea
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="w-full h-32 bg-gray-50 border border-gray-200 rounded p-3 font-mono text-[11px] focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Global News Feed</label>
                  <textarea
                    value={newsInput}
                    onChange={(e) => setNewsInput(e.target.value)}
                    className="w-full h-48 bg-gray-50 border border-gray-200 rounded p-3 font-mono text-[11px] focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none"
                  />
                </div>
              </div>

              <button
                onClick={generateBriefing}
                disabled={loading}
                className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    GENERATE BRIEFING
                  </>
                )}
              </button>
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded flex items-start gap-2 text-red-600 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </section>

            <section className="bg-gray-800 rounded-lg p-6 text-white shadow-lg">
              <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">Strategic Focus</h3>
              <ul className="space-y-3">
                {[
                  "Macro Driver Identification",
                  "Supply-Demand Correlation",
                  "Risk Signal Detection",
                  "Procurement Actionability"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-gray-300">
                    <ShieldCheck className="w-3 h-3 text-blue-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Right Column: Briefing Output */}
          <div className="lg:col-span-8 space-y-6">
            {!briefing && !loading && (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-lg border border-dashed border-gray-300">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-700">No Briefing Generated</h3>
                <p className="text-sm text-gray-500 max-w-xs mt-2">
                  입력 데이터를 바탕으로 전략적 시장 브리핑을 생성하려면 왼쪽의 버튼을 클릭하세요.
                </p>
              </div>
            )}

            {loading && (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-lg border border-gray-200">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                <h3 className="text-lg font-bold text-gray-700">Generating Intelligence...</h3>
                <p className="text-sm text-gray-500 max-w-xs mt-2">
                  글로벌 거시 지표와 뉴스 데이터를 분석하여 전략적 인사이트를 도출하고 있습니다.
                </p>
              </div>
            )}

            {briefing && (
              <AnimatePresence mode="wait">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  {/* Snapshot */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-blue-600 px-6 py-3 flex items-center gap-2">
                      <Globe className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">Global Metals Market Snapshot</h2>
                    </div>
                    <div className="p-6">
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {briefing.snapshot.map((point, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                            <ChevronRight className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>

                  {/* Main Content Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                        Price Movement Drivers
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.priceDrivers}</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-500" />
                        Aluminum Market Outlook
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.aluminumOutlook}</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <BarChart4 className="w-4 h-4 text-blue-500" />
                        Steel Scrap Market Outlook
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.scrapOutlook}</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Database className="w-4 h-4 text-blue-500" />
                        Iron Ore & Mining Supply
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.ironOreMining}</p>
                    </div>
                  </div>

                  {/* Risk & Strategy */}
                  <div className="grid grid-cols-1 gap-6">
                    <section className="bg-amber-50 rounded-lg border border-amber-200 p-6 shadow-sm">
                      <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Risk Signals
                      </h3>
                      <p className="text-sm text-amber-900 leading-relaxed">{briefing.riskSignals}</p>
                    </section>

                    <section className="bg-blue-900 rounded-lg border border-blue-800 p-6 text-white shadow-lg">
                      <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4" />
                        Procurement Strategy Insight
                      </h3>
                      <p className="text-base font-medium leading-relaxed italic">"{briefing.procurementStrategy}"</p>
                    </section>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-8 border-t border-gray-200 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-400">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Strategic Intelligence Engine v2.0</span>
          </div>
          <p className="text-[10px] text-gray-400">© 2026 Metals Market Strategist. For internal procurement use only.</p>
        </div>
      </footer>
    </div>
  );
}
