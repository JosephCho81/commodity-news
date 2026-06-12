import { useState, useEffect, useCallback, useRef } from 'react';
import type { TabId, AluminumData, FerroalloyData, RecarburizerData, SummaryData, SteelmakerData } from './types';
import { TABS } from './types';
import { Logo, LoadingState, ErrorState, TabErrorBoundary, FreshnessBadge } from './components/ui';
import type { ApiMeta } from './types';
import { SteelmakerTab }  from './tabs/SteelmakerTab';
import { AluminumTab }    from './tabs/AluminumTab';
import { FerroalloyTab }  from './tabs/FerroalloyTab';
import { RecarburizerTab } from './tabs/RecarburizerTab';
import { SummaryTab }     from './tabs/SummaryTab';
import './styles/app.css';

const API_BASE = '/api/get-news';

const EMPTY_LOADING: Record<TabId, boolean> = {
  steelmaker: false, aluminum: false, ferroalloy: false, recarburizer: false, summary: false,
};
const EMPTY_ERROR: Record<TabId, boolean> = {
  steelmaker: false, aluminum: false, ferroalloy: false, recarburizer: false, summary: false,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState<Record<TabId, boolean>>(EMPTY_LOADING);
  const [error, setError]   = useState<Record<TabId, boolean>>(EMPTY_ERROR);

  const fetchTab = useCallback(async (tab: TabId) => {
    setLoading(p => ({ ...p, [tab]: true }));
    setError(p => ({ ...p, [tab]: false }));
    try {
      // index.html 인라인 스크립트가 미리 띄운 첫 탭 요청 재사용 (1회성)
      const preload = tab === 'summary' ? (window as any).__preloadSummary : null;
      if (preload) {
        (window as any).__preloadSummary = null;
        const json = await preload;
        if (json && !json.error) {
          setData(p => ({ ...p, [tab]: json }));
          return;
        }
      }
      const res = await fetch(`${API_BASE}?tab=${tab}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(p => ({ ...p, [tab]: json }));
    } catch {
      setError(p => ({ ...p, [tab]: true }));
    } finally {
      setLoading(p => ({ ...p, [tab]: false }));
    }
  }, []);

  useEffect(() => {
    if (!data[activeTab] && !loading[activeTab]) {
      fetchTab(activeTab);
    }
  }, [activeTab, fetchTab]);

  // 최초 1회: 활성 탭 로드 직후 나머지 탭을 백그라운드 프리페치 → 탭 전환 즉시화.
  // 캐시(_latest)가 있으면 빠르게 채워지고, 없을 때만 서버가 갱신을 트리거한다.
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    const timer = setTimeout(() => {
      for (const tab of TABS) {
        if (tab.id !== activeTab) fetchTab(tab.id);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [fetchTab, activeTab]);

  // PWA 포그라운드 복귀 시 30분 이상 묵은 활성 탭 재요청 —
  // 센티널이 장중 갱신한 브리핑(긴급 시황)이 앱 재실행 없이 반영되게 한다.
  const dataRef = useRef(data);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { dataRef.current = data; activeTabRef.current = activeTab; });
  useEffect(() => {
    const STALE_MS = 30 * 60 * 1000;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const meta = dataRef.current[activeTabRef.current] as ApiMeta | undefined;
      const at = meta?._cached_at;
      if (at && Date.now() - at > STALE_MS) fetchTab(activeTabRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchTab]);

  // 탭 전환 시 스크롤 최상단으로.
  // .app이 min-height(고정 height 아님)라 내용이 길면 window(body)가 스크롤됨 —
  // window와 .app-main 둘 다 리셋해야 모든 환경(PWA·브라우저)에서 동작.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    mainRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  const tabData  = data[activeTab] as never;
  const isLoading = loading[activeTab];
  const isError   = error[activeTab];

  function renderContent() {
    if (isLoading) return <LoadingState />;
    if (isError)   return <ErrorState onRetry={() => fetchTab(activeTab)} />;
    if (!tabData)  return null;
    switch (activeTab) {
      case 'steelmaker':   return <SteelmakerTab  data={tabData as SteelmakerData} />;
      case 'aluminum':     return <AluminumTab     data={tabData as AluminumData} />;
      case 'ferroalloy':   return <FerroalloyTab   data={tabData as FerroalloyData} />;
      case 'recarburizer': return <RecarburizerTab data={tabData as RecarburizerData} />;
      case 'summary':      return <SummaryTab      data={tabData as SummaryData} allData={data} />;
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <Logo />
          <div className="brand-text">
            <div className="brand-name">오늘의 원자재 뉴스</div>
            <div className="brand-sub">(주)한국에이원</div>
          </div>
        </div>
        <div className="header-actions">
          <FreshnessBadge meta={data[activeTab] as ApiMeta | undefined} />
        </div>
      </header>

      <main className="app-main" ref={mainRef}>
        <TabErrorBoundary key={activeTab} onReset={() => fetchTab(activeTab)}>
          {renderContent()}
        </TabErrorBoundary>
      </main>

      <nav className="bottom-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
