import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, BarChart2, Network, Newspaper,
  TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle, AlertCircle,
  ChevronRight, Loader2, Ship, FileText, Anchor,
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
  { id: 'home', label: '주요 원자재', icon: Home },
  { id: 'market', label: '제강사 부원료', icon: BarChart2 },
  { id: 'supply', label: '공급망', icon: Network },
  { id: 'news', label: '뉴스', icon: Newspaper },
];

function RiskPill({ level }: { level: string | null }) {
  if (!level) return null;
  const cfg: Record<string, string> = {
    '원활': 'bg-emerald-500 text-white',
    '주의': 'bg-amber-400 text-amber-900',
    '경고': 'bg-red-500 text-white',
  };
  const label: Record<string, string> = {
    '원활': 'NORMAL', '주의': 'CAUTION', '경고': 'ALERT',
  };
  return (
    <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap " + (cfg[level] || 'bg-gray-500 text-white')}>
      {label[level] || level}
    </span>
  );
}

// 변동 태그
function ChangeTag({ change, size = 'sm' }: { change: string | null; size?: 'sm' | 'xs' }) {
  if (!change) return <span className="text-gray-300 text-xs">—</span>;
  const isUp = change.includes('+');
  const isDown = change.includes('-');
  const base = size === 'xs' ? 'text-[10px]' : 'text-xs';
  return (
    <span className={"font-bold px-1.5 py-0.5 rounded whitespace-nowrap " + base + " " +
      (isUp ? 'text-red-500 bg-red-50' : isDown ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 bg-gray-100')}>
      {change}
    </span>
  );
}

// LME 가격 카드 — 숫자 크기 조정
function MetalCard({ label, price, change, changeReason, source }: {
  label: string; price: string | null; change: string | null;
  changeReason?: string | null; source?: string | null;
}) {
  const isUp = change && change.includes('+');
  const isDown = change && change.includes('-');
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        {change && (
          <span className={"text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap " +
            (isUp ? 'text-red-500 bg-red-50' : isDown ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 bg-gray-100')}>
            {change}
          </span>
        )}
      </div>
      {/* 숫자 크기 줄임: text-4xl → text-2xl */}
      <p className="text-2xl font-bold text-gray-900 tracking-tight whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>
        {price || <span className="text-gray-300 text-base font-sans">—</span>}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5">LME Cash / USD</p>
      {source && <p className="text-[10px] text-blue-400 mt-0.5">{source}</p>}
      {changeReason && (
        <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-2 mt-2">
          {changeReason}
        </p>
      )}
    </div>
  );
}

// 보고서 섹션 컴포넌트
function ReportSection({ title, content, color = 'blue' }: {
  title: string; content: string | null; color?: 'blue' | 'amber' | 'purple' | 'gray';
}) {
  const colorMap: Record<string, { border: string; bg: string; label: string; text: string }> = {
    blue: { border: 'border-blue-200', bg: 'bg-blue-50', label: 'text-blue-700', text: 'text-gray-700' },
    amber: { border: 'border-amber-200', bg: 'bg-amber-50', label: 'text-amber-700', text: 'text-gray-700' },
    purple: { border: 'border-purple-200', bg: 'bg-purple-50', label: 'text-purple-700', text: 'text-gray-700' },
    gray: { border: 'border-gray-200', bg: 'bg-gray-50', label: 'text-gray-600', text: 'text-gray-700' },
  };
  const c = colorMap[color];
  return (
    <div className={"rounded-xl border " + c.border + " " + c.bg + " overflow-hidden"}>
      <div className={"px-4 py-2.5 border-b " + c.border}>
        <p className={"text-xs font-bold uppercase tracking-wider " + c.label}>{title}</p>
      </div>
      <div className="px-4 py-3">
        {content
          ? <p className={"text-sm leading-relaxed " + c.text}>{content}</p>
          : <p className="text-xs text-gray-400">관련 데이터 수집 중</p>}
      </div>
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
  const cu = briefing?.lme_summary?.copper;
  const zn = briefing?.lme_summary?.zinc;
  const allNews = briefing?.allNews || briefing?.key_news || [];
  const risk = briefing?.supply_chain_risk;
  const sub = briefing?.sub_materials;
  const log = briefing?.logistics;
  const expert = briefing?.expert_comment;
  const container = log?.container;
  const bulk = log?.bulk;

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@500&display=swap" rel="stylesheet" />

      {/* 헤더 */}
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
          <span className="font-bold text-sm text-gray-900">오늘의 원자재</span>
        </div>
        <div className="text-xs text-gray-400">
          {new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' })}
        </div>
      </header>

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
            <p className="text-xs text-gray-400">하루 한 번 생성됩니다</p>
          </div>
        )}

        {briefing && (
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}>

              {/* ══ 주요 원자재 ══ */}
              {tab === 'home' && (
                <div>
                  {/* 히어로 — 알루미늄 메인 */}
                  <div className="bg-[#0A1628] px-5 pt-5 pb-6 relative overflow-hidden">
                    <div className="absolute right-0 bottom-0 flex items-end gap-1 opacity-15 pr-4 pb-0">
                      {[40, 55, 45, 65, 58, 72, 80].map((h, i) => (
                        <div key={i} className="w-4 bg-blue-400 rounded-t" style={{ height: h + 'px' }} />
                      ))}
                    </div>
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] text-blue-300 font-medium tracking-wider uppercase">전일 LME 기준</p>
                        <RiskPill level={risk?.level} />
                      </div>
                      <p className="text-sm text-blue-200 mb-0.5">Aluminum</p>
                      {/* 알루미늄 가격 — 크기 줄임 */}
                      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                        <span className="text-3xl font-bold text-white tracking-tight whitespace-nowrap"
                          style={{ fontFamily: "'DM Mono', monospace" }}>
                          {al?.price || '—'}
                        </span>
                        {al?.price && <span className="text-xs text-blue-300">USD/mt</span>}
                        {al?.change && (
                          <span className={"text-sm font-bold whitespace-nowrap " +
                            (al.change.includes('+') ? 'text-emerald-400' : 'text-red-400')}>
                            {al.change}
                          </span>
                        )}
                      </div>
                      {al?.source && <p className="text-[10px] text-blue-400 mb-1">{al.source}</p>}
                      {al?.change_reason && (
                        <p className="text-xs text-blue-200 leading-relaxed mb-3">{al.change_reason}</p>
                      )}
                    </div>

                    {/* 오늘의 원자재 한 줄 요약 */}
                    {expert ? (
                      <div className="relative z-10 bg-white/10 rounded-xl p-3.5 border border-white/10">
                        <p className="text-[10px] text-blue-300 font-medium mb-1.5 uppercase tracking-wider">
                          오늘의 원자재 한 줄 요약
                        </p>
                        <p className="text-sm text-white leading-relaxed">{expert.text}</p>
                        <button onClick={() => setTab('market')}
                          className="mt-2.5 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold py-2 rounded-lg transition flex items-center justify-center gap-1">
                          상세 분석 보기 <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative z-10 bg-white/10 rounded-xl p-3.5 border border-white/10">
                        <p className="text-[10px] text-blue-300 mb-1">오늘의 원자재 한 줄 요약</p>
                        <p className="text-sm text-blue-200 italic">분석 준비 중입니다.</p>
                      </div>
                    )}
                  </div>

                  {/* 구리/아연 — 2열 그리드 */}
                  <div className="px-4 mt-4">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">주요 금속 시세</p>
                    <div className="grid grid-cols-2 gap-3">
                      <MetalCard label="Copper" price={cu?.price} change={cu?.change}
                        changeReason={cu?.change_reason} source={cu?.source} />
                      <MetalCard label="Zinc" price={zn?.price} change={zn?.change}
                        changeReason={zn?.change_reason} source={zn?.source} />
                    </div>
                  </div>

                  {/* 공급망 리스크 */}
                  {risk?.reason && (
                    <div className="px-4 mt-3 pb-4">
                      <div className={"rounded-xl p-3.5 flex items-start gap-3 " +
                        (risk.level === '경고' ? 'bg-red-50 border border-red-200' :
                         risk.level === '주의' ? 'bg-amber-50 border border-amber-200' :
                         'bg-emerald-50 border border-emerald-200')}>
                        {risk.level === '원활'
                          ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          : <AlertTriangle className={"w-4 h-4 shrink-0 mt-0.5 " +
                              (risk.level === '경고' ? 'text-red-500' : 'text-amber-500')} />}
                        <div>
                          <p className={"text-xs font-bold mb-1 whitespace-nowrap " +
                            (risk.level === '경고' ? 'text-red-600' :
                             risk.level === '주의' ? 'text-amber-600' : 'text-emerald-600')}>
                            공급망 {risk.level}
                          </p>
                          <p className="text-xs text-gray-600 leading-relaxed">{risk.reason}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══ 제강사 부원료 ══ */}
              {tab === 'market' && (
                <div className="px-4 pt-5 pb-4 space-y-4">
                  <h2 className="font-bold text-sm text-gray-900">제강사 부원료 레이더</h2>

                  {/* 전문가 한 줄 요약 */}
                  {expert && (
                    <div className="bg-[#0A1628] rounded-xl p-4">
                      <p className="text-[10px] text-blue-300 font-medium mb-2 uppercase tracking-wider">
                        오늘의 원자재 한 줄 요약
                      </p>
                      <p className="text-sm text-white leading-relaxed">{expert.text}</p>
                    </div>
                  )}

                  {/* 알루미늄 스크랩 */}
                  <ReportSection
                    title="알루미늄 스크랩 · MJP · ISRI"
                    content={sub?.al_scrap}
                    color="blue"
                  />

                  {/* 가탄제 */}
                  <ReportSection
                    title="가탄제 (소괴탄 · 분탄) · 러시아 석탄"
                    content={sub?.carburizer}
                    color="amber"
                  />

                  {/* 페로실리콘 */}
                  <ReportSection
                    title="페로실리콘 (FeSi60/75) · 탈중국화"
                    content={sub?.ferro_silicon}
                    color="purple"
                  />

                  {/* LME 전일 종가 — 세로 배치 */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">LME 전일 종가</p>
                    <div className="space-y-2">
                      <MetalCard label="Aluminum (알루미늄)" price={al?.price} change={al?.change}
                        changeReason={al?.change_reason} source={al?.source} />
                      <MetalCard label="Copper (구리)" price={cu?.price} change={cu?.change}
                        changeReason={cu?.change_reason} source={cu?.source} />
                      <MetalCard label="Zinc (아연)" price={zn?.price} change={zn?.change}
                        changeReason={zn?.change_reason} source={zn?.source} />
                    </div>
                  </div>
                </div>
              )}

              {/* ══ 공급망 ══ */}
              {tab === 'supply' && (
                <div className="px-4 pt-5 pb-4 space-y-4">
                  <h2 className="font-bold text-sm text-gray-900">공급망 현황</h2>

                  {/* 리스크 */}
                  {risk && (
                    <div className={"rounded-xl p-3.5 flex items-start gap-3 " +
                      (risk.level === '경고' ? 'bg-red-50 border border-red-200' :
                       risk.level === '주의' ? 'bg-amber-50 border border-amber-200' :
                       'bg-emerald-50 border border-emerald-200')}>
                      {risk.level === '원활'
                        ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        : <AlertTriangle className={"w-4 h-4 shrink-0 mt-0.5 " +
                            (risk.level === '경고' ? 'text-red-500' : 'text-amber-500')} />}
                      <div>
                        <p className={"text-xs font-bold mb-1 " +
                          (risk.level === '경고' ? 'text-red-700' :
                           risk.level === '주의' ? 'text-amber-700' : 'text-emerald-700')}>
                          공급망 {risk.level || '—'}
                        </p>
                        {risk.reason && <p className="text-xs text-gray-600 leading-relaxed">{risk.reason}</p>}
                      </div>
                    </div>
                  )}

                  {/* 컨테이너 운임 */}
                  <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
                    <div className="px-4 py-3 bg-blue-600 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Ship className="w-4 h-4 text-white" />
                        <span className="text-xs font-bold text-white">컨테이너 운임 (40ft FEU)</span>
                      </div>
                      {container?.index && (
                        <span className="text-[10px] text-blue-100 font-medium whitespace-nowrap">{container.index}</span>
                      )}
                    </div>
                    {container?.outlook && (
                      <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100">
                        <p className="text-xs text-blue-700 leading-relaxed">{container.outlook}</p>
                      </div>
                    )}
                    {container?.routes && container.routes.length > 0 ? (
                      <div className="divide-y divide-gray-100">
                        {container.routes.map((r: any, i: number) => (
                          <div key={i} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{r.route}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-xs font-bold text-gray-900 whitespace-nowrap"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>
                                  {r.rate || '—'}
                                </span>
                                <ChangeTag change={r.change} size="xs" />
                              </div>
                            </div>
                            {r.reason && (
                              <p className="text-[11px] text-gray-400 leading-relaxed mt-1">{r.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 px-4 py-4">데이터 수집 중</p>
                    )}
                  </div>

                  {/* 벌크선 운임 */}
                  <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
                    <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Anchor className="w-4 h-4 text-white" />
                        <span className="text-xs font-bold text-white">벌크선 운임 (석탄 · 원자재)</span>
                      </div>
                      {bulk?.index && (
                        <span className="text-[10px] text-gray-300 font-medium whitespace-nowrap">{bulk.index}</span>
                      )}
                    </div>
                    {bulk?.outlook && (
                      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                        <p className="text-xs text-gray-600 leading-relaxed">{bulk.outlook}</p>
                      </div>
                    )}
                    {bulk?.routes && bulk.routes.length > 0 ? (
                      <div className="divide-y divide-gray-100">
                        {bulk.routes.map((r: any, i: number) => (
                          <div key={i} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-xs font-medium text-gray-700 block leading-snug">{r.route}</span>
                                {r.vessel && (
                                  <span className="text-[10px] text-gray-400">{r.vessel}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-xs font-bold text-gray-900 whitespace-nowrap"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>
                                  {r.rate || '—'}
                                </span>
                                <ChangeTag change={r.change} size="xs" />
                              </div>
                            </div>
                            {r.reason && (
                              <p className="text-[11px] text-gray-400 leading-relaxed mt-1">{r.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 px-4 py-4">데이터 수집 중</p>
                    )}
                  </div>

                  {/* 관세 · 통관 */}
                  <ReportSection
                    title="관세 · 통관 · 무역정책"
                    content={log?.customs}
                    color="gray"
                  />

                  {briefing.disclaimer && (
                    <p className="text-[10px] text-gray-300 text-center leading-relaxed px-2">
                      {briefing.disclaimer}
                    </p>
                  )}
                </div>
              )}

              {/* ══ 뉴스 ══ */}
              {tab === 'news' && (
                <div className="px-4 pt-5 pb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-sm text-gray-900">수집 뉴스</h2>
                    <span className="text-xs text-gray-400">{allNews.length}건</span>
                  </div>
                  <div className="space-y-3">
                    {allNews.map((n: any, i: number) => (
                      <div key={i} className="bg-white rounded-xl p-4 border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase whitespace-nowrap">
                            {n.source}
                          </span>
                          {n.url && (
                            <a href={n.url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-gray-400 hover:text-blue-500 flex items-center gap-0.5 whitespace-nowrap">
                              원문 <ChevronRight className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-1">{n.title}</h3>
                        {n.summary && (
                          <p className="text-xs text-gray-500 leading-relaxed">{n.summary}</p>
                        )}
                        {n.relevance && (
                          <div className="mt-2 pt-2 border-t border-gray-100 flex items-start gap-1.5">
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
                              업계 영향
                            </span>
                            <p className="text-xs text-amber-700 leading-relaxed">{n.relevance}</p>
                          </div>
                        )}
                      </div>
                    ))}
                    {allNews.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-12">뉴스 없음</p>
                    )}
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* 바텀 탭 */}
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

