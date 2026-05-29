/**
 * @file sw.js — Dona'm Bauxa service worker.
 *
 * Cache architecture
 * ──────────────────
 *   shell-v<APP>    Static app shell (HTML/CSS/JS/icons/locales). Versioned by
 *                   the app version reported by /version.json. Strategy:
 *                   cache-first with background revalidation.
 *
 *   data-v<DATA>    JSON catalogs under /data/. Versioned by the newest file
 *                   mtime reported by /version.json. Strategy:
 *                   stale-while-revalidate so the UI is always instant and the
 *                   next visit shows the latest data.
 *
 *   runtime         Long-tail images and third-party assets. Cache-first with
 *                   an LRU-ish trim on activate.
 *
 * Freshness flow
 * ──────────────
 *   1. The page boots and POSTs the result of `fetch('/version.json', {cache:'no-store'})`
 *      to the SW via `controller.postMessage({type:'CHECK_VERSION', payload})`.
 *   2. The SW compares each version against its current cache names. Mismatches
 *      trigger `caches.delete()` and the affected bucket is rebuilt on demand.
 *   3. If the *shell* version changed, the SW asks the page to reload (only
 *      after the new SW activates) so the user runs the new code.
 *
 * Network strategies per request
 * ──────────────────────────────
 *   - GET /version.json       → network only, never cached.
 *   - Navigation requests     → network-first, fall back to cached /index.html,
 *                               then /offline.html.
 *   - /api/*, /auth/*         → network only.
 *   - /data/*.json            → stale-while-revalidate against data-v<DATA>.
 *   - Other same-origin GETs  → cache-first against shell-v<APP>, with
 *                               background revalidation.
 *   - Cross-origin (CDNs)     → cache-first against runtime.
 *
 * Updates
 * ───────
 *   `self.skipWaiting()` is called only when the page sends `{type:'SKIP_WAITING'}`
 *   so we never replace the worker mid-session without the page being ready.
 */

/* eslint-env serviceworker */

const APP_VERSION_FALLBACK  = 'unknown';
const DATA_VERSION_FALLBACK = 'unknown';

// Updated lazily from /version.json. On first install we don't know the real
// app version, so cache names use these placeholders until the page reports in.
let appVersion  = APP_VERSION_FALLBACK;
let dataVersion = DATA_VERSION_FALLBACK;

const SHELL   = () => `shell-v${appVersion}`;
const DATA    = () => `data-v${dataVersion}`;
const RUNTIME = 'runtime';
const OFFLINE_URL = '/offline.html';

/** Files that must be available immediately on first install. Keep tight: the
 *  rest of the shell warms on first use via the cache-first strategy. */
const PRECACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/api-config.json',
  '/css/bootstrap.min.css',
  '/css/bootstrap-icons.min.css',
  '/css/main.min.css',
  '/css/fonts/bootstrap-icons.woff2',
  '/js/bootstrap.bundle.min.js',
  '/js/supabase.min.js',
  '/js/app.js',
  '/js/i18n.js',
  '/js/router.js',
  '/js/config.js',
  '/js/pwa.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/apple-touch-icon-180.png',
  '/favicon.ico',
  '/locales/ca.json',
];

// Backend origin (e.g. https://<vercel>.app). Set by the page via SET_BACKEND.
// Requests to this origin are always network-only — the SW must never cache
// API responses (auth-stamped, frequently mutated, often POST anyway).
let backendOrigin = null;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL());
    // addAll is atomic — if any URL fails the install fails. Use add() in a
    // loop so a single missing optional resource doesn't break the worker.
    await Promise.all(PRECACHE.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* non-fatal: will be filled in on first use */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Take control immediately so the very first navigation after install is
    // routed through this worker (avoids a refresh requirement).
    await self.clients.claim();
    await purgeStaleCaches();
    // Enable navigation preload where supported — speeds up the first paint
    // when we fall through to network for navigations.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* noop */ }
    }
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'SET_BACKEND' && typeof data.origin === 'string') {
    backendOrigin = data.origin || null;
    return;
  }

  if (data.type === 'CHECK_VERSION' && data.payload) {
    event.waitUntil(handleVersion(data.payload));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // /version.json is the freshness probe — never cached, never intercepted by
  // a stale response.
  if (sameOrigin && url.pathname === '/version.json') return;

  // Backend (Vercel) and same-origin API/auth → network-only, never cached.
  if (backendOrigin && url.origin === backendOrigin) return;
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))) return;

  // HTML navigations: network-first with offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  // Data JSON catalogs: stale-while-revalidate against the data bucket.
  if (sameOrigin && url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req, DATA()));
    return;
  }

  // Same-origin static assets: cache-first against the shell bucket.
  if (sameOrigin) {
    event.respondWith(cacheFirst(req, SHELL()));
    return;
  }

  // Cross-origin: cache-first in the runtime bucket.
  event.respondWith(cacheFirst(req, RUNTIME));
});

/* ─────────────────────────── Strategies ─────────────────────────── */

