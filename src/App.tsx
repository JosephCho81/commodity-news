import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  ShieldCheck, 
  TrendingUp, 
  AlertCircle, 
  Loader2,
  Database,
  FileText,
  BarChart4,
  Globe,
  Activity,
  Lightbulb,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarketBriefing } from './types';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import logo from './logo.png';

const SYSTEM_INSTRUCTION = `You are a senior global metals market strategist.
Your role is to analyze global metals market data and produce a daily executive briefing for raw material procurement executives working at Korean steel producers.

[CRITICAL: LINK INTEGRITY VERIFICATION]
For every news item or source provided, you MUST perform the following 5-step verification:
1. Verify the URL is a real, active article page (not a homepage or search result).
2. Ensure the title and content match the actual article.
3. Exclude ad pages, redirect pages, or promotional content.
4. Exclude pages requiring login or subscription (Paywalls).
5. ABSOLUTELY NO "404 / Inaccessible links". Use only "Zero-confirmed original URLs".
If a link cannot be verified with 100% certainty, DO NOT include it.

Target audience: Senior purchasing managers and executives at steel companies.
Focus commodities: Aluminum, Copper, Iron Ore, Steel Scrap.

Output structure (MUST follow this JSON format):
{
  "prices": [
    {"item": "품목명", "price": "가격 정보", "note": "비고/변동사항"}
  ],
  "news": [
    {"title": "기사 제목", "summary": "핵심 요약", "url": "검증된 원본 URL", "source": "매체명"}
  ],
  "snapshot": ["bullet point 1", "bullet point 2"],
  "priceDrivers": "Explanation...",
  "aluminumOutlook": "Analysis...",
  "scrapOutlook": "Analysis...",
  "ironOreMining": "Analysis...",
  "riskSignals": "Potential risks...",
  "procurementStrategy": "Recommendation..."
}

Language: KOREAN. Professional and Analytical style.
Goal: Provide exactly 10 verified news items if possible.`;

export default function App() {
  const [briefing, setBriefing] = useState<MarketBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initApp = async () => {
      const today = new Date().toISOString().split('T')[0];
      try {
        // 1. Try to load from Firebase (Check daily_news first)
        let docRef = doc(db, 'daily_news', today);
        let docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          // Fallback to briefings for older data
          docRef = doc(db, 'briefings', today);
          docSnap = await getDoc(docRef);
        }

        if (docSnap.exists()) {
          setBriefing(docSnap.data() as MarketBriefing);
          setLoading(false);
        } else {
          // 2. If not exists, fetch from backend (which will generate and save)
          await fetchAndGenerate(today);
        }
      } catch (err) {
        console.error("Firebase/Init Error:", err);
        setError("데이터를 불러오는 중 오류가 발생했습니다.");
        setLoading(false);
      }
    };

    initApp();
  }, []);

  const fetchAndGenerate = async (date: string) => {
    setLoading(true);
    try {
      // Use the new robust backend endpoint
      const response = await fetch(`/api/generate-report?date=${date}`);
      if (!response.ok) throw new Error("Backend generation failed");
      
      const finalBriefing = await response.json();
      setBriefing(finalBriefing);
    } catch (err: any) {
      console.error("Generation Error:", err);
      setError("브리핑 생성 중 오류가 발생했습니다.");
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
            <div className="w-10 h-10 bg-white rounded flex items-center justify-center overflow-hidden">
              <img 
                src={logo} 
                alt="Company Logo" 
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">오늘의 원자재 뉴스</h1>
              <p className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold">전략적 시장 인텔리전스</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium text-gray-400">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p className="text-[10px] text-emerald-400 font-bold flex items-center justify-end gap-1">
                <Activity className="w-3 h-3" /> 실시간 분석 중
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 gap-8">
          
          {/* Main Briefing Display */}
          <div className="space-y-8">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {!briefing && !loading && !error && (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-lg border border-dashed border-gray-300">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-700">데이터를 불러올 수 없습니다</h3>
              </div>
            )}

            {loading && (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-lg border border-gray-200">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                <h3 className="text-lg font-bold text-gray-700">인텔리전스 생성 중...</h3>
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
                  {/* Prices Table */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-gray-800 px-6 py-3 flex items-center gap-2">
                      <Database className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">주요 원자재 가격 현황</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3 font-bold">품목</th>
                            <th className="px-6 py-3 font-bold">가격 (LME/글로벌 시장)</th>
                            <th className="px-6 py-3 font-bold">비고</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {briefing.prices.map((p, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900">{p.item}</td>
                              <td className="px-6 py-4 font-medium text-blue-600">{p.price}</td>
                              <td className="px-6 py-4 text-gray-500">{p.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* News Section */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-emerald-600 px-6 py-3 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">검증된 주요 시장 뉴스</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {briefing.news && briefing.news.length > 0 ? (
                        briefing.news.map((n, i) => (
                          <div key={i} className="p-6 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-1 rounded">
                                {n.source}
                              </span>
                              <a 
                                href={n.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                              >
                                원본 기사 보기 <ChevronRight className="w-3 h-3" />
                              </a>
                            </div>
                            <h3 className="text-base font-bold text-gray-900 mb-2">{n.title}</h3>
                            <p className="text-sm text-gray-600 leading-relaxed">{n.summary}</p>
                          </div>
                        ))
                      ) : (
                        <div className="p-12 text-center">
                          <p className="text-sm text-gray-500">검증된 뉴스가 없습니다. 잠시 후 다시 확인해 주세요.</p>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Snapshot */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-blue-600 px-6 py-3 flex items-center gap-2">
                      <Globe className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">글로벌 금속 시장 스냅샷</h2>
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
                        가격 변동 동인 (Price Drivers)
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.priceDrivers}</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-500" />
                        알루미늄 시장 전망
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.aluminumOutlook}</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <BarChart4 className="w-4 h-4 text-blue-500" />
                        철스크랩 시장 전망
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.scrapOutlook}</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Database className="w-4 h-4 text-blue-500" />
                        철광석 및 광산 공급 현황
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.ironOreMining}</p>
                    </div>
                  </div>

                  {/* Risk & Strategy */}
                  <div className="grid grid-cols-1 gap-6">
                    <section className="bg-amber-50 rounded-lg border border-amber-200 p-6 shadow-sm">
                      <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        리스크 신호 (Risk Signals)
                      </h3>
                      <p className="text-sm text-amber-900 leading-relaxed">{briefing.riskSignals}</p>
                    </section>

                    <section className="bg-blue-900 rounded-lg border border-blue-800 p-6 text-white shadow-lg">
                      <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4" />
                        구매 전략 인사이트 (Procurement Strategy)
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
            <span className="text-[10px] font-bold uppercase tracking-widest">전략적 인텔리전스 엔진 v2.0</span>
          </div>
          <p className="text-[10px] text-gray-400">© 2026 오늘의 원자재 뉴스. 내부 구매팀 전용.</p>
        </div>
      </footer>
    </div>
  );
}
