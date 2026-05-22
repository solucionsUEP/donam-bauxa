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

  return registration;
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
