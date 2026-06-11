// service-worker.js ???¤í”„?¼ì¸ ìºì‹œ
const CACHE_NAME = 'a1-commodity-v4';

// ??shell (?•ì  ?Œì¼)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/logo.png',
];

// ?¤ì¹˜: ?•ì  ?Œì¼ ìºì‹œ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] ?•ì  ?Œì¼ ìºì‹œ');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ?œì„±?? ?´ì „ ìºì‹œ ?? œ
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

// fetch ?¸í„°?‰íŠ¸
self.addEventListener('fetch', (event) => {
  // http/https ?”ì²­ë§?ì²˜ë¦¬ ??chrome-extension ???¤ë¥¸ ?¤í‚´ ë¬´ì‹œ
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // API ?”ì²­ (/api/get-news): Network First ???¤íŒ¨ ??ìºì‹œ
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // ?±ê³µ?˜ë©´ ìºì‹œ???€??
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          // ?¤í”„?¼ì¸ ??ìºì‹œ??ë§ˆì?ë§??°ì´??ë°˜í™˜
          return caches.match(event.request).then((cached) => {
            if (cached) {
              console.log('[SW] ?¤í”„?¼ì¸ ??ìºì‹œ ?°ì´??ë°˜í™˜:', url.pathname);
              return cached;
            }
            // ìºì‹œ???†ìœ¼ë©??¤í”„?¼ì¸ ?‘ë‹µ
            return new Response(
              JSON.stringify({ error: 'offline', message: '?¤í”„?¼ì¸ ?íƒœ?…ë‹ˆ??' }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // ?•ì  ?Œì¼: Network First ???¤íŒ¨ ??ìºì‹œ
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
