/**
 * @module pwa
 * @description Service worker registration and freshness coordinator.
 *
 * What this module owns
 * ─────────────────────
 *   • Registering /sw.js with scope '/'.
 *   • Probing /version.json on boot and whenever the tab becomes visible, and
 *     handing the result to the SW so it can invalidate stale caches.
 *   • Reacting to the SW's `VERSION_RESULT`:
 *       - `shellChanged: true`  → tell the waiting worker to skip-waiting,
 *                                 then reload the page exactly once.
 *       - `dataChanged: true`   → dispatch `bauxa:data-updated` so views can
 *                                 re-render without a hard reload.
 *   • Listening for `controllerchange` so the page reloads when the SW takes
 *     over (covers the case where a brand-new install activates while the
 *     user is interacting with the app).
 *   • Honouring `?source=pwa` / `?source=pwa-shortcut` for telemetry-friendly
 *     entry-point detection (left to the consumer; we just expose it).
 *
 * Failure mode: if `/version.json` is unreachable (offline), we *do not*
 * touch caches. The existing SW continues serving the last good shell + data.
 */

const VERSION_URL = '/version.json';
const LAST_SEEN_KEY = 'bauxa_pwa_lastSeen';

let reloading = false;

/** Read the cached "last seen" versions from localStorage (best-effort). */
function readLastSeen() {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    return raw ? JSON.parse(raw) : { app: null, data: null };
  } catch { return { app: null, data: null }; }
}

function writeLastSeen(versions) {
  try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(versions)); }
  catch { /* storage might be full or disabled — non-fatal */ }
}

/** Fetch the canonical version with no caching anywhere in the pipeline. */
async function fetchVersion() {
  const res = await fetch(VERSION_URL, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`/version.json HTTP ${res.status}`);
  return res.json();
}

/** Hand the latest version off to the active SW so it can rotate caches. */
function postVersionToSw(payload) {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return;
  ctrl.postMessage({ type: 'CHECK_VERSION', payload });
}

/** Coordinated reload. Guarded so an upgrade storm can't reload in a loop. */
function reloadOnce() {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/**
 * Main entry point. Idempotent — safe to call from app.js once on boot.
 * Returns the registration (or `null` if SW is unsupported / disabled).
 */
export async function initPwa() {
  if (!('serviceWorker' in navigator)) return null;

  // Treat the dev environment as PWA-on too. The only thing we skip on file://
  // or insecure contexts is registration itself (the API refuses anyway).
  if (!window.isSecureContext && location.hostname !== 'localhost' && !/^127\./.test(location.hostname)) {
    return null;
  }

  let registration;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch (err) {
    console.warn('[pwa] SW registration failed:', err);
    return null;
  }

  // When the SW activates a brand-new version (after we send SKIP_WAITING),
  // the controller swaps. Reload so the page runs the new code.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Skip the very first controllerchange after first install — there's no
    // *old* shell to replace yet, so a reload would be jarring.
    if (!sessionStorage.getItem('bauxa_pwa_firstControl')) {
      sessionStorage.setItem('bauxa_pwa_firstControl', '1');
      return;
    }
    reloadOnce();
  });

  // Hear back from the SW about what changed.
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'VERSION_RESULT') return;

    const next = { app: data.app ?? null, data: data.data ?? null };
    writeLastSeen(next);

    if (data.shellChanged) {
      // A new worker is waiting — release it. controllerchange will reload.
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    if (data.dataChanged) {
      window.dispatchEvent(new CustomEvent('bauxa:data-updated', { detail: { data: data.data } }));
    }
  });

  // Pick up `waiting` workers that landed before this handler was attached.
  if (registration.waiting && navigator.serviceWorker.controller) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  // Watch for *future* updates the browser discovers in the background.
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        // A new SW is installed while an old one controls the page — promote it.
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });

  // First probe + revisits.
  const probe = () => probeVersion(registration);
  await probe();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probe(); });
  window.addEventListener('online', probe);

  // Best-effort: ask for a daily background refresh. Chrome-only; resolves
  // silently on browsers without the API or without the permission granted.
  schedulePeriodicSync(registration).catch(() => {});

  return registration;
}

/* ─────────────────── Periodic Background Sync ─────────────────── */

const PERIODIC_TAG = 'dnb-daily-refresh';
const PERIODIC_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function schedulePeriodicSync(registration) {
  // Feature-detect: only Chrome/Edge expose `periodicSync` on the registration.
  if (!('periodicSync' in registration)) return;

  // The site needs to be granted the `periodic-background-sync` permission;
  // browsers grant it heuristically based on site engagement. We just *ask*.
  try {
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return;
  } catch { return; }

  try {
    const tags = await registration.periodicSync.getTags();
    if (tags.includes(PERIODIC_TAG)) return; // already registered
    await registration.periodicSync.register(PERIODIC_TAG, { minInterval: PERIODIC_INTERVAL_MS });
  } catch { /* DOMException — browser declined. Nothing to do. */ }
}

/* ─────────────────────────── Web Push ─────────────────────────── */

