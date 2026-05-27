# Push-sender setup (home server, Fedora)

This brings up the Web Push fan-out service alongside `ollama-proxy`:

```
PHP backend (Dondominio)
   │  POST { payload, subscriptions[] }
   ▼
https://push.hashingbug.uk           ← Cloudflare Tunnel ingress
   │
cloudflared (existing daemon)
   │
http://127.0.0.1:11600               ← push-sender.mjs (new systemd unit)
   │  encrypt + sign + POST
   ▼
Browser push services (FCM / Mozilla / Apple)
```

Total moving parts the home server gains over what's already there:
1. One env file at `/etc/donam-bauxa/push-sender.env`.
2. One systemd unit at `/etc/systemd/system/push-sender.service`.
3. One extra `ingress:` entry in `~/.cloudflared/config.yml` for the new
   hostname.
4. One DNS route on Cloudflare's side (`cloudflared tunnel route dns ...`).

## 1. Pull latest code on the home server

```bash
cd /mnt/purple/donam-bauxa
git pull
npm install   # picks up the new `web-push` dep
```

## 2. Add the cloudflared ingress

Edit `~/.cloudflared/config.yml` and add a second ingress block **before** the
catch-all 404. Final file should look like:

```yaml
tunnel: a7c77c7a-46e3-41bc-8274-be0fbb5d76f7
credentials-file: /home/hashingbug/.cloudflared/a7c77c7a-46e3-41bc-8274-be0fbb5d76f7.json
originRequest:
  connectTimeout: 10s
  tcpKeepAlive: 30s
  http2Origin: false
ingress:
  - hostname: ollama.hashingbug.uk
    service: http://127.0.0.1:11500
  - hostname: push.hashingbug.uk
    service: http://127.0.0.1:11600
  - service: http_status:404
```

Then register the DNS route once:

```bash
cloudflared tunnel route dns a7c77c7a-46e3-41bc-8274-be0fbb5d76f7 push.hashingbug.uk
```

Restart the daemon so the new ingress takes effect:

```bash
sudo systemctl restart cloudflared
```

## 3. Install env file + systemd unit

The installer never embeds secrets — supply them at install time. The values
must match the corresponding `define()`s in `api/config.php` on Dondominio.

```bash
sudo VAPID_PUBLIC_KEY='B...' \
     VAPID_PRIVATE_KEY='...' \
     VAPID_SUBJECT='mailto:you@example.com' \
     PUSH_SHARED_SECRET='...' \
     bash scripts/install-push-sender.sh
```

After the env file at `/etc/donam-bauxa/push-sender.env` exists, future
re-installs (e.g. just to pick up a code change in `push-sender.mjs`) can use:

```bash
sudo bash scripts/install-push-sender.sh --reuse
```

The script writes `/etc/donam-bauxa/push-sender.env` (chmod 600) and
`/etc/systemd/system/push-sender.service`, then `systemctl daemon-reload`
+ `enable --now`.

## 4. Verify

```bash
# locally on the home server — no auth, no Ollama, no push services
curl -i http://127.0.0.1:11600/healthz

# through the tunnel — should also be "ok"
curl -i https://push.hashingbug.uk/healthz

# end-to-end: subscribe in your browser, then trigger an admin announcement
# from /admin → "Anunci" tab.
```

## Rotating the shared secret

If you ever rotate `PUSH_SENDER_SECRET`:
1. Edit `/etc/donam-bauxa/push-sender.env` and bump the value.
2. `sudo systemctl restart push-sender`.
3. Edit `api/config.php` (on Dondominio) and FTP-upload it.

Until both sides match, broadcasts return 502 from `/api/admin/announce`.
