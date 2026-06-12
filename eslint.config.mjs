// no-undef 전용 최소 설정 — ferroalloy-tab.js 'exchangeInfo is not defined'(4일 프로덕션 장애)류
// 미정의 식별자 사고 재발 방지. vite build는 api/를 검사하지 않으므로 npm test 체인에서 실행.
export default [
  {
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        crypto: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
];
