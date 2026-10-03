import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import V3App from './v3/V3App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <V3App />
  </StrictMode>,
);
