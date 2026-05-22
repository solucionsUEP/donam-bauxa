# Manual setup — end-to-end checklist

Everything you have to do **by hand** to get the production site working:
Dondominio hosting (panel247), the home-server Ollama tunnel, and the PWA
cache-sync flow. Each step says **where** to do it and **why** it matters.

Once these are done, day-to-day work is just `git push` — CI does the rest.

> Convention: lines starting with `$` are commands you run in your terminal.
> Lines starting with `#` are explanations or shell prompts (root vs user).

---

## Architecture (no Vercel)

Everything except chat-to-Ollama lives on Dondominio:

```
                   ┌──────────────────────────────────────┐
                   │  Dondominio (panel247.com)           │
                   │   Apache + PHP 8                     │
                   │   • static SPA (frontend/)           │
                   │   • api/ PHP routes (profile, etc.)  │
                   │   • api/routes/chat.php → tunnel     │
                   └──────────────────┬───────────────────┘
                                      │ Authorization: Bearer <shared secret>
                                      ▼
                   ┌──────────────────────────────────────┐
                   │  https://ollama.donambauxa.online    │
                   │  Cloudflare Tunnel (TLS terminated)  │
                   └──────────────────┬───────────────────┘
                                      │
                   ┌──────────────────▼───────────────────┐
                   │  Home server                         │
                   │   ollama-proxy.mjs (loopback only)   │
                   │     → secret check, concurrency cap  │
                   │     → Ollama (gemma4:e2b)            │
                   └──────────────────────────────────────┘
```

Since the frontend and backend share the origin `donambauxa.online`, there is
**no CORS, no `BACKEND_URL` secret to set, no Vercel project to maintain**.
Browser → PHP → Tunnel → Ollama.

---

## 0. What you'll need before you start

| Item | Where to get it |
|------|-----------------|
| Dondominio FTP credentials | panel247 → FTP accounts |
| Dondominio SSH access (recommended, not required) | panel247 → SSH access — easier than FTP for editing `api/config.php` |
| A Cloudflare account | https://dash.cloudflare.com — free tier is enough |
| Your home server with Ollama running | Already done; `gemma4:e2b` pulled |
| `cloudflared` installed on the home server | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ |
| 32+ random bytes for the shared secret | `openssl rand -hex 32` |
| GitHub admin access to the repo | To set the Actions secrets |

You'll collect ~5 secret values along the way. The
**SECRETS-CHECKLIST.md** sibling doc lists them all in one table.

---

## 1. Dondominio (panel247) — frontend + PHP backend

Everything that isn't chat runs here.

### 1.1 Confirm Apache modules are enabled

panel247 enables these by default — but check with their support chat if
anything looks off later:

* `mod_rewrite` (for `.htaccess` SPA fallback + `/api/*` routing to PHP)
* `mod_headers` (no-cache headers on `/version.json` and `/sw.js`)
* `mod_deflate`, `mod_expires` (compression + caching of versioned assets)
* PHP 8.0+ with `curl`, `json`, `openssl` extensions

### 1.2 Create an FTP user scoped to the website root

1. panel247 → **FTP** → new user.
2. Scope it to the directory Apache serves as `donambauxa.online`.
3. Test from your laptop with `curl` (already installed, no need for ncftp).
   The FTP host panel247 gives you usually looks like `<username>.donambauxa.online`:
   ```bash
   $ curl -s --user '<user>:<pass>' ftp://<host>/ | head -40
   # you should see index.html, .htaccess, etc.

   # If it fails, run with -v to see the FTP protocol chat:
   $ curl -v --user '<user>:<pass>' ftp://<host>/
   ```
   If your password has special characters like `@`, prefer `--user 'user:pass'`
   over embedding them in the URL — `curl` URL-decodes the URL form but not
   the `--user` form, so this avoids the `%40` escaping dance.

### 1.3 (One-time) Make sure HTTPS is active

panel247 → **SSL/TLS** → Let's Encrypt → enable for `donambauxa.online` and
`www.donambauxa.online`. PWAs **silently** fail to install on plain HTTP, so
this is non-negotiable.

### 1.4 Upload `api/config.php` (gitignored — never in CI)

