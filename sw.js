// Lory's Lab service worker.
// Strategy: NETWORK-FIRST for everything in ASSETS (so deploys show up on the
// first online load), falling back to cache when offline. Bump the version on
// each deploy anyway — it clears stale entries.
const CACHE = 'lorys-lab-v18';
const ASSETS = [
  '.', 'index.html', 'manifest.json', 'icon-180.png', 'icon-512.png',
  'vendor/matter.min.js', 'src/core.js', 'src/levels.js', 'src/audio.js',
  'src/render.js', 'src/game.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // cache:'no-cache' forces an ETag revalidation with the server, bypassing
  // the browser's HTTP cache — deploys are visible immediately when online
  // (GitHub Pages answers unchanged files with cheap 304s).
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error())
      )
  );
});
