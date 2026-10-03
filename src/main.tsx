import {StrictMode, lazy, Suspense} from 'react';
import {createRoot} from 'react-dom/client';

// ?v=3 — 새 화면(시장 단위 브리핑)을 별도 묶음으로 병행 공개. 기존 화면 코드·CSS는 불러오지 않는다.
const isV3 = new URLSearchParams(location.search).get('v') === '3';
const Root = isV3 ? lazy(() => import('./v3/V3App')) : lazy(() => import('./App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
);
