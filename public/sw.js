// Service worker : l'interface s'ouvre instantanément (cache), les données restent toujours fraîches.
const VERSION = 'venus-v6';
// Les fichiers de l'interface sont servis sous /b/<version>/ : chaque mise à jour a ses propres adresses
const SHELL = ['/', '/icons/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'venus-img' && k !== 'venus-offline').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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

// Notifications reçues même appli fermée (Web Push)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Venus', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Venus', {
    body: d.body || '', tag: d.tag || 'venus', renotify: true, icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = `/#${(e.notification.data && e.notification.data.url) || '/'}`;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