async function handleNavigation(event) {
  try {
    const preload = await event.preloadResponse;
    const fresh = preload || await fetch(event.request);
    // Mirror the latest index.html into the shell cache so offline reloads work.
    if (fresh && fresh.ok) {
      const shell = await caches.open(SHELL());
      shell.put('/index.html', fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const shell = await caches.open(SHELL());
    const cached = await shell.match('/index.html');
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response('Offline', { status: 503 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Background revalidate for hashed/non-hashed alike — keeps cache fresh.
    fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    // Final fallback for image-style requests so the UI doesn't crash.
    if (req.destination === 'image') return new Response('', { status: 504 });
    throw new Error('Network unavailable and no cache entry');
  }
}

/* ─────────────────────────── Versioning ─────────────────────────── */

async function handleVersion({ app, data }) {
  let shellChanged = false;
  let dataChanged = false;

  if (typeof app === 'string' && app && app !== appVersion) {
    // First learning the real version: migrate any precache we built under
    // the fallback name so it isn't dropped by the purge below.
    if (appVersion === APP_VERSION_FALLBACK) await renameCache(SHELL(), `shell-v${app}`);
    else shellChanged = true;
    appVersion = app;
  }
  if (typeof data === 'string' && data && data !== dataVersion) {
    if (dataVersion === DATA_VERSION_FALLBACK) await renameCache(DATA(), `data-v${data}`);
    else dataChanged = true;
    dataVersion = data;
  }

  await purgeStaleCaches();

  // Notify every client about what changed so they can react (toast + reload
  // for shell changes, silent refresh for data changes).
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: 'VERSION_RESULT', shellChanged, dataChanged, app, data });
  }
}

async function purgeStaleCaches() {
  const keep = new Set([SHELL(), DATA(), RUNTIME]);
  const names = await caches.keys();
  await Promise.all(names.map((n) => keep.has(n) ? null : caches.delete(n)));
}

/**
 * Move every entry from cache `from` into a new cache `to`, then delete `from`.
 * Used to re-tag the placeholder precache (`shell-vunknown`) with the real
 * version once the page reports it, so we don't throw away the install warmup.
 */
async function renameCache(from, to) {
  if (from === to) return;
  const existing = await caches.has(from);
  if (!existing) return;
  const src = await caches.open(from);
  const dst = await caches.open(to);
  const reqs = await src.keys();
  await Promise.all(reqs.map(async (req) => {
    const res = await src.match(req);
    if (res) await dst.put(req, res.clone());
  }));
  await caches.delete(from);
}

/* ─────────────────────────── Web Push ─────────────────────────── */

/**
 * Payload shape we expect from the push-sender (batch 2). Kept loose so the
 * service worker degrades gracefully if a future field is missing.
 *   { title, body, url?, tag?, icon?, badge? }
 *
 * We always coerce to a sensible default — a payload-less push (some browsers
 * deliver one on initial subscribe) still shows a generic notification rather
 * than silently failing, which would cause the browser to revoke the
 * permission ("you promised to notify, you didn't").
 */
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try { payload = event.data.json(); }
    catch { payload = { title: 'Dona\'m Bauxa', body: event.data.text() }; }
  }
  const title = payload.title || 'Dona\'m Bauxa';
  const options = {
    body:  payload.body  || '',
    icon:  payload.icon  || '/assets/icons/icon-192.png',
    badge: payload.badge || '/assets/icons/icon-192.png',
    tag:   payload.tag   || undefined,
    data:  { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Click handler: focus an existing tab on the right URL, or open a new one.
 * The match is by origin (not exact URL) so clicks land on the existing SPA
 * tab even if the user is on a different route — and the SPA's hash router
 * then navigates to the deep link.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      // Prefer focusing an already-open tab on the same origin.
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        client.navigate?.(target).catch(() => {});
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

/* ─────────────────── Periodic background sync ─────────────────── */

/**
 * Once-a-day catalog warm-up. Only fires on Chromium-derived browsers where
 * the user has granted the `periodic-background-sync` permission AND the site
 * has high "site engagement" — there is no way for us to force it.
 *
 * Strategy: refresh /version.json, then opportunistically re-fetch the data
 * JSON catalogs into the stale-while-revalidate bucket. We don't block on any
 * single fetch; offline or throttled networks just mean the next visit picks
 * the latest catalog as usual.
 */
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'dnb-daily-refresh') return;
  event.waitUntil(periodicRefresh());
});

async function periodicRefresh() {
  // Step 1: probe version.json so the SW can rotate buckets if anything moved.
  let version = null;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (res.ok) version = await res.json();
  } catch { /* offline — leave caches alone */ }
  if (version) await handleVersion(version);

  // Step 2: warm the data bucket. List comes from the precache + any cached
  // /data/*.json the user has already touched in this profile.
  try {
    const dataCache = await caches.open(DATA());
    const known = (await dataCache.keys()).map((r) => r.url);
    const seeds = ['/data/artists.json', '/data/events.json', '/data/news.json'];
    const urls = Array.from(new Set([...known, ...seeds.map((p) => new URL(p, self.location.origin).href)]));
    await Promise.all(urls.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res && res.ok) await dataCache.put(new Request(url), res.clone());
      } catch { /* per-URL failures are non-fatal */ }
    }));
  } catch { /* opening the cache failed — nothing to do */ }
}