/**
 * Public API for the profile UI:
 *   pushSupported()          — boolean. Returns true on browsers that have
 *                              ServiceWorker + Push + Notification + a usable
 *                              permissions story. Used to hide the toggle on
 *                              iOS Safari < 16.4 etc.
 *   getPushPermission()      — 'default' | 'granted' | 'denied'.
 *   getPushSubscription()    — current PushSubscription, or null. Source of
 *                              truth for whether the toggle is "on".
 *   subscribePush()          — prompts permission, calls PushManager.subscribe,
 *                              POSTs to /api/push/subscribe. Throws on failure.
 *   unsubscribePush()        — unsubscribes locally AND tells the backend so it
 *                              stops trying to push to a dead endpoint.
 *
 * All four bail safely on browsers without support — callers don't need to
 * feature-check beyond `pushSupported()`.
 */
export function pushSupported() {
  return 'serviceWorker' in navigator
      && 'PushManager'    in window
      && 'Notification'   in window;
}

export function getPushPermission() {
  return pushSupported() ? Notification.permission : 'denied';
}

export async function getPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

function base64UrlToUint8Array(b64url) {
  // RFC 4648 §5 → standard base64, then atob.
  const pad = '='.repeat((4 - b64url.length % 4) % 4);
  const std = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * `apiFetch` is imported lazily so this module stays free of the auth
 * dependency for non-push consumers (the SW registration path runs before
 * the Supabase client is created).
 */
async function postPush(path, body) {
  const { apiFetch } = await import('./config.js');
  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function subscribePush() {
  if (!pushSupported()) throw new Error('PUSH_UNSUPPORTED');

  const permission = await Notification.requestPermission();
  console.info('[push] Notification.requestPermission →', permission);
  if (permission !== 'granted') throw new Error('PERMISSION_DENIED');

  const reg = await navigator.serviceWorker.ready;
  console.info('[push] SW ready, scope=', reg.scope);

  // Re-use any existing subscription rather than creating a duplicate the
  // backend would then have to dedupe.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    let vapidRes;
    try {
      vapidRes = await fetch('/api/push/vapid', { cache: 'no-store' });
    } catch (err) {
      console.error('[push] /api/push/vapid fetch threw:', err);
      throw new Error('VAPID_FETCH_FAILED');
    }
    if (!vapidRes.ok) {
      console.error('[push] /api/push/vapid HTTP', vapidRes.status);
      throw new Error('VAPID_FETCH_FAILED');
    }
    const { publicKey } = await vapidRes.json();
    console.info('[push] VAPID public key len=', publicKey?.length);
    if (!publicKey) throw new Error('VAPID_MISSING');

    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
      console.info('[push] pushManager.subscribe OK, endpoint=', sub.endpoint);
    } catch (err) {
      console.error('[push] pushManager.subscribe threw:', err?.name, err?.message, err);
      throw new Error('SUBSCRIBE_FAILED:' + (err?.name || 'unknown'));
    }
  } else {
    console.info('[push] re-using existing subscription, endpoint=', sub.endpoint);
  }

  // Send the subscription JSON to the backend. `toJSON()` already produces the
  // shape the backend expects: { endpoint, keys: { p256dh, auth } }.
  try {
    await postPush('/api/push/subscribe', { subscription: sub.toJSON() });
    console.info('[push] backend subscribe OK');
  } catch (err) {
    console.error('[push] /api/push/subscribe POST failed:', err?.message, err);
    throw new Error('BACKEND_SUBSCRIBE_FAILED:' + (err?.message || 'unknown'));
  }
  return sub;
}

export async function unsubscribePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  // Tell the backend first — if the local unsubscribe succeeds but the API
  // call fails, the server keeps trying to push to a dead endpoint. Doing the
  // API first means a network blip leaves the user opted-in (recoverable),
  // not orphaned (silent breakage).
  try { await postPush('/api/push/unsubscribe', { endpoint: sub.endpoint }); }
  catch (err) { console.warn('[push] backend unsubscribe failed (continuing):', err?.message); }
  await sub.unsubscribe();
}

async function probeVersion(registration) {
  let version;
  try {
    version = await fetchVersion();
  } catch {
    // Offline or server hiccup — leave caches alone.
    return;
  }

  // Always hand off to the SW even on equal versions: it's cheap, and it
  // ensures the SW's in-memory versions are seeded on a fresh boot (where
  // the placeholders `unknown` still match nothing).
  postVersionToSw(version);

  // If we have no SW controlling the page yet (first install), wait for
  // activation and re-post so the new SW sees the version too.
  if (!navigator.serviceWorker.controller && registration.installing) {
    registration.installing.addEventListener('statechange', () => {
      if (navigator.serviceWorker.controller) postVersionToSw(version);
    });
  }

  const seen = readLastSeen();
  if (seen.app && seen.app !== version.app) {
    // App version drifted while the SW couldn't tell us (e.g. SW unsupported
    // or message lost). Force a reload as a safety net.
    writeLastSeen(version);
    reloadOnce();
    return;
  }
  writeLastSeen(version);
}
