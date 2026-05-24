// Stationly Staff PWA — service worker
// Cache strategy:
//   - App shell (HTML/CSS/JS): cache-first with background refresh
//   - Supabase API (POST/PATCH/etc): network-only with Background Sync queue for clock events
//   - Static assets (icons): cache-first

const CACHE = 'stationly-staff-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './staffApp.js',
  './services/staffService.js',
  './services/nativeBridge.js',
  './services/supabaseClient.js',
  './screens/login.js',
  './screens/pin.js',
  './screens/today.js',
  './screens/clock.js',
  './screens/tasks.js',
  './screens/overage.js',
  './screens/messages.js',
  './screens/profile.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch((err) => {
      // Don't fail install if a single shell asset is missing — log + continue
      console.warn('shell precache partial:', err);
    }))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET (POSTs to Supabase use Background Sync from the app side)
  if (req.method !== 'GET') return;

  // Cross-origin (Supabase, esm.sh, fonts): network-first, fallback to cache
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy).catch(() => {}));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Same-origin (app shell): cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Background revalidate
        fetch(req).then((res) => {
          if (res && res.ok) {
            caches.open(CACHE).then((c) => c.put(req, res.clone()).catch(() => {}));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy).catch(() => {}));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// Background Sync for offline clock-in queue
self.addEventListener('sync', (event) => {
  if (event.tag === 'clock-events-queue') {
    event.waitUntil(self.clients.matchAll().then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'flush-clock-queue' }));
    }));
  }
});

// Push notifications (manager → employee)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Stationly', body: event.data?.text() ?? '' }; }
  const title = data.title || 'Stationly';
  const opts = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || '/staff/' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/staff/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes('/staff/')) { w.focus(); w.postMessage({ type: 'navigate', url }); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});
