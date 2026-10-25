// Service worker : l'interface s'ouvre instantanément (cache), les données restent toujours fraîches.
const VERSION = 'venus-v2';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/nav.js', '/js/components.js',
  '/js/views/home.js', '/js/views/details.js', '/js/views/player.js', '/js/views/profiles.js', '/fonts/archivo.woff2', '/icons/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // jamais de cache pour l'API et la vidéo
  if (url.pathname.startsWith('/img/')) {
    // Affiches : cache d'abord (elles ne changent jamais de nom)
    e.respondWith(caches.open('venus-img').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // Interface : réseau d'abord, cache si hors-ligne
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
