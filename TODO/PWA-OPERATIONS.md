# PWA operations

How the offline-capable, auto-refreshing web app actually behaves in
production, and what to do when it misbehaves.

## How the freshness loop works

1. The page boots. `frontend/js/pwa.js` registers `/sw.js` and fetches
   `/version.json` with `cache: 'no-store'`.
2. The page sends the result to the service worker as a
   `{ type: 'CHECK_VERSION', payload: { app, data } }` message.
3. The SW compares the values against its cache names:
   - `shell-v<app>` for HTML/CSS/JS/icons
   - `data-v<data>` for `/data/*.json`
4. On a mismatch:
   - **App version changed**: SW deletes the old `shell-v…` cache, sends
     `SKIP_WAITING` if a new worker is `waiting`, and the page reloads exactly
     once via the `controllerchange` event.
   - **Data version changed**: SW deletes the old `data-v…` cache. The page
     listens for `bauxa:data-updated`, clears its in-memory cache, refetches
     the catalogs, and re-renders the active view *without a hard reload*.
5. The page also re-probes on `visibilitychange → visible` and `online`, so a
   long-running tab picks up new versions when the user comes back to it.

If `/version.json` is unreachable (offline, server down), nothing happens —
the existing caches keep serving the last good content.

## Cache strategies per route

| Pattern | Strategy | Why |
|---------|----------|-----|
| `/version.json` | network only, never cached | The probe must never be stale. |
| HTML navigations | network-first → cached `/index.html` → `/offline.html` | Always show the freshest shell when online, but never break offline. |
| `/data/*.json` | stale-while-revalidate (`data-v<data>`) | Instant render, background refresh. |
| Static same-origin (CSS/JS/icons/locales) | cache-first w/ background revalidate (`shell-v<app>`) | Versioned cache means a new app deploy invalidates it cleanly. |
| `/api/*`, `/auth/*` (same-origin) | network only | Auth-stamped responses must never be cached. |
| Anything to the configured `backendOrigin` (if cross-origin) | network only | Same reason, cross-origin variant. Currently unused — backend is same-origin on Dondominio. |
| Cross-origin (CDNs, fonts) | cache-first (`runtime`) | Long-lived, content-hashed third-party assets. |

The backend origin is told to the SW by the page via `SET_BACKEND` after
`/api-config.json` is loaded; the SW only knows about the origin, so any path
on that host is excluded from caching.

## How to force a refresh

### "I just deployed and want every client to update."

You don't need to do anything. The deploy already bumped
`frontend/version.json`. The next time each client opens the app, the
freshness loop above kicks in. Closed tabs pick up the change the moment they
become visible.

If you need it *now* on a specific device:

1. Open DevTools → Application → Service Workers.
2. Click **Update** next to the registration. The SW re-fetches `/sw.js`.
3. Reload.

### "I bumped a data file but the version didn't change."

This means `frontend/version.json` wasn't regenerated. The CI does this on
every deploy by running `npm run build:version`. If you edited `data/*.json`
outside of the CI flow (e.g., via the admin panel writing to the FTP host
directly), `version.json` won't reflect the change until the next push.

Workaround for now: trigger a no-op CI run by pushing an empty commit:

```bash
git commit --allow-empty -m "chore: bump pwa version"
git push
```

Long-term fix: have the admin panel write a fresh `version.json` after each
content mutation.

### "The user reports the site is stuck on an old version."

1. Have them visit `https://donambauxa.online/version.json`. Compare with the
   `app` value in `frontend/version.json` on the server.
2. If they match, the cache *is* current — the staleness is elsewhere
   (a browser-level cache, a CDN, or a downstream proxy).
3. If they don't match, the SW probe must be silently failing. Have them:
   - Open DevTools → Application → Storage → **Clear site data**.
   - Reload. The SW reinstalls and re-precaches.

Avoid telling users to "clear cookies" — `localStorage` is where the
last-seen-version safety-net lives, and clearing it just rebuilds it.

### "I need to roll forward / back instantly."

Service workers don't natively support "skip this version". The cleanest path
is to **roll forward**: push the fix, the freshness loop pulls it in
automatically. If you need to roll *back*, see the Rollback section in
[`DEPLOY-DONDOMINIO-FRONTEND.md`](./DEPLOY-DONDOMINIO-FRONTEND.md).

## Debugging the service worker

```js
// Run in DevTools console:

// 1. Inspect cache names + sizes
await caches.keys()
for (const name of await caches.keys()) {
  const c = await caches.open(name);
  console.log(name, (await c.keys()).length, 'entries');
}

// 2. Verify the SW knows the right backend origin
//    (no direct accessor — easiest is to send a CHECK_VERSION manually)
navigator.serviceWorker.controller.postMessage({
  type: 'CHECK_VERSION',
  payload: { app: 'force-shell-bump', data: 'force-data-bump' },
});

// 3. Force a full reset
await navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())));
for (const n of await caches.keys()) await caches.delete(n);
localStorage.removeItem('bauxa_pwa_lastSeen');
location.reload();
```

## When to bump versions yourself

You almost never should. The CI computes:

* `app` = `git rev-parse --short HEAD` (or the CI's commit SHA env var).
* `data` = `max(mtime)` over `frontend/data/*.json`.

Both update on every push. Only override when:

* You changed a non-versioned asset that the SW caches (e.g., adding a new
  precache entry to `sw.js` itself triggers `updatefound` automatically).
* The data was changed *outside* the git workflow (admin panel writing JSON
  directly to the host). See "I bumped a data file but the version didn't
  change" above.

## Installability checklist

Open Chrome DevTools → Lighthouse → run the PWA audit. The current setup
should hit every checkmark:

* ✓ Has a Web App Manifest with `name`, `short_name`, `start_url`, icons.
* ✓ Has a service worker that controls `start_url`.
* ✓ Loads over HTTPS (Dondominio + Let's Encrypt).
* ✓ Provides an offline experience (`/offline.html` + cached shell).
* ✓ Has a maskable icon ≥ 512×512 (we have `/assets/icons/icon-maskable-512.png`).
* ✓ Has an icon ≥ 192×192 (`/assets/icons/icon-192.png`).
* ✓ Theme color set in manifest and `<meta name="theme-color">`.

If a checkmark fails, see
[`DEPLOY-DONDOMINIO-FRONTEND.md`](./DEPLOY-DONDOMINIO-FRONTEND.md#troubleshooting)
for the most common causes.
