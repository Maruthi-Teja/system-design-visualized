/* Offline support: network-first, falling back to the cache.
   Fresh content always wins when online; the last-seen copy is used offline. */
const CACHE = 'sdv-v2';
const PRECACHE = [
  './', 'index.html',
  'assets/style.css', 'assets/engine.js',
  'designs/rtb.html', 'designs/rtb.config.js',
  'designs/rate-limiter.html', 'designs/rate-limiter.config.js', 'designs/rate-limiter.sim.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
