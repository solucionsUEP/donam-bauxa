# Dona'm Bauxa — Deployment & Operations

This folder is the operator's guide. Read the file that matches the work you
have in front of you.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Dondominio (panel247)                               │
│  https://donambauxa.online                           │
│   • Apache + .htaccess                               │
│   • Static SPA + PWA (frontend/)                     │
│   • PHP API (api/index.php → routes/)                │
│       └─ /api/chat (PHP) ──┐                         │
└────────────────────────────│─────────────────────────┘
        ▲                    │ Authorization: Bearer <shared secret>
        │ FTP via            ▼
        │ GitHub Actions    ┌──────────────────────────┐
        │                   │  Cloudflare Tunnel       │
        │                   │  ollama.donambauxa.online│
        │                   └──────────┬───────────────┘
        │                              │
        │                   ┌──────────▼───────────────┐
        │                   │  Home server             │
        │                   │   ollama-proxy.mjs       │
        │                   │     → Ollama (gemma4)    │
        │                   └──────────────────────────┘
        │
   Supabase (Auth + Postgres) — called by PHP via cURL
```

The frontend ships with a **service worker** (`frontend/sw.js`) and a **Web App
Manifest** (`frontend/manifest.webmanifest`), so it installs as a PWA on iOS,
Android, and desktop. Frontend and backend share the origin `donambauxa.online`
— **no CORS, no separate backend host**. The only off-host hop is chat →
Cloudflare Tunnel → home-server Ollama.

## Documents

| File | What it covers |
|------|----------------|
| **[`MANUAL-SETUP.md`](./MANUAL-SETUP.md)** | **Start here.** End-to-end checklist of everything you have to do manually (Dondominio config, FTP upload of `api/config.php`, Cloudflare Tunnel, PWA verification). |
| [`DEPLOY-DONDOMINIO-FRONTEND.md`](./DEPLOY-DONDOMINIO-FRONTEND.md) | First-time setup of the Dondominio host (FTP user, GitHub secrets, manual rollback). |
| [`OLLAMA-TUNNEL.md`](./OLLAMA-TUNNEL.md)                           | How chat reaches your home server's Ollama (Cloudflare Tunnel + shared-secret proxy + concurrency cap). |
| [`PWA-OPERATIONS.md`](./PWA-OPERATIONS.md)                         | How the service worker decides when to refresh caches, how to force a refresh, how to debug a stale shell. |
| [`SECRETS-CHECKLIST.md`](./SECRETS-CHECKLIST.md)                   | Every secret/env var the project needs and where to set it. |

> `DEPLOY-VERCEL-BACKEND.md` is obsolete — the project no longer uses Vercel.
> The file is kept for reference in case you ever migrate back, but ignore it
> for current operations.

## Quick reference

* **Deploy a frontend change**: push to `main` with anything under `frontend/`,
  `scripts/`, or `package.json`. CI runs `npm run build:version`, templates
  `api-config.json`, and FTPs the bundle to Dondominio. See
  [`DEPLOY-DONDOMINIO-FRONTEND.md`](./DEPLOY-DONDOMINIO-FRONTEND.md).
* **Deploy a PHP backend change**: push to `main` with anything under
  `api/**.php`. The same FTP deploy carries it. The PHP file goes live as
  soon as the upload completes (no restart needed).
* **Rotate a secret in `api/config.php`**: edit your local copy, re-upload via
  FTP. Apache picks it up on the next request.
* **Force a PWA refresh on all clients**: bump `frontend/version.json` (a fresh
  deploy already does this via the build step). The next time a client opens
  the app, the service worker rotates caches and reloads. See
  [`PWA-OPERATIONS.md`](./PWA-OPERATIONS.md).
