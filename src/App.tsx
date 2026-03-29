import { useState, useEffect, useCallback } from 'react';
import type { TabId, AluminumData, FerrosiliconData, RecarburizerData, SummaryData } from './types';
import { TABS } from './types';
import { Logo, LoadingState, ErrorState } from './components/ui';
import { AluminumTab } from './tabs/AluminumTab';
import { FerrosiliconTab } from './tabs/FerrosiliconTab';
import { RecarburizerTab } from './tabs/RecarburizerTab';
import { SummaryTab } from './tabs/SummaryTab';
import './styles/app.css';

const API_BASE = '/api/get-news';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('aluminum');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState<Record<TabId, boolean>>({
    aluminum: false, ferrosilicon: false, recarburizer: false, summary: false,
  });
  const [error, setError] = useState<Record<TabId, boolean>>({
    aluminum: false, ferrosilicon: false, recarburizer: false, summary: false,
  });

  const fetchTab = useCallback(async (tab: TabId) => {
    setLoading(p => ({ ...p, [tab]: true }));
    setError(p => ({ ...p, [tab]: false }));
    try {
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

  const tabData = data[activeTab] as never;
  const isLoading = loading[activeTab];
  const isError = error[activeTab];

  function renderContent() {
    if (isLoading) return <LoadingState />;
    if (isError) return <ErrorState onRetry={() => fetchTab(activeTab)} />;
    if (!tabData) return null;
    switch (activeTab) {
      case 'aluminum':     return <AluminumTab data={tabData as AluminumData} />;
      case 'ferrosilicon': return <FerrosiliconTab data={tabData as FerrosiliconData} />;
      case 'recarburizer': return <RecarburizerTab data={tabData as RecarburizerData} />;
      case 'summary':      return <SummaryTab data={tabData as SummaryData} />;
    }
  }

  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
          <span className="cache-badge">{todayKST}</span>
        </div>
      </header>

      <main className="app-main">
        {renderContent()}
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