The PHP backend reads its secrets from `api/config.php`, which is **not in
git**. Create it on your laptop and FTP it to the server's `api/` directory
exactly once (then re-upload whenever you rotate keys):

```php
<?php
// api/config.php — gitignored; lives only on the server.

define('SUPABASE_URL',         'https://bczgsjpqbterxwegqgho.supabase.co');
define('SUPABASE_SERVICE_KEY', 'eyJ…');               // service_role secret
define('SUPABASE_JWT_SECRET',  '…');                   // Auth → JWT settings
define('DATA_DIR',             dirname(__DIR__) . '/data');
define('FRONTEND_URL',         'https://donambauxa.online');

// Chat: where api/routes/chat.php forwards generation requests.
// Fill these in **after** you set up the Cloudflare Tunnel in step 2.
define('OLLAMA_TUNNEL_URL',    'https://ollama.donambauxa.online');
define('OLLAMA_SHARED_SECRET', '<paste 32-byte hex from `openssl rand -hex 32`>');
define('OLLAMA_MODEL',         'gemma4:e2b');
```

The CI excludes this path on purpose so secrets never touch git history.

### 1.5 Set the GitHub Actions secrets (for the CI deploy)

GitHub → **repo → Settings → Secrets and variables → Actions**. Add:

| Secret | Value |
|--------|-------|
| `FTP_HOST` | `ftp.donambauxa.online` |
| `FTP_USER` | `<username>.donambauxa.online` (e.g. `DLC22.donambauxa.online` — full FQDN even though it looks like a host) |
| `FTP_PASSWORD` | the password from step 1.2 |

