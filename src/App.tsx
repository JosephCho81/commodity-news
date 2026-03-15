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
  ChevronRight,
  Search,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarketBriefing } from './types';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
// import logo from './logo.png';

const SYSTEM_INSTRUCTION = `당신은 글로벌 원자재 시장 전략가입니다. 
다음 글로벌 원자재 뉴스와 실시간 검색 결과를 분석하여 한국 제강사 원료구매팀 임원 보고용 시장 리포트를 작성하십시오.

[필수 가격 조사 항목 - 실시간 검색 도구 사용 필수]
1. LME Aluminum: https://www.lme.com/metals/non-ferrous/lme-aluminium#Trading+summary 페이지의 'Trading summary' 표에서 가장 최신 날짜의 'Cash Bid' 가격을 정확히 찾으십시오. (현재 약 $3,500대)
2. 조달청 알루미늄 (PPS Aluminum): https://pps.go.kr/bichuk/bbs/list.do?key=00825 페이지에서 최신 날짜의 '서구산' 알루미늄 방출 가격을 찾으십시오. 
3. LME Copper: https://www.lme.com/metals/non-ferrous/lme-copper#Trading+summary 페이지의 'Trading summary' 표에서 가장 최신 날짜의 'Cash Bid' 가격을 정확히 찾으십시오. (현재 약 $12,700대)
4. LME Zinc: https://www.lme.com/metals/non-ferrous/lme-zinc#Summary 페이지에서 가장 최신 날짜의 'Cash Bid' 가격을 찾으십시오.

[지침]
1. 모든 응답은 반드시 한국어로 작성하십시오.
2. 해외 뉴스 제목과 요약은 반드시 한국어로 번역하십시오.
3. **중요: 뉴스 링크 (url)**는 반드시 클릭 가능한 실제 유효한 URL이어야 합니다. 검색 도구를 통해 얻은 실제 기사 주소를 기입하십시오.
4. "prices" 섹션에는 위 4가지 항목만 포함하십시오.
5. **중요: 조달청 알루미늄 항목의 경우**
   - item 명칭은 반드시 "조달청 알루미늄\\n(서구산)"으로 작성하십시오. (줄바꿈 문자 \\n 포함)
   - price 값은 반드시 "가격원\\n(부가세 포함)" 형식으로 작성하십시오. (예: "3,450,000원\\n(부가세 포함)")
6. 가격이 검색되지 않는다면 'N/A'라고 적지 말고, 가장 최근의 시장 추정치라도 검색하여 기입하십시오.
7. "note" 필드에는 해당 품목의 가격 등락 원인이나 특이사항을 한 문장으로 간략히 적으십시오.
8. "snapshot" 섹션에는 현재 시장의 가장 중요한 핵심 이슈 5가지를 리스트로 작성하십시오.
9. **중요: 리스크 신호 (riskSignals) 섹션**은 반드시 다음 4가지 항목을 줄바꿈 문자(\\n)를 사용하여 구분하십시오:
   1. 중동 분쟁 장기화에 따른 물류비 급증\n2. 미국발 관세 전쟁 본격화\n3. 고금리 장기화에 따른 실물 수요 위축 가능성\n4. 중국의 전격적인 수출 제한 조치 가능성
10. 반드시 아래 JSON 구조를 엄격히 지켜서 응답하십시오. 모든 필드를 반드시 포함하십시오.

JSON 구조 예시:
{
  "prices": [
    { "item": "LME Aluminum", "price": "$3,519", "note": "재고 감소로 인한 상승세" },
    { "item": "조달청 알루미늄\\n(서구산)", "price": "3,450,000원\\n(부가세 포함)", "note": "환율 상승 반영" },
    { "item": "LME Copper", "price": "$12,757", "note": "공급 부족 우려 심화" },
    { "item": "LME Zinc", "price": "$2,450", "note": "공급 과잉 우려로 하락" }
  ],
  "news": [
    { "title": "제공된 뉴스 데이터의 제목을 한국어로 번역", "summary": "해당 뉴스의 핵심 내용을 1~2문장으로 요약", "url": "제공된 뉴스 데이터의 원본 URL (절대 수정 금지)", "source": "출처" }
  ],
  "snapshot": ["이슈1", "이슈2", "이슈3", "이슈4", "이슈5"],
  "priceDrivers": "가격 변동 동인 내용...",
  "aluminumOutlook": "알루미늄 전망 내용...",
  "copperOutlook": "구리 전망 내용...",
  "zincOutlook": "아연 전망 내용...",
  "riskSignals": "1. 중동 분쟁...\\n2. 미국발...\\n3. 고금리...\\n4. 중국의...",
  "procurementStrategy": "구매 전략 인사이트 내용..."
}
`;

