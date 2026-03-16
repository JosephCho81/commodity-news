import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, BarChart2, Truck, Newspaper,
  TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle, AlertCircle,
  ChevronRight, Loader2, ShieldCheck,
  Package, Ship, FileText, Activity,
} from 'lucide-react';
import { db } from './firebase';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function testConnection() {
  try { await getDocFromServer(doc(db, 'test', 'connection')); } catch {}
}
testConnection();

const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'market', label: 'Market', icon: BarChart2 },
  { id: 'supply', label: 'Supply', icon: Truck },
  { id: 'news', label: 'News', icon: Newspaper },
];

function RiskPill({ level }: { level: string | null }) {
  if (!level) return null;
  const cfg: Record<string, string> = {
    '원활': 'bg-emerald-500 text-white',
    '주의': 'bg-amber-400 text-amber-900',
    '경고': 'bg-red-500 text-white',
  };
  return (
    <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " + (cfg[level] || 'bg-gray-500 text-white')}>
      {level === '원활' ? 'LIVE MARKET' : level === '주의' ? 'CAUTION' : 'ALERT'}
    </span>
  );
}

function MetalCard({ label, price, change, unit = 'LME Cash / USD' }: {
  label: string; price: string | null; change: string | null; unit?: string;
}) {
  const isUp = change && change.includes('+');
  const isDown = change && change.includes('-');
  return (
    <div className="bg-white rounded-2xl p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        {change && (
          <span className={"text-xs font-bold px-1.5 py-0.5 rounded " +
            (isUp ? 'text-emerald-600 bg-emerald-50' : isDown ? 'text-red-500 bg-red-50' : 'text-gray-400 bg-gray-100')}>
            {change}
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-gray-900 tracking-tight">
        {price || <span className="text-gray-300 text-base">—</span>}
      </p>
      <p className="text-[10px] text-gray-400">{unit}</p>
    </div>
  );
}

