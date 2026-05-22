# Frontend deploy — Dondominio

The frontend is a static bundle (`frontend/`) served by Apache on Dondominio.
Deployment is automated: every push to `main` that touches `frontend/`,
`scripts/`, or `package.json` runs
[`.github/workflows/deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml),
which builds the PWA artifacts and uploads via FTP.

## What the CI does, step by step

1. `actions/checkout@v4` — pulls the repo.
2. `actions/setup-node@v4` (Node 20) + `npm ci`.
3. `npm run build:version` — writes `frontend/version.json`
   (`{ app: "<git short SHA>", data: "<newest data/*.json mtime>" }`).
   The service worker fetches this file with `Cache-Control: no-store` and
   rotates caches when either field changes.
4. `node -e "..."` overwrites `frontend/api-config.json` with the value of the
   `BACKEND_URL` secret. Today the project runs same-origin on Dondominio, so
   this secret is left **unset** and CI writes an empty `backendUrl`, which
   makes the frontend hit Dondominio's PHP backend at `/api/*`. The plumbing
   is kept in place in case you ever introduce a separate backend host.
5. `SamKirkland/FTP-Deploy-Action@v4.3.4` mirrors `frontend/` to the FTP root
   (`/`). It excludes `**/.git*`, `**/.DS_Store`, and `data/**` — server-side
   data is managed by the PHP backend and must not be overwritten by a
   frontend deploy. Note that `api/config.php` is also outside the deploy
   path: it's gitignored and uploaded by hand once.
6. A summary block is appended to the workflow run with the deployed version.

`concurrency: deploy-frontend` ensures only one deploy runs at a time and a
newer commit cancels an in-flight one.

## GitHub repository secrets

Set these in **Settings → Secrets and variables → Actions** of the GitHub repo.

| Secret | Example | Notes |
|--------|---------|-------|
| `FTP_HOST` | `ftp.donambauxa.online` | The Dondominio FTP daemon host. |
| `FTP_USER` | `<username>.donambauxa.online` | panel247 uses an FQDN-shaped username (e.g. `DLC22.donambauxa.online`). Confusing but that's the convention. |
| `FTP_PASSWORD` | `…` | Rotate at least once a year, and after any sharing. |
| `BACKEND_URL` | *(leave unset)* | Only set this if you ever introduce a separate backend host. Today everything runs same-origin on Dondominio, so an unset value (→ empty `backendUrl` in `api-config.json`) is what you want. |

> Tip: never commit secrets. The `BACKEND_URL` is *not* a secret in the sense of
> security (it ends up in the client bundle), but it's stored as a secret to
> keep the value out of git history and let you rotate the backend host without
> a code change.

## First-time Dondominio setup

1. **Create an FTP user** scoped to the website's web root. Confirm that the
   FTP root maps to the same directory Apache serves as `donambauxa.online`.
   Test from your laptop with `ncftp` or any client before plugging it into CI.
2. **Apache config**: confirm that `mod_rewrite`, `mod_headers`, `mod_deflate`,
   and `mod_expires` are enabled. The frontend ships `.htaccess` rules that
   rely on all four. Dondominio enables them by default; if the rules ever
   look like they're being ignored, double-check this first.
3. **HTTPS**: PWAs require HTTPS in production. Dondominio's Let's Encrypt
   integration is sufficient. Service worker registration silently refuses on
   plain HTTP, which presents as "the app isn't installable" without any
   on-screen error.
4. **`apple-touch-icon` fallbacks**: iOS sometimes looks for
   `/apple-touch-icon.png` at the document root regardless of the `<link>` tag.
   Symlink or copy it during deploy if you see iOS using a generic icon:
   ```
   cp /assets/icons/apple-touch-icon-180.png /apple-touch-icon.png
   ```
   (The current CI doesn't do this — add it only if iOS users report a missing
   icon on the home screen.)

## Files the deploy uploads

The relevant ones the service worker depends on:

| Path | Purpose |
|------|---------|
| `/index.html` | App shell. Network-first w/ offline fallback. |
| `/manifest.webmanifest` | Web App Manifest, served as `application/manifest+json`. |
| `/sw.js` | Service worker. Apache (via `.htaccess`) sends `Cache-Control: no-store` + `Service-Worker-Allowed: /`. |
| `/version.json` | Freshness probe. Apache sends `Cache-Control: no-store`. |
| `/api-config.json` | Runtime backend URL. Cached by the SW; bump version to invalidate. |
| `/offline.html` | Fallback page when the network is down and the shell isn't cached. |
| `/assets/icons/*` | Manifest icons (192, 512, maskable, apple-touch-180). |
| `/css/main.css`, `/js/**`, `/locales/**`, `/data/**` (read-only from FTP exclude) | App code & static catalogs. |

## Manual rollback

If a bad deploy lands and you need to roll back faster than `git revert`
+ wait-for-CI:

1. Identify the previous good commit on GitHub.
2. Trigger the workflow manually against that commit:
   - Go to **Actions → Deploy Frontend a DonDominio → Run workflow**.
   - Pick the older SHA as the ref.
3. Wait for the new run to complete. The site is back to that revision.

Alternatively, FTP into Dondominio with the same credentials and restore from
the previous backup. Dondominio's hosting panel exposes daily backups under
**Backups** that can be restored in a couple of clicks.

## Troubleshooting

**The site looks the same after a deploy.**
The browser may still be running the previous service worker (the new one is
"installed" but not yet active). The PWA layer reloads automatically on the
*next* navigation when a shell upgrade is detected, but you can force it with
DevTools → Application → Service Workers → "Update on reload" + reload. Or open
`/version.json` directly and confirm the `app` field changed.

**`api-config.json` shows the wrong URL.**
- Check the `BACKEND_URL` secret in GitHub.
- Check the workflow run logs — there's a `[deploy] wrote frontend/api-config.json …`
  line confirming the value that was written.
- Bust the SW cache by bumping a file under `frontend/` (any change to `frontend/`
  triggers a new deploy, which bumps `version.json`, which forces clients to
  pick up the fresh `api-config.json`).

**CORS errors at runtime.**
With everything same-origin on Dondominio, CORS shouldn't trigger. If it does,
something has set `BACKEND_URL` to a non-empty value — check the workflow logs
and clear the secret if you didn't mean to set it. (CORS handling for cross-
origin backends only matters if you go back to a split-host setup, in which
case the allowlist lives in `server.js`.)
