// service-worker.js — 오프라인 캐시
const CACHE_NAME = 'a1-commodity-v3';

// 앱 shell (정적 파일)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/logo.png',
];

// 설치: 정적 파일 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] 정적 파일 캐시');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 활성화: 이전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// fetch 인터셉트
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 요청 (/api/get-news): Network First → 실패 시 캐시
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // 성공하면 캐시에 저장
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          // 오프라인 → 캐시된 마지막 데이터 반환
          return caches.match(event.request).then((cached) => {
            if (cached) {
              console.log('[SW] 오프라인 — 캐시 데이터 반환:', url.pathname);
              return cached;
            }
            // 캐시도 없으면 오프라인 응답
            return new Response(
              JSON.stringify({ error: 'offline', message: '오프라인 상태입니다.' }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // 정적 파일: Cache First → 없으면 네트워크
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
