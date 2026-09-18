/*
 * sw.js — app-shell service worker.
 *
 * Stale-while-revalidate: launch instantly from cache, refresh the cache in
 * the background so redeployed code arrives on the next launch; offline
 * launches fall back to the cached shell. Bump CACHE to force a hard update.
 */
const CACHE = 'thoughtmap-v2';
const ASSETS = [
  './',
  './index.html',
  './engine.js',
  './app.js',
  './styles.css',
  './tests.js',
  './tests.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const refresh = fetch(e.request)
        .then((res) => {
          if (res && res.ok && new URL(e.request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => null);
      if (hit) {
        refresh.catch(() => {}); // keep the cache fresh for the next launch
        return hit;
      }
      return refresh.then((res) => res || caches.match('./index.html'));
    })
  );
});