> **Skip `BACKEND_URL`** — leave it unset. The CI will warn and write an
> empty `backendUrl` to `api-config.json`, which makes the frontend hit the
> same origin (Dondominio's PHP). That's exactly what you want here.

### 1.6 Trigger the first deploy

```bash
$ git commit --allow-empty -m "chore: kick first frontend deploy"
$ git push
```

Watch **GitHub → Actions → Deploy Frontend a DonDominio**. Looking for:

* A green run that ends in the "Summary" step.
* The summary panel prints the `version.json` it produced.
* `curl https://donambauxa.online/version.json` returns that same JSON.
* `curl -i https://donambauxa.online/api/profile` returns 401 (no token →
  PHP rejects). That proves the PHP router is alive.

---

## 2. Public Ollama tunnel (Cloudflare Tunnel)

This is what lets the PHP backend reach your home server's Ollama without
requiring users to be on your tailnet.

### 2.1 Generate the shared secret (if you haven't yet)

```bash
$ openssl rand -hex 32
3a7f… (long hex string)
```

Paste it into `api/config.php` on the Dondominio server (step 1.4) **and**
into the home server's environment file (next).

### 2.2 Deploy the proxy on the home server

The proxy is the file `scripts/ollama-proxy.mjs` in this repo. It validates
the shared secret, caps concurrency, and forwards to local Ollama.

On the home server:

```bash
# Pick a stable location for the code:
$ sudo mkdir -p /opt/donam-bauxa
$ sudo chown $USER /opt/donam-bauxa
$ git clone https://github.com/<you>/donam-bauxa.git /opt/donam-bauxa
$ cd /opt/donam-bauxa

# Write the proxy environment file:
$ sudo mkdir -p /etc/donam-bauxa
$ sudo tee /etc/donam-bauxa/proxy.env >/dev/null <<'EOF'
OLLAMA_SHARED_SECRET=<paste the secret from step 2.1>
OLLAMA_URL=http://127.0.0.1:11434
PROXY_PORT=11500
PROXY_MAX_CONCURRENT=2
EOF
$ sudo chmod 600 /etc/donam-bauxa/proxy.env

# Install the systemd unit:
$ sudo cp scripts/ollama-proxy.service /etc/systemd/system/
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now ollama-proxy
$ sudo systemctl status ollama-proxy   # should be "active (running)"
```

Smoke test from the home server:

```bash
$ curl -i http://127.0.0.1:11500/healthz
HTTP/1.1 200 OK
ok

$ curl -i http://127.0.0.1:11500/api/tags
HTTP/1.1 401 Unauthorized   # ← good: secret required

$ curl -i http://127.0.0.1:11500/api/tags -H "Authorization: Bearer <the secret>"
HTTP/1.1 200 OK
{"models":[…]}
```

### 2.3 Set up the Cloudflare Tunnel

On the home server:

```bash
$ cloudflared tunnel login                       # browser-opens; pick your domain
$ cloudflared tunnel create donam-bauxa-ollama
# writes ~/.cloudflared/<UUID>.json — note the UUID

# Route the subdomain to the tunnel:
$ cloudflared tunnel route dns donam-bauxa-ollama ollama.donambauxa.online
```

> `donambauxa.online` must be a Cloudflare zone for the DNS route to work.
> If it isn't yet: https://dash.cloudflare.com → **Add a site** → free plan.
> Cloudflare gives you two nameservers. Two options:
>
> a. **Full delegation** — change Dondominio's nameservers to Cloudflare's at
>    panel247 → **DNS / Domain settings**. All DNS goes through Cloudflare;
>    Dondominio keeps serving the website but no longer answers DNS.
>    Cleanest, recommended.
>
> b. **Subdomain delegation only** — leave Dondominio in charge of the apex
>    and add an `NS` record for `ollama` pointing at Cloudflare's NS. panel247
>    may not support `NS` records on subdomains — ask their chat first.
>
> Option (a) is what I'd recommend. It does not affect how panel247 serves
> the site; it only changes which DNS authority answers queries.

Now drop the tunnel config:

```bash
$ sudo mkdir -p /etc/cloudflared
$ sudo cp /opt/donam-bauxa/scripts/cloudflared-config.example.yml /etc/cloudflared/config.yml
# Edit /etc/cloudflared/config.yml and:
#   1. Replace <UUID-from-step-3> with the UUID cloudflared printed.
#   2. Update credentials-file path to /etc/cloudflared/<UUID>.json
$ sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/

$ sudo cloudflared service install
$ sudo systemctl enable --now cloudflared
$ sudo systemctl status cloudflared
```

### 2.4 Verify the public endpoint

From any machine (not the home server):

```bash
$ curl https://ollama.donambauxa.online/healthz
ok

$ curl -i https://ollama.donambauxa.online/api/tags
HTTP/1.1 401 Unauthorized   # ← good

$ curl -i https://ollama.donambauxa.online/api/tags \
       -H "Authorization: Bearer <the secret>"
HTTP/1.1 200 OK
{"models":[…]}
```

### 2.5 PHP chat route (already in the repo)

The PHP route at `api/routes/chat.php` bridges browser → Cloudflare Tunnel
→ home-server Ollama. It mirrors what `routes/chat.js` does in Node:

* Validates the Supabase JWT via `api/helpers/auth.php` (`requireAuth()`).
* Best-effort per-user rate limit (8 / 60s, file-backed in `sys_get_temp_dir`).
* cURLs the tunnel with `Authorization: Bearer OLLAMA_SHARED_SECRET` and
  streams NDJSON chunks back to the browser via `CURLOPT_WRITEFUNCTION`.
* Bubbles up 429 from the proxy with the `Retry-After` header preserved.

It needs three constants in `api/config.php` (you added them in step 1.4):
`OLLAMA_TUNNEL_URL`, `OLLAMA_SHARED_SECRET`, and optionally `OLLAMA_MODEL`.
The router entry is already in `api/index.php`.

Smoke test from your laptop once the tunnel is live:

```bash
# Get a Supabase JWT (open the site → sign in → DevTools → Network →
# pick any request → copy the Authorization header value).
$ curl -i https://donambauxa.online/api/chat \
       -H "Authorization: Bearer <supabase-jwt>" \
       -H "Content-Type: application/json" \
       -d '{"messages":[{"role":"user","content":"hola"}]}'
HTTP/1.1 200 OK
{"message":{…}}   # streaming NDJSON
```

If you see 502, PHP can't reach the tunnel — verify `OLLAMA_TUNNEL_URL` in
`api/config.php` and that `cloudflared` is running on the home server.

---

## 3. PWA cache-sync — what you have to know

The good news: **once steps 1–2 are done, you do not have to do anything to
make caches refresh on user devices.** CI bumps `frontend/version.json` every
deploy, the service worker notices, and rotates caches on the next visit.

But it depends on three things being correctly served by panel247's Apache.
Confirm them once:

### 3.1 `version.json` must be `no-store`

```bash
$ curl -I https://donambauxa.online/version.json
…
Cache-Control: no-store, no-cache, must-revalidate
```

If you see anything cacheable (`max-age=…`, `public`), the `.htaccess` rules
aren't being honored. Open a panel247 support ticket to confirm
`mod_headers` is on.

### 3.2 `sw.js` must be `no-store` AND have the right scope header

```bash
$ curl -I https://donambauxa.online/sw.js
…
Cache-Control: no-store, no-cache, must-revalidate
Service-Worker-Allowed: /
```

Same fix as above if missing.

### 3.3 The manifest must be served as `application/manifest+json`

```bash
$ curl -I https://donambauxa.online/manifest.webmanifest
…
Content-Type: application/manifest+json
```

If Apache serves it as `application/octet-stream`, install prompts won't show.
The `.htaccess` declares the MIME type — escalate to panel247 if it's wrong.

### 3.4 What "forcing a refresh" looks like

You almost never need to do this — every deploy is automatically a refresh.

* **You changed code**: `git push` → CI runs `npm run build:version` → new
  `version.json` ships → next time each client opens the app, the SW notices
  the mismatch, rotates caches, reloads exactly once.
* **You changed data via the admin panel (not via git)**: nothing bumps
  `version.json`, so caches keep the old data. Workaround: push an empty
  commit (`git commit --allow-empty -m "bump"`) to trigger a deploy.
* **A specific user reports stale content**: have them DevTools → Application
  → Storage → Clear site data → reload. See
  [`PWA-OPERATIONS.md`](./PWA-OPERATIONS.md#the-user-reports-the-site-is-stuck-on-an-old-version).

---

## 4. Putting it all together — what a normal `git push` does now

```
   you: git push
    │
    └─ GitHub Actions (deploy-frontend.yml)
        ├─ npm ci
        ├─ npm run build:version  ──► frontend/version.json
        ├─ inject backendUrl (empty) into api-config.json
        └─ FTP upload to Dondominio
             (api/config.php is excluded; you uploaded it once manually)
```

User devices learn about the deploy by:

```
   user opens https://donambauxa.online
    │
    ├─ fetches /version.json  ──► no-store, always fresh
    │   compares to its current cache → mismatch
    │
    ├─ for shell change: SW activates, reloads once
    ├─ for data change: SW silently refreshes, no reload
    │
    └─ chat → /api/chat on Dondominio (same-origin PHP)
              │ (Authorization: Bearer <supabase-jwt>)
              │
              ├─ api/helpers/auth.php validates the JWT against Supabase
              ├─ per-user rate limit (TBD in chat.php)
              │
              └─ cURL POST https://ollama.donambauxa.online/api/chat
                  │ (Authorization: Bearer <OLLAMA_SHARED_SECRET>)
                  │
                  └─ home-server proxy
                      ├─ secret check
                      ├─ concurrency cap (2 at a time → 429 if busy)
                      └─ pipes to local Ollama
```

---

## 5. Pre-push checklist (every push, takes 30 seconds)

1. `npm run dev` locally — confirm the change works at `http://localhost:3000`.
2. If you changed any `frontend/data/*.json` from your laptop, that's fine —
   CI will pick up the mtime change and bump `version.json` automatically.
3. **Do not commit `api-config.json`, `version.json`, or `api/config.php`** —
   they're regenerated by CI or, in PHP's case, gitignored and uploaded by hand.
4. `git push origin main` — and you're done.

---

## See also

* [`SECRETS-CHECKLIST.md`](./SECRETS-CHECKLIST.md) — every secret in one table.
* [`DEPLOY-DONDOMINIO-FRONTEND.md`](./DEPLOY-DONDOMINIO-FRONTEND.md) — frontend CI details, rollback.
* [`OLLAMA-TUNNEL.md`](./OLLAMA-TUNNEL.md) — how chat reaches Ollama, tuning, debugging.
* [`PWA-OPERATIONS.md`](./PWA-OPERATIONS.md) — service-worker debugging.
