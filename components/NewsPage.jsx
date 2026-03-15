// components/NewsPage.jsx
// 뉴스 브리핑 표시 컴포넌트
// - analysis 텍스트의 [[번호]](url) 마크다운 링크를 렌더링
// - 원본 뉴스 카드 목록 표시

import { useEffect, useState } from "react";

// [[0]](https://...) 형태의 링크를 <a> 태그로 변환
function renderAnalysis(text) {
  if (!text) return "";
  // [[숫자]](url) → <a href="url" target="_blank">[숫자]</a>
  return text.replace(
    /\[\[(\d+)\]\]\((https?:\/\/[^\)]+)\)/g,
    (_, idx, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="news-ref-link">[${idx}]</a>`
  );
}

// 마크다운 헤더/줄바꿈을 간단히 HTML로 변환
function markdownToHtml(text) {
  if (!text) return "";
  return text
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export default function NewsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const fetchNews = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/get-news");

      if (res.status === 404) {
        // 브리핑 없음 → 생성 트리거
        setData(null);
        setError("오늘 브리핑이 아직 없습니다");
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const triggerGenerate = async () => {
    try {
      setGenerating(true);
      const res = await fetch("/api/generate-news", { method: "POST" });
      const json = await res.json();
      if (json.status === "generated" || json.status === "already-exists") {
        await fetchNews(); // 생성 후 바로 다시 로드
      }
    } catch (e) {
      setError("생성 실패: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  if (loading) {
    return (
      <div className="news-loading">
        <p>브리핑 불러오는 중...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="news-empty">
        <p>{error}</p>
        <button onClick={triggerGenerate} disabled={generating}>
          {generating ? "생성 중..." : "오늘 브리핑 생성하기"}
        </button>
      </div>
    );
  }

  // analysis 텍스트 처리 — [[번호]](url) 링크 + 마크다운 변환
  const renderedAnalysis = renderAnalysis(markdownToHtml(data.analysis));

  return (
    <div className="news-container">
      {/* 날짜 헤더 */}
      <header className="news-header">
        <h1>원자재 시황 브리핑</h1>
        <span className="news-date">{data.date}</span>
        <span className="news-count">뉴스 {data.newsCount}건 분석</span>
      </header>

      {/* AI 분석 본문 — 링크 포함 */}
      <section
        className="news-analysis"
        dangerouslySetInnerHTML={{ __html: `<p>${renderedAnalysis}</p>` }}
      />

      {/* 원본 뉴스 카드 목록 */}
      <section className="news-sources">
        <h2>원본 뉴스 ({data.news?.length}건)</h2>
        <div className="news-grid">
          {data.news?.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="news-card"
            >
              <span className="news-card-idx">[{item.id}]</span>
              <span className="news-card-source">{item.source}</span>
              <p className="news-card-title">{item.title}</p>
              {item.pubDate && (
                <span className="news-card-date">
                  {new Date(item.pubDate).toLocaleDateString("ko-KR")}
                </span>
              )}
            </a>
          ))}
        </div>
      </section>

      <style>{`
        .news-container { max-width: 860px; margin: 0 auto; padding: 24px 16px; font-family: sans-serif; }
        .news-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
        .news-header h1 { font-size: 22px; font-weight: 600; margin: 0; }
        .news-date { font-size: 14px; color: #666; }
        .news-count { font-size: 12px; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; color: #555; }
        .news-analysis { line-height: 1.8; font-size: 15px; color: #222; margin-bottom: 40px; }
        .news-analysis h2 { font-size: 17px; font-weight: 600; margin: 20px 0 8px; }
        .news-analysis h3 { font-size: 15px; font-weight: 600; margin: 16px 0 6px; color: #333; }
        .news-ref-link { color: #1a73e8; text-decoration: none; font-size: 12px; font-weight: 600;
          background: #e8f0fe; padding: 1px 5px; border-radius: 4px; margin: 0 2px; }
        .news-ref-link:hover { background: #c5d8fc; }
        .news-sources h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
        .news-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
        .news-card { display: block; padding: 14px; border: 1px solid #e0e0e0; border-radius: 8px;
          text-decoration: none; color: inherit; transition: border-color 0.2s, box-shadow 0.2s; }
        .news-card:hover { border-color: #1a73e8; box-shadow: 0 2px 8px rgba(26,115,232,0.1); }
        .news-card-idx { font-size: 11px; color: #1a73e8; font-weight: 600; }
        .news-card-source { font-size: 11px; color: #888; margin-left: 8px; }
        .news-card-title { font-size: 13px; line-height: 1.5; margin: 8px 0 4px; color: #222; }
        .news-card-date { font-size: 11px; color: #aaa; }
        .news-loading, .news-empty { text-align: center; padding: 60px 20px; color: #666; }
        .news-empty button { margin-top: 16px; padding: 10px 24px; background: #1a73e8; color: #fff;
          border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
        .news-empty button:disabled { background: #aaa; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

