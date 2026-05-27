# Secrets checklist

Every secret/env-var the project uses, where to set it, and why. If a row says
**MUST**, the system won't function in that environment without it.

There is no Vercel anymore — backend lives in PHP on Dondominio.

## GitHub Actions (frontend deploy)

Set under **Repo → Settings → Secrets and variables → Actions**.

| Name | Required | Used by | What it is |
|------|----------|---------|------------|
| `FTP_HOST` | MUST | `deploy-frontend.yml` | `ftp.donambauxa.online`. |
| `FTP_USER` | MUST | `deploy-frontend.yml` | `<username>.donambauxa.online` — counter-intuitively the username is the FQDN, the host is `ftp.<domain>`. |
| `FTP_PASSWORD` | MUST | `deploy-frontend.yml` | FTP password. Rotate annually + after sharing. |
| `BACKEND_URL` | **Leave unset** | `deploy-frontend.yml` (writes `frontend/api-config.json`) | Frontend and backend share the same origin. CI writes an empty `backendUrl` if this is unset, which makes the frontend hit same-origin (Dondominio's PHP). Only set this if you ever introduce a separate backend host. |

## Dondominio — `api/config.php` (gitignored)

This file lives **only on the production server**. Upload it once via FTP
when you first set up the site, and re-upload it whenever you rotate a key.
The CI excludes it on purpose so secrets never enter git history.

| Constant | Required | What it is |
|----------|----------|------------|
| `SUPABASE_URL` | MUST | `https://<your-project>.supabase.co`. From Supabase → Project Settings → API. |
| `SUPABASE_SERVICE_KEY` | MUST | The `service_role` secret. **Never** the `anon` key, **never** exposed to the browser. |
| `SUPABASE_JWT_SECRET` | MUST | Supabase → Settings → API → JWT Settings → JWT Secret. Used by PHP to validate Bearer tokens locally. |
| `DATA_DIR` | MUST | `dirname(__DIR__) . '/data'`. Already in the template. |
| `FRONTEND_URL` | MUST | `https://donambauxa.online`. |
| `OLLAMA_TUNNEL_URL` | MUST (for chat) | `https://ollama.donambauxa.online`. The Cloudflare Tunnel hostname. No trailing slash. |
| `OLLAMA_SHARED_SECRET` | MUST (for chat) | `openssl rand -hex 32`. Must match the value on the home server. |
| `OLLAMA_MODEL` | Optional | Defaults to `gemma4:e2b` in the PHP route. Override only if you pulled a different one. |

## Home server (Ollama proxy)

Lives in `/etc/donam-bauxa/proxy.env` (chmod 600), loaded by the systemd unit
`scripts/ollama-proxy.service`.

| Name | Required | What it is |
|------|----------|------------|
| `OLLAMA_SHARED_SECRET` | MUST | Same value as in `api/config.php`. Anything else gets 401. |
| `OLLAMA_URL` | Optional | Defaults to `http://127.0.0.1:11434`. Override if Ollama runs on a different host/port. |
| `PROXY_PORT` | Optional | Defaults to `11500`. Change if it conflicts with something. Update the cloudflared config to match. |
| `PROXY_MAX_CONCURRENT` | Optional | Defaults to `2`. How many generations the proxy lets run at once. Raise it if you have GPU headroom. |
| `PROXY_QUEUE_TIMEOUT_MS` | Optional | Defaults to `0` (fail-fast 429). Set to e.g. `2000` to make the proxy queue waiters up to 2s before returning 429. |

## Local dev (`.env` at repo root)

The Node server reads `.env` via `dotenv/config`. The Node server is **dev
only** — production uses PHP. None of these are committed.

| Name | Required | What it is |
|------|----------|------------|
| `SUPABASE_URL` | Optional | If unset, auth runs in **mock mode** (anyone is `dev@local` with admin role). Convenient for offline work. |
| `SUPABASE_SERVICE_KEY` | Optional | Pair with `SUPABASE_URL`. |
| `OLLAMA_URL` | Optional | Defaults to `http://127.0.0.1:11434`. Point at your tailnet IP if Ollama runs elsewhere on your LAN. |
| `OLLAMA_TUNNEL_URL` | Optional | If set, takes precedence over `OLLAMA_URL`. Use it to test the prod path locally. |
| `OLLAMA_SHARED_SECRET` | Optional | Set only if `OLLAMA_TUNNEL_URL` is set. |
| `OLLAMA_MODEL` | Optional | Defaults to `gemma4:e2b`. |
| `SESSION_SECRET`, `FRONTEND_URL`, `PORT`, `HOST`, `NODE_ENV` | Optional | Standard env knobs for the Node dev server. |

## Rotation procedure

When (not if) you need to rotate the shared secret:

1. Generate a new value: `openssl rand -hex 32`.
2. Edit your local copy of `api/config.php`, change `OLLAMA_SHARED_SECRET`.
   FTP-upload it. Apache picks it up on the next request (no restart needed).
3. Update `/etc/donam-bauxa/proxy.env` on the home server → `sudo systemctl
   restart ollama-proxy`.

If you flip steps 2 and 3, users see chat errors for ~30s while PHP still has
the old secret. Either order works; just don't leave it half-done.

Same procedure for `FTP_PASSWORD`, just rotate at Dondominio first.
