/* Service worker for The Patriarchs' Altar.
   Makes the app work offline: the reading, the prayers, the timer and the
   journal (saved in localStorage) all keep working with no signal.

   Bump CACHE_VERSION whenever the HTML or the shared modules change a lot,
   to drop old copies. */

const CACHE_VERSION = 'v9';
const CORE_CACHE = `altar-core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `altar-runtime-${CACHE_VERSION}`;

/* Everything needed for a complete offline reading.

   Two entry points live in this worker's scope: the section catalog at "/"
   and the Genesis devotional at "/genesis/". Both share the modules under
   /shared/. Every path is absolute, because the worker is registered from
   both pages at scope "/". */
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/genesis/',
  '/genesis/index.html',
  '/shared/firebase-config.js',
  '/shared/access-gate.js',
  '/shared/stripe-checkout.js',
  '/manifest.webmanifest',
  '/genesis/manifest.webmanifest',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

/* Third-party pieces the design depends on. Cached individually so that one
   failure can never abort the whole install. */
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com/',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Inter:wght@300;400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&display=swap'
];

/* Third-party hosts whose files are safe (and useful) to cache offline:
   the CSS framework and charting library, plus the Firebase SDK scripts.
   Firebase's API hosts are deliberately NOT here — auth and database calls
   must always hit the network. */
const CACHEABLE_HOSTS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* Requests that must never be served from cache, even a stale one: the
   things that decide access and move money. */
const NEVER_CACHE = ['/api/'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // One by one, so a single 404 cannot abort the whole install.
    await Promise.allSettled(
      CORE_ASSETS.map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    // Third-party assets: best effort, never fatal.
    for (const url of CDN_ASSETS) {
      try {
        await cache.add(new Request(url, { mode: 'cors' }));
      } catch (err) {
        // offline or blocked — the page still works, styling falls back
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CORE_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Serve from cache, then refresh from network in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle plain GETs.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Access checks and checkout calls always go to the network.
  if (url.origin === self.location.origin &&
      NEVER_CACHE.some((p) => url.pathname.startsWith(p))) {
    return;
  }

  // Page loads: try the network so edits show up, fall back to the saved
  // copy OF THAT SAME PAGE. (Saving every page under one key would serve the
  // Genesis reading to a visitor who asked for the catalog.)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CORE_CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
          return response;
        })
        .catch(async () => {
          const exact = await caches.match(request);
          if (exact) return exact;
          // Last resort: whatever we do have saved.
          return (await caches.match('/genesis/index.html')) ||
                 (await caches.match('/index.html')) ||
                 Response.error();
        })
    );
    return;
  }

  // Same-origin files (icons, config, manifest).
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, CORE_CACHE));
    return;
  }

  // Allow-listed third-party libraries.
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Everything else (Firebase auth/database, anything unknown) goes straight
  // to the network, uncached.
});

/* Let the page ask a new worker to take over immediately. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
