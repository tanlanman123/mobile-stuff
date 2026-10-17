// Bump this when you change any file so phones pick up the new version.
const CACHE = 'arcade-v3';
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'stacky/',
  'stacky/index.html',
  'stacky/style.css',
  'stacky/game.js',
  'stacky/thumb.png',
  'physics/',
  'physics/index.html',
  'physics/style.css',
  'physics/engine.js',
  'physics/app.js',
  'physics/thumb.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up when online; fall back to cache offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
