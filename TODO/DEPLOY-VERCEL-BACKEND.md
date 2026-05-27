# Backend deploy — Vercel

The Node/Express backend (`server.js` + `routes/`) runs on Vercel. The frontend
on Dondominio calls it cross-origin; CORS is configured in `server.js`.

## What's automatic vs manual

| Step | Automatic | Manual |
|------|-----------|--------|
| Build & deploy on push to `main` | ✓ via Vercel's Git integration | — |
| `npm install` on Vercel | ✓ | — |
| Custom domain + TLS | — | one-time, in Vercel dashboard |
| Env vars (Supabase keys, etc.) | — | one-time, in Vercel dashboard |
| CORS allowlist | ✓ (lives in `server.js`) | edit code to add new origins |

## First-time setup

### 1. Import the repo

* Vercel dashboard → **New Project** → pick this GitHub repo.
* **Framework Preset**: *Other*. Don't accept any of the auto-detected frameworks.
* **Root Directory**: leave at repo root.
* **Build Command**: leave empty (Vercel will call `npm install`; the Node
  server starts itself).
* **Output Directory**: leave empty.
* **Install Command**: `npm ci --no-audit --no-fund` (faster + deterministic).

### 2. Tell Vercel how to start the server

Express apps need `vercel.json` so Vercel routes every request to `server.js`
running on the Node runtime. Add this at the repo root (commit it):

```json
{
  "version": 2,
  "buildCommand": null,
  "installCommand": "npm ci --no-audit --no-fund",
  "framework": null,
  "functions": {
    "server.js": { "runtime": "nodejs20.x" }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": "/server.js" }
  ],
  "github": { "silent": false }
}
```

> ⚠️ Vercel's Node runtime is **serverless**: each request gets a fresh function
> invocation. `server.js` exports the Express app (`export default app`), and
> the platform wires it up. Cold-start latency is ~150ms on `nodejs20.x`; warm
> requests are ~10ms.

### 3. Environment variables

Set under **Project → Settings → Environment Variables** for **Production**,
**Preview**, and **Development** as needed:

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Your Supabase REST URL. |
| `SUPABASE_SERVICE_KEY` | Service role key (server-side only — never expose). |
| `NODE_ENV` | `production` for the prod environment. |
| `PORT` | Vercel sets this automatically. **Do not override.** |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Only if you proxy a chat LLM. Optional. |
| `FRONTEND_URL` | `https://donambauxa.online`. Used by anything that needs to know the canonical web origin. |

After adding env vars, hit **Redeploy** for them to take effect on the current
deployment.

### 4. Custom domain

Decide whether to expose the backend as a subdomain you control (recommended)
or rely on the bare `<project>.vercel.app` URL.

* **With custom domain**: add `api.donambauxa.online` in **Settings → Domains**.
  Add the CNAME record Vercel shows you to Dondominio's DNS. Once verified,
  put `https://api.donambauxa.online` in the GitHub `BACKEND_URL` secret.
* **Without custom domain**: put `https://<project>.vercel.app` in the secret.
  Simpler but the URL is tied to Vercel's project name.

### 5. CORS

`server.js` already allows:

* `https://donambauxa.online` and `https://www.donambauxa.online`
* `*.vercel.app` (preview deploys)
* Localhost (any port)
* Tailnet (`100.x.x.x` and `*.ts.net`)

If you add another origin (a marketing landing page, a staging domain, etc.),
edit `PROD_ORIGINS` or the regex in `server.js` and push. Vercel redeploys
automatically.

### 6. Verify the deploy

After the first Vercel deploy completes:

```bash
curl https://<vercel-host>/version.json
# → {"app":"…","data":"…"}

curl -i https://<vercel-host>/version.json -H "Origin: https://donambauxa.online"
# → look for: Access-Control-Allow-Origin: https://donambauxa.online
```

Then update the GitHub `BACKEND_URL` secret to point at this host. The next
frontend deploy will inject it into `/api-config.json`.

## Day-to-day deploys

* Push to `main` → Vercel auto-deploys to production.
* Open a PR → Vercel publishes a preview deploy at `https://<branch>-<hash>.vercel.app`.
  Preview URLs are accepted by the same CORS regex, so the production frontend
  can target them temporarily for QA by editing `api-config.json` in DevTools.

## Vercel-specific gotchas

* **Server state**: each function invocation gets a fresh container. Don't
  rely on in-memory state across requests (existing code is already stateless;
  watch out when adding new code).
* **Long-lived connections**: WebSockets and SSE don't survive the serverless
  model well. If you ever add real-time features, host them separately
  (e.g. Vercel Edge Functions or a different platform).
* **File writes**: `/tmp` is writable but ephemeral. Anything you need
  persisted goes to Supabase, not the filesystem.
* **Cold starts**: the first request after a long idle takes ~150ms longer.
  This is fine for an event-listing app; it would be painful for a chat app.
  If chat latency matters, keep the Ollama proxy on a long-running host.

## Rollback

* **Via Vercel dashboard**: **Deployments → ⋯ → Promote to Production** on the
  last-known-good build. Instant.
* **Via Git**: `git revert <bad-sha>` and push. Triggers a new deploy.

Prefer Promote-to-Production for emergencies — it's atomic and doesn't add a
revert commit to history.