export default function App() {
  const [briefing, setBriefing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('데이터 확인 중...');
  const [tab, setTab] = useState('home');
  const [logoError, setLogoError] = useState(false);

  const fetchBriefing = async () => {
    setStatusMsg('AI가 시장을 분석 중입니다...');
    try {
      const res = await fetch('/api/get-news');
      if (!res.ok) throw new Error('서버 오류: ' + res.status);
      const data = await res.json();
      if (data.status === 'cached' || data.status === 'generated') setBriefing(data);
      else throw new Error('데이터 없음');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'commodity-news', getKSTDate()));
        if (snap.exists()) { setBriefing(snap.data()); setLoading(false); }
        else await fetchBriefing();
      } catch (e: any) {
        setError(e.message); setLoading(false);
      }
    })();
  }, []);

  const al = briefing?.lme_summary?.aluminum;
  const allNews = briefing?.allNews || briefing?.key_news || [];
  const risk = briefing?.supply_chain_risk;
  const sub = briefing?.sub_materials;
  const log = briefing?.logistics;
  const expert = briefing?.expert_comment;

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@500&display=swap" rel="stylesheet" />

      {/* ── 상단 헤더 ─────────────────────────────────────────────── */}
      <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#0A1628] rounded-lg flex items-center justify-center overflow-hidden">
            {!logoError ? (
              <img src="/logo.png" alt="Logo" className="w-full h-full object-contain p-0.5"
                onError={() => setLogoError(true)} />
            ) : (
              <span className="text-green-400 font-black text-xs">A1</span>
            )}
          </div>
          <span className="font-bold text-sm text-gray-900">Anguk A-One</span>
        </div>
        <div className="text-xs text-gray-400">
          {new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' })}
        </div>
      </header>

      {/* ── 메인 콘텐츠 ──────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pb-20">
        {error && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-sm text-gray-500">{statusMsg}</p>
          </div>
        )}

        {briefing && (
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}>

              {/* ══ HOME 탭 ══════════════════════════════════════════ */}
              {tab === 'home' && (
                <div>
                  {/* 히어로 — 네이비 다크 */}
                  <div className="bg-[#0A1628] px-5 pt-6 pb-8 relative overflow-hidden">
                    {/* 배경 바 그래프 장식 */}
                    <div className="absolute right-0 bottom-0 flex items-end gap-1 opacity-20 pr-4 pb-0">
                      {[40, 55, 45, 65, 58, 72, 80].map((h, i) => (
                        <div key={i} className="w-5 bg-blue-400 rounded-t"
                          style={{ height: h + 'px' }} />
                      ))}
                    </div>

                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-blue-300 font-medium tracking-wider uppercase">전일 LME 기준</p>
                        <RiskPill level={risk?.level} />
                      </div>
                      <h2 className="text-2xl font-bold text-white mb-1">Aluminum</h2>
                      <div className="flex items-end gap-3 mb-4">
                        <span className="text-4xl font-bold text-white tracking-tight" style={{ fontFamily: "'DM Mono', monospace" }}>
                          {al?.price || '—'}
                        </span>
                        {al?.price && <span className="text-sm text-blue-300 mb-1">USD/mt</span>}
                        {al?.change && (
                          <span className={"text-sm font-bold mb-1 " + (al.change.includes('+') ? 'text-emerald-400' : 'text-red-400')}>
                            {al.change}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 전문가 코멘트 카드 */}
                    {expert ? (
                      <div className="relative z-10 bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/10">
                        <div className="flex items-start gap-3">
                          <div className="text-blue-300 text-2xl font-serif leading-none mt-1">"</div>
                          <div>
                            <p className="text-xs text-blue-200 mb-1">현장 제언 · 안국에이원 조정호</p>
                            <p className="text-sm text-white font-medium leading-relaxed">
                              {expert.text}
                            </p>
                          </div>
                        </div>
                        <button onClick={() => setTab('market')}
                          className="mt-3 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-1">
                          전문 읽기 <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative z-10 bg-white/10 rounded-2xl p-4 border border-white/10">
                        <p className="text-xs text-blue-300 mb-1">현장 제언 · 안국에이원 조정호</p>
                        <p className="text-sm text-blue-200 italic">오늘의 현장 제언이 준비 중입니다.</p>
                      </div>
                    )}
                  </div>

                  {/* 주요 금속 시세 */}
                  <div className="px-4 mt-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-sm text-gray-900">주요 금속 시세</h3>
                      <button onClick={() => setTab('market')}
                        className="text-xs text-blue-500 font-medium flex items-center gap-0.5">
                        전체보기 <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Copper', data: briefing.lme_summary?.copper },
                        { label: 'Zinc', data: briefing.lme_summary?.zinc },
                      ].map(({ label, data }) => (
                        <MetalCard key={label} label={label}
                          price={data?.price} change={data?.change} />
                      ))}
                    </div>
                  </div>

                  {/* 물류 현황 미리보기 */}
                  {(log?.freight || log?.customs) && (
                    <div className="px-4 mt-4">
                      <div className="bg-white rounded-2xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Ship className="w-4 h-4 text-blue-500" />
                          <span className="text-sm font-bold text-gray-900">물류 현황 (In-Transit)</span>
                        </div>
                        {log.freight && (
                          <p className="text-xs text-gray-600 leading-relaxed mb-2">{log.freight}</p>
                        )}
                        {log.customs && (
                          <p className="text-xs text-gray-500 leading-relaxed">{log.customs}</p>
                        )}
                        <button onClick={() => setTab('supply')}
                          className="mt-3 text-xs text-blue-500 font-medium flex items-center gap-0.5">
                          상세보기 <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 공급망 리스크 */}
                  {risk?.reason && (
                    <div className="px-4 mt-3 pb-4">
                      <div className={"rounded-2xl p-4 flex items-start gap-3 " +
                        (risk.level === '경고' ? 'bg-red-50' : risk.level === '주의' ? 'bg-amber-50' : 'bg-emerald-50')}>
                        {risk.level === '원활'
                          ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          : <AlertTriangle className={"w-4 h-4 shrink-0 mt-0.5 " + (risk.level === '경고' ? 'text-red-500' : 'text-amber-500')} />}
                        <div>
                          <p className={"text-xs font-bold mb-1 " +
                            (risk.level === '경고' ? 'text-red-600' : risk.level === '주의' ? 'text-amber-600' : 'text-emerald-600')}>
                            공급망 {risk.level}
                          </p>
                          <p className="text-xs text-gray-600 leading-relaxed">{risk.reason}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══ MARKET 탭 ════════════════════════════════════════ */}
              {tab === 'market' && (
                <div className="px-4 pt-5 pb-4 space-y-4">
                  <h2 className="font-bold text-base text-gray-900">부원료 레이더</h2>

                  {/* 전문가 코멘트 풀버전 */}
                  {expert && (
                    <div className="bg-[#0A1628] rounded-2xl p-5">
                      <p className="text-xs text-blue-300 font-medium mb-2">안국에이원 조정호 · 현장 제언</p>
                      <div className="text-blue-100 text-2xl font-serif mb-2">"</div>
                      <p className="text-sm text-white leading-relaxed font-medium">{expert.text}</p>
                      <p className="text-[10px] text-blue-400 mt-3">
                        {new Date(expert.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                      </p>
                    </div>
                  )}

                  {/* 부원료 3개 */}
                  {[
                    { key: 'al_scrap', label: '알루미늄 스크랩', color: 'blue' },
                    { key: 'carburizer', label: '가탄제 (소괴탄 · 분탄)', color: 'amber' },
                    { key: 'ferro_silicon', label: '페로실리콘 (FeSi)', color: 'purple' },
                  ].map(({ key, label, color }) => {
                    const value = sub?.[key];
                    const colorMap: Record<string, string> = {
                      blue: 'border-blue-100 bg-blue-50',
                      amber: 'border-amber-100 bg-amber-50',
                      purple: 'border-purple-100 bg-purple-50',
                    };
                    const labelMap: Record<string, string> = {
                      blue: 'text-blue-600',
                      amber: 'text-amber-600',
                      purple: 'text-purple-600',
                    };
                    return (
                      <div key={key} className={"rounded-2xl border p-4 " + colorMap[color]}>
                        <p className={"text-xs font-bold uppercase tracking-wider mb-2 " + labelMap[color]}>{label}</p>
                        {value
                          ? <p className="text-sm text-gray-700 leading-relaxed">{value}</p>
                          : <p className="text-xs text-gray-400">관련 뉴스 없음</p>}
                      </div>
                    );
                  })}

                  {/* LME 전체 */}
                  <h3 className="font-bold text-sm text-gray-900 pt-2">LME 전일 종가</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Aluminum', data: briefing.lme_summary?.aluminum },
                      { label: 'Copper', data: briefing.lme_summary?.copper },
                      { label: 'Zinc', data: briefing.lme_summary?.zinc },
                    ].map(({ label, data }) => (
                      <MetalCard key={label} label={label}
                        price={data?.price} change={data?.change} />
                    ))}
                  </div>
                </div>
              )}

              {/* ══ SUPPLY 탭 ════════════════════════════════════════ */}
              {tab === 'supply' && (
                <div className="px-4 pt-5 pb-4 space-y-4">
                  <h2 className="font-bold text-base text-gray-900">공급망 & 물류</h2>

                  {/* 리스크 레벨 */}
                  {risk && (
                    <div className={"rounded-2xl p-4 flex items-start gap-3 " +
                      (risk.level === '경고' ? 'bg-red-50 border border-red-200' :
                       risk.level === '주의' ? 'bg-amber-50 border border-amber-200' :
                       'bg-emerald-50 border border-emerald-200')}>
                      {risk.level === '원활'
                        ? <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                        : <AlertTriangle className={"w-5 h-5 shrink-0 mt-0.5 " + (risk.level === '경고' ? 'text-red-500' : 'text-amber-500')} />}
                      <div>
                        <p className={"text-sm font-bold mb-1 " +
                          (risk.level === '경고' ? 'text-red-700' : risk.level === '주의' ? 'text-amber-700' : 'text-emerald-700')}>
                          공급망 {risk.level || 'N/A'}
                        </p>
                        {risk.reason && <p className="text-sm text-gray-600 leading-relaxed">{risk.reason}</p>}
                      </div>
                    </div>
                  )}

                  {/* 물류 */}
                  <div className="bg-white rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Ship className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-bold text-gray-900">해상운임 · 물류</span>
                    </div>
                    {log?.freight
                      ? <p className="text-sm text-gray-600 leading-relaxed">{log.freight}</p>
                      : <p className="text-xs text-gray-400">관련 뉴스 없음</p>}
                  </div>

                  {/* 관세 */}
                  <div className="bg-white rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-bold text-gray-900">관세 · 통관</span>
                    </div>
                    {log?.customs
                      ? <p className="text-sm text-gray-600 leading-relaxed">{log.customs}</p>
                      : <p className="text-xs text-gray-400">관련 뉴스 없음</p>}
                  </div>

                  {/* 면책 */}
                  {briefing.disclaimer && (
                    <p className="text-[10px] text-gray-300 text-center leading-relaxed px-2">{briefing.disclaimer}</p>
                  )}
                </div>
              )}

              {/* ══ NEWS 탭 ══════════════════════════════════════════ */}
              {tab === 'news' && (
                <div className="px-4 pt-5 pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-base text-gray-900">뉴스</h2>
                    <span className="text-xs text-gray-400">{allNews.length}건</span>
                  </div>
                  <div className="space-y-3">
                    {allNews.map((n: any, i: number) => (
                      <div key={i} className="bg-white rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase">
                            {n.source}
                          </span>
                          {n.url && (
                            <a href={n.url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-gray-400 hover:text-blue-500 flex items-center gap-0.5">
                              원문 <ChevronRight className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-1">{n.title}</h3>
                        {n.summary && (
                          <p className="text-xs text-gray-500 leading-relaxed">{n.summary}</p>
                        )}
                        {n.relevance && (
                          <div className="mt-2 flex items-start gap-1.5">
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">업계 영향</span>
                            <p className="text-xs text-amber-700 leading-relaxed">{n.relevance}</p>
                          </div>
                        )}
                      </div>
                    ))}
                    {allNews.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-12">뉴스 데이터 없음</p>
                    )}
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* ── 바텀 탭 네비게이션 ────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={"flex-1 flex flex-col items-center gap-1 py-3 transition-colors " +
              (tab === id ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600')}>
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

