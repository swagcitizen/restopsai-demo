// Stationly service worker
// Strategy:
//   - Network-first for navigations (HTML) so users always get fresh app shell
//   - Cache-first for static assets (images, icons, fonts, css, js)
//   - Never touch API/auth requests to supabase.co or /functions/
//
// On any code change, bump CACHE_VERSION below to force a refresh.

const CACHE_VERSION = 'stationly-v1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Files we want available offline so the app shell loads even without a network.
// Keep this list short — the runtime cache picks up the rest.
const PRECACHE_URLS = [
  '/',
  '/app.html',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// ─── Install: precache the shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => null))
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

// ─── Fetch: route based on request type ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. NEVER cache API/auth/realtime traffic
  if (
    url.hostname.endsWith('supabase.co')   ||
    url.hostname.endsWith('supabase.in')   ||
    url.hostname.endsWith('stripe.com')    ||
    url.hostname.endsWith('twilio.com')    ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/auth/')      ||
    url.pathname.startsWith('/rest/')      ||
    url.pathname.startsWith('/realtime/')
  ) {
    return; // let it pass through to the network normally
  }

  // 2. Navigations (HTML pages) → network-first, fall back to cache
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 3. Same-origin static assets → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 4. Cross-origin (CDNs, fonts, etc) → cache-first too, but with timeout
  event.respondWith(cacheFirst(req));
});

// ─── Strategies ────────────────────────────────────────────────────────────
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    // Only cache successful responses
    if (fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone()).catch(() => null);
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Last resort: serve the app shell
    const shell = await caches.match('/app.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok && (req.url.startsWith('http'))) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone()).catch(() => null);
    }
    return fresh;
  } catch (err) {
    // For images we can't load, return a tiny transparent gif as a graceful fallback
    if (req.destination === 'image') {
      return new Response(
        Uint8Array.from(atob('R0lGODlhAQABAAAAACw='), (c) => c.charCodeAt(0)),
        { headers: { 'Content-Type': 'image/gif' } }
      );
    }
    throw err;
  }
}

// ─── Allow page to ask SW to skip waiting (used by update prompt) ──────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
