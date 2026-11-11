// Offline support: cache the app shell, serve it cache-first, refresh in the background.
// Bump VERSION whenever you deploy changes so phones pick them up.
const VERSION = 'claycard-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/app.js', 'src/scoring.js', 'src/storage.js', 'src/api.js', 'src/config.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle the app's own files; anything else (club API calls) always goes to the network.
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.slice(scope.pathname.length) || './';
  if (e.request.method !== 'GET' || url.origin !== location.origin || !(SHELL.includes(rel) || e.request.mode === 'navigate')) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
