import React, { useState, useEffect } from 'react';
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
  ChevronRight,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarketBriefing } from './types';
import { db } from './firebase';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';

// ── KST 기준 오늘 날짜 (YYYY-MM-DD) ──────────────────────────────────────
function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection successful");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    } else {
      console.error("Firestore connection test error:", error);
    }
  }
}
testConnection();

export default function App() {
  const [briefing, setBriefing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("데이터 확인 중...");

  const generateBriefing = async () => {
    setStatusMsg("AI가 시장을 분석 중입니다 (약 15~25초 소요)...");
    try {
      const response = await fetch('/api/get-news');
      if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
      }
      const data = await response.json();
      if (data.status === 'cached' || data.status === 'generated') {
        setBriefing(data);
      } else {
        throw new Error('브리핑 데이터를 받지 못했습니다');
      }
    } catch (err: any) {
      console.error("Generation Error:", err);
      setError("브리핑 생성 중 오류가 발생했습니다. API 할당량이나 연결을 확인해주세요.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initApp = async () => {
      try {
        setStatusMsg("오늘의 리포트를 확인하고 있습니다...");
        const today = getKSTDate();
        const docRef = doc(db, "commodity-news", today);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          console.log("파이어베이스에서 기존 데이터를 불러왔습니다.");
          setBriefing(docSnap.data());
          setLoading(false);
        } else {
          console.log("새로운 리포트를 생성합니다.");
          await generateBriefing();
        }
      } catch (err: any) {
        console.error("Init Error:", err);
        setError("데이터를 불러오는 중 오류가 발생했습니다: " + (err.message || "알 수 없는 오류"));
        setLoading(false);
      }
    };
    initApp();
  }, []);

  // 표시할 뉴스: allNews(전체) 있으면 우선, 없으면 news(분석용) 사용
  const displayNews = briefing?.allNews || briefing?.news || [];

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-[#1F2937] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-[#111827] text-white border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 로고 — public/logo.png 절대경로로 로드 */}
            <div className="w-10 h-10 bg-white rounded flex items-center justify-center overflow-hidden shrink-0">
              <img
                src="/logo.png"
                alt="Logo"
                className="w-full h-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">오늘의 원자재 뉴스</h1>
              <p className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold">전략적 시장 인텔리전스</p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-gray-400">
              {new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 gap-8">
          <div className="space-y-8">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {loading && (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-lg border border-gray-200">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                <h3 className="text-lg font-bold text-gray-700">{statusMsg}</h3>
                <p className="text-sm text-gray-500 max-w-xs mt-2">
                  글로벌 거시 지표와 뉴스 데이터를 분석하여 전략적 인사이트를 도출하고 있습니다. 하루에 한 번만 생성됩니다.
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
                    <div className="bg-gray-800 px-6 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-white" />
                        <h2 className="text-white font-bold text-sm uppercase tracking-wider">주요 원자재 가격 현황</h2>
                      </div>
                      {/* 가격 추정치 안내 배지 */}
                      <div className="flex items-center gap-1 bg-yellow-500 bg-opacity-20 border border-yellow-400 border-opacity-40 rounded px-2 py-1">
                        <Info className="w-3 h-3 text-yellow-300" />
                        <span className="text-[10px] text-yellow-300 font-medium">AI 추정치 — 실제 가격과 다를 수 있습니다</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3 font-bold">품목</th>
                            <th className="px-6 py-3 font-bold">가격</th>
                            <th className="px-6 py-3 font-bold">비고</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {briefing.prices?.map((p: any, i: number) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900 whitespace-pre-line">{p.item}</td>
                              <td className="px-6 py-4 font-medium text-blue-600 whitespace-pre-line">{p.price}</td>
                              <td className="px-6 py-4 text-gray-500">{p.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Snapshot */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-blue-600 px-6 py-3 flex items-center gap-2">
                      <Globe className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">글로벌 시장 현황</h2>
                    </div>
                    <div className="p-6">
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {briefing.snapshot?.map((point: string, i: number) => (
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
                        가격 변동 동인
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
                        구리 시장 전망
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.copperOutlook}</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Database className="w-4 h-4 text-blue-500" />
                        아연 시장 전망
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{briefing.zincOutlook}</p>
                    </div>
                  </div>

                  {/* Risk & Strategy */}
                  <div className="grid grid-cols-1 gap-6">
                    <section className="bg-amber-50 rounded-lg border border-amber-200 p-6 shadow-sm">
                      <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        리스크 신호
                      </h3>
                      <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-line">{briefing.riskSignals}</p>
                    </section>
                    <section className="bg-blue-900 rounded-lg border border-blue-800 p-6 text-white shadow-lg">
                      <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4" />
                        구매 전략 인사이트
                      </h3>
                      <p className="text-base font-medium leading-relaxed italic">"{briefing.procurementStrategy}"</p>
                    </section>
                  </div>

                  {/* 전체 뉴스 섹션 — allNews 우선, 없으면 news */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-emerald-600 px-6 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-white" />
                        <h2 className="text-white font-bold text-sm uppercase tracking-wider">주요 시장 뉴스</h2>
                      </div>
                      <span className="text-[10px] text-emerald-100 font-medium">{displayNews.length}건</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {displayNews.length > 0 ? (
                        displayNews.map((n: any, i: number) => (
                          <div key={i} className="p-6 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-1 rounded">
                                {n.source}
                              </span>
                              {n.url && (
                                <a
                                  href={n.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  원본 기사 보기 <ChevronRight className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <h3 className="text-base font-bold text-gray-900 mb-2">{n.title}</h3>
                            {n.summary && (
                              <p className="text-sm text-gray-600 leading-relaxed">{n.summary}</p>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="p-12 text-center">
                          <p className="text-sm text-gray-500">뉴스가 없습니다. 잠시 후 다시 확인해 주세요.</p>
                        </div>
                      )}
                    </div>
                  </section>
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
            <span className="text-[10px] font-bold uppercase tracking-widest">전략적 인텔리전스 엔진 v2.1</span>
          </div>
          <p className="text-[10px] text-gray-400">© 2026 오늘의 원자재 뉴스. 내부 구매팀 전용.</p>
        </div>
      </footer>
    </div>
  );
}

