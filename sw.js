// Stationly service worker — V3 (offline-first)
// Strategies:
//   - App shell (HTML/CSS/JS/icons): cache-first with bg revalidate, version-bumped on each release
//   - Supabase REST GETs: stale-while-revalidate (1-day TTL) — clients still see fresh data when online
//   - Supabase REST writes (POST/PATCH/DELETE): pass-through; on offline, return synthetic 202 {queued:true}
//     (the page-level offlineQueue.js has already enqueued the write)
//   - Edge functions (/functions/v1/): pass-through, no caching
//
// On every release, bump CACHE_VERSION below.

const CACHE_VERSION = 'stationly-v3';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const API_CACHE     = `${CACHE_VERSION}-api`;
const API_TTL_MS    = 24 * 60 * 60 * 1000;

// App shell — small, static, must be available offline.
const PRECACHE_URLS = [
  '/',
  '/app.html',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/app.js',
  '/dataRepo.js',
  '/tasksRepo.js',
  '/clockRepo.js',
  '/invitesRepo.js',
  '/offlineQueue.js',
  '/connectionStatus.js',
  '/tenantContext.js',
  '/supabaseClient.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// ─── Install: precache the shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[sw] precache partial failure:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function isSupabaseHost(url) {
  return url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in');
}
function isEdgeFunction(url) {
  return url.pathname.startsWith('/functions/');
}
function isRestRead(url, method) {
  return method === 'GET' && url.pathname.startsWith('/rest/');
}
function isRestWrite(method) {
  return method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT';
}

// Synthetic 202 response — UI's offlineQueue has already enqueued the write.
function queuedResponse() {
  return new Response(JSON.stringify({ queued: true, offline: true }), {
    status: 202,
    headers: { 'Content-Type': 'application/json', 'X-Stationly-Queued': '1' },
  });
}

// ─── Fetch: route based on request type ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Supabase / external API handling
  if (isSupabaseHost(url) || url.hostname.endsWith('stripe.com') || url.hostname.endsWith('twilio.com')) {
    if (isEdgeFunction(url)) {
      return; // pass-through
    }
    if (isSupabaseHost(url)) {
      if (isRestRead(url, req.method)) {
        event.respondWith(staleWhileRevalidate(req));
        return;
      }
      if (isRestWrite(req.method) && url.pathname.startsWith('/rest/')) {
        event.respondWith(passThroughOrQueue(req));
        return;
      }
    }
    return; // auth, realtime, storage, etc. -> pass-through
  }

  // Same-origin requests
  if (req.method !== 'GET') return;

  // Navigations (HTML pages) → network-first, fall back to app shell
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Same-origin static assets → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Cross-origin (CDNs, fonts, etc) → cache-first
  event.respondWith(cacheFirst(req));
});

// ─── Strategies ────────────────────────────────────────────────────────────
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone()).catch(() => null);
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const shell = await caches.match('/app.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    // Background revalidate so the cache stays fresh.
    fetch(req).then((fresh) => {
      if (fresh && fresh.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, fresh.clone())).catch(() => null);
    }).catch(() => null);
    return cached;
  }
  try {
    const fresh = await fetch(req);
    if (fresh.ok && req.url.startsWith('http')) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone()).catch(() => null);
    }
    return fresh;
  } catch (err) {
    if (req.destination === 'image') {
      return new Response(
        Uint8Array.from(atob('R0lGODlhAQABAAAAACw='), (c) => c.charCodeAt(0)),
        { headers: { 'Content-Type': 'image/gif' } }
      );
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh && fresh.ok) {
      const headers = new Headers(fresh.headers);
      headers.set('X-Stationly-Cached-At', String(Date.now()));
      const cloned = new Response(fresh.clone().body, {
        status: fresh.status,
        statusText: fresh.statusText,
        headers,
      });
      cache.put(req, cloned).catch(() => null);
    }
    return fresh;
  }).catch(() => null);

  if (cached) {
    const at = Number(cached.headers.get('X-Stationly-Cached-At') || 0);
    if (at && Date.now() - at < API_TTL_MS) {
      // Return cached immediately; revalidation runs in background.
      fetchPromise; // fire-and-forget
      return cached;
    }
  }
  // Stale or missing — wait for network.
  const fresh = await fetchPromise;
  if (fresh) return fresh;
  if (cached) return cached;
  return new Response(JSON.stringify({ offline: true, error: 'No cached data' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function passThroughOrQueue(req) {
  try {
    return await fetch(req);
  } catch (err) {
    // Network down — the page-level offlineQueue.js already enqueued.
    return queuedResponse();
  }
}

// ─── Allow page to ask SW to skip waiting (used by update prompt) ──────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