export default function App() {
  const [briefing, setBriefing] = useState<MarketBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("데이터 확인 중...");

  useEffect(() => {
    const initApp = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        setStatusMsg("오늘의 리포트를 확인하고 있습니다...");
        
        // 1. 파이어베이스에서 오늘 데이터가 있는지 먼저 확인 (임시로 캐시 우회하여 새로 생성 강제)
        const docRef = doc(db, "commodity-news", today);
        const docSnap = await getDoc(docRef);

        // "지금에 한해서" 캐시를 무시하고 새로 생성하도록 수정 (한 번 생성 후 다시 원복 예정)
        const forceRefresh = false; 

        if (docSnap.exists() && !forceRefresh) {
          console.log("파이어베이스에서 기존 데이터를 불러왔습니다.");
          setBriefing(docSnap.data() as MarketBriefing);
          setLoading(false);
        } else {
          // 2. 없거나 강제 새로고침인 경우 뉴스 수집 및 생성 시작
          console.log("새로운 리포트를 생성합니다.");
          const response = await fetch('/api/generate-news');
          const data = await response.json();
          await generateBriefing(data.news);
        }
      } catch (err) {
        console.error("Init Error:", err);
        setError("데이터를 불러오는 중 오류가 발생했습니다. 파이어베이스 연결을 확인해주세요.");
        setLoading(false);
      }
    };

    initApp();
  }, []);

  const generateBriefing = async (newsItems: any[]) => {
    setStatusMsg("AI가 실시간 가격을 검색하고 시장을 분석 중입니다 (약 15~25초 소요)...");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `
        오늘 날짜: ${new Date().toLocaleDateString()}
        
        다음 뉴스 데이터와 실시간 구글 검색을 통해 리포트를 작성하라.
        특히 다음 4가지 가격을 반드시 검색하여 정확히 기입하라 (LME 사이트의 Trading summary 섹션 확인):
        1. LME Aluminum (Cash Bid) - 현재 약 $3,519 수준인지 확인
        2. 조달청 알루미늄 (서구산, 부가세 포함, 원화)
        3. LME Copper (Cash Bid) - 현재 약 $12,757 수준인지 확인
        4. LME Zinc (Cash Bid)
        
        뉴스 데이터 (이 데이터에 포함된 모든 항목을 'news' 섹션에 포함하고, 제목과 요약은 한국어로 번역하여 작성하라. URL은 절대 변경하지 마라):
        ${JSON.stringify(newsItems)}
      `;

      const result = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }]
        }
      });

      const briefingData = JSON.parse(result.text || "{}");
      
      const today = new Date().toISOString().slice(0, 10);
      const finalBriefing = {
        ...briefingData,
        date: today,
        updatedAt: new Date().toISOString()
      };

      try {
        await setDoc(doc(db, "commodity-news", today), finalBriefing);
        console.log("새로운 리포트가 파이어베이스에 저장되었습니다.");
      } catch (e) {
        console.error("파이어베이스 저장 실패:", e);
      }

      setBriefing(finalBriefing);
    } catch (err) {
      console.error("Generation Error:", err);
      setError("브리핑 생성 중 오류가 발생했습니다. API 할당량이나 연결을 확인해주세요.");
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
                src="logo.png" 
                alt="Company Logo" 
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  console.log("Logo load failed, trying absolute path");
                  const target = e.target as HTMLImageElement;
                  if (target.src.includes("logo.png") && !target.src.startsWith("http")) {
                    target.src = window.location.origin + "/logo.png";
                  } else {
                    target.src = "https://picsum.photos/seed/metal/100/100";
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-4">
              <div>
                <h1 className="font-bold text-lg tracking-tight">오늘의 원자재 뉴스</h1>
                <p className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold">전략적 시장 인텔리전스</p>
              </div>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-gray-400">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
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
                    <div className="bg-gray-800 px-6 py-3 flex items-center gap-2">
                      <Database className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">주요 원자재 가격 현황</h2>
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
                          {briefing.prices?.map((p, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900 whitespace-pre-line">
                                {p.item}
                              </td>
                              <td className="px-6 py-4 font-medium text-blue-600 whitespace-pre-line">
                                {p.price}
                              </td>
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
                        {briefing.snapshot?.map((point, i) => (
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

                  {/* News Section - Moved to Bottom */}
                  <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-emerald-600 px-6 py-3 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-white" />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wider">주요 시장 뉴스</h2>
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
