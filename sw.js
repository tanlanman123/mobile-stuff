// Bump this when you change any file so phones pick up the new version.
const CACHE = 'arcade-v12';
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
  'cars/',
  'cars/index.html',
  'cars/style.css',
  'cars/game.js',
  'cars/thumb.png',
  // Human-made Stacky's 40 MB index.wasm isn't listed; it's cached the first
  // time the game is played, so the install stays small.
  'stacky-human/',
  'stacky-human/index.html',
  'stacky-human/index.js',
  'stacky-human/index.pck',
  'stacky-human/index.audio.worklet.js',
  'stacky-human/index.audio.position.worklet.js',
  'stacky-human/index.png',
  'stacky-human/index.icon.png',
  'stacky-human/index.apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up when online; fall back to cache offline.
// 'no-cache' makes the browser check with the server instead of reusing its
// own HTTP cache, which GitHub Pages lets go stale for up to 10 minutes.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
