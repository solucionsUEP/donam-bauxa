# Ollama public tunnel — design & operations

How the Dondominio PHP backend reaches your home-server Ollama install
without users having to be on your tailnet, and how to keep it healthy.

## The shape

```
   Browser (signed-in user)
        │  Authorization: Bearer <Supabase JWT>
        ▼
   /api/chat on Dondominio PHP backend  ──── auth check + per-user rate limit (best-effort)
        │  Authorization: Bearer <OLLAMA_SHARED_SECRET>
        ▼
   https://ollama.donambauxa.online   ◄── Cloudflare Tunnel (TLS terminated by Cloudflare)
        │
   ┌────┴───────────────────────────────────────┐
   │ Home server (cloudflared on loopback)      │
   │   │                                        │
   │   ▼ 127.0.0.1:11500                        │
   │ ollama-proxy.mjs                           │
   │   • validates the shared secret             │
   │   • semaphore: at most N generations at once│
   │   • returns 429 + Retry-After if busy       │
   │   │                                        │
   │   ▼ 127.0.0.1:11434                        │
   │ Ollama                                     │
   └────────────────────────────────────────────┘
```

## Why three hops?

* **TLS + a stable hostname**: Dondominio PHP backend can't talk to your home IP directly
  (probably dynamic, behind NAT). Cloudflare Tunnel solves both.
* **Auth**: the tunnel hostname is publicly resolvable — anyone who finds it
  could open a TCP connection. The shared-secret check at the proxy is the
  thing that keeps strangers from using your GPU.
* **Concurrency**: a single-GPU home box can run maybe 1–2 generations at the
  same time before quality and latency tank. The proxy semaphore is the only
  honest place to enforce that — the PHP backend has no shared in-process
  state across requests (each request is a fresh PHP process), so it can't
  reliably coordinate among itself.

## Why not just Tailscale Funnel?

Two reasons:
1. Funnel exposes a `*.<tailnet>.ts.net` hostname. It works but is uglier in
   server logs and harder to share if you ever need to.
2. Funnel ties uptime to Tailscale itself. Cloudflare Tunnel is decoupled.

If you'd rather: `tailscale funnel 11500` on the home server, then set
`OLLAMA_TUNNEL_URL=https://<host>.<tailnet>.ts.net` in `api/config.php`.
Same shared-secret guard, same proxy. The proxy works either way.

## Operating the proxy

The proxy is supervised by systemd (`ollama-proxy.service`).

```bash
# Status:
$ systemctl status ollama-proxy

# Restart after editing /etc/donam-bauxa/proxy.env:
$ sudo systemctl restart ollama-proxy

# Tail logs:
$ journalctl -u ollama-proxy -f
```

It binds to `127.0.0.1:11500` — never directly to the public interface. The
only way in is through cloudflared.

## Operating cloudflared

```bash
# Status:
$ systemctl status cloudflared

# Tail logs (useful if the tunnel is "down" but proxy is up):
$ journalctl -u cloudflared -f

# Restart after editing /etc/cloudflared/config.yml:
$ sudo systemctl restart cloudflared

# List your tunnels:
$ cloudflared tunnel list
```

## Tuning concurrency

Right now: `PROXY_MAX_CONCURRENT=2`, `PROXY_QUEUE_TIMEOUT_MS=0`.

Meaning: at most 2 generations run at once; the 3rd request gets an
immediate 429. The PHP backend bubbles up the 429 to the frontend, which
shows a "the assistant is busy" banner with a retry timer.

To tune:

* **Raise `PROXY_MAX_CONCURRENT`** if your GPU has headroom (e.g. 24GB VRAM
  → `gemma4:e2b` is ~2GB, so 4 concurrent fits easily on paper, in practice
  test it before pushing).
* **Raise `PROXY_QUEUE_TIMEOUT_MS`** if you'd rather have users wait a few
  seconds than see an error. e.g. `2000` queues up to 2s. Don't go higher
  than ~5s — beyond that the frontend will start timing out anyway.

Don't both raise concurrency AND lengthen the queue without testing — that
multiplies the worst-case latency for the user at the end of the queue.

## Health probes

Three layers, each useful when something is broken:

```bash
# 1. Ollama itself (on the home server):
$ curl http://127.0.0.1:11434/api/tags
# → if this fails, Ollama is the problem.

# 2. Proxy (on the home server):
$ curl http://127.0.0.1:11500/healthz
# → if this fails, ollama-proxy is the problem.

# 3. Public tunnel (from anywhere):
$ curl https://ollama.donambauxa.online/healthz
# → if this fails, cloudflared is the problem (or DNS).
```

If you ever wonder "is the issue in front of or behind cloudflared", run
all three. Whichever fails first points at the layer.

## What happens during an Ollama upgrade

When you `ollama pull` a new model or restart the Ollama daemon, the proxy
keeps running but in-flight requests fail. Acceptable for an event-discovery
chatbot — users see one error and retry. If you ever need a graceful upgrade
window: `sudo systemctl stop cloudflared`, do the upgrade, restart cloudflared.
The frontend gracefully degrades while the tunnel is down.

## What happens if your home internet is down

* The tunnel goes down → `/api/chat` (PHP) returns 502.
* The frontend treats 502 as a transient error and shows a "chat unavailable
  right now" message.
* The rest of the site is unaffected — only chat depends on the home server.

This is acceptable for an event-discovery side feature. If chat ever becomes
core, host Ollama on a real server (Runpod, Modal, Vast.ai) instead of the
home box.

## Rotating the shared secret

Twice a year, or any time you suspect the secret leaked:

```bash
# 1. New secret:
$ openssl rand -hex 32

# 2. Edit your local copy of api/config.php → update OLLAMA_SHARED_SECRET →
#    FTP-upload it to the Dondominio /api/ directory. Apache picks up the new
#    value on the next request — no restart needed.

# 3. Update home server:
$ sudo $EDITOR /etc/donam-bauxa/proxy.env   # paste new value
$ sudo systemctl restart ollama-proxy
```

If you flip the order of steps 2 and 3, users see chat errors briefly while
PHP still holds the old secret. Either order works; just don't leave it
half-done.
