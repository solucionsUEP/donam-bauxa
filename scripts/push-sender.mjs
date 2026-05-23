#!/usr/bin/env node
/**
 * push-sender — Web Push fan-out service.
 *
 * Sits on the home server alongside ollama-proxy. Exposed to the internet via
 * the same cloudflared daemon (additional ingress entry, see TODO/PUSH-SETUP.md).
 *
 * Why a separate service instead of letting PHP do it directly?
 *   - Web Push requires ES256 VAPID JWT signing + aes128gcm payload encryption.
 *     Doing both correctly in PHP on shared hosting is finicky; Node's
 *     `web-push` library is the de-facto reference implementation.
 *   - Fan-out is naturally concurrent — Node's event loop handles dozens of
 *     simultaneous HTTPS POSTs to fcm/Mozilla/Apple push services in parallel.
 *
 * Request shape (POST /):
 *   {
 *     "payload": { "title": "...", "body": "...", "url": "/#events" },
 *     "subscriptions": [
 *       { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } },
 *       ...
 *     ]
 *   }
 *
 * Response:
 *   {
 *     "sent":   <number of 2xx responses>,
 *     "failed": [ { "endpoint": "...", "status": <int>, "reason": "..." } ],
 *     "gone":   [ "endpoint", ... ]  // 404/410 — caller should drop these
 *   }
 *
 * Env vars:
 *   PUSH_PORT             — listen port, default 11600
 *   PUSH_SHARED_SECRET    — required; matches the PHP backend
 *   VAPID_PUBLIC_KEY      — base64url, 65 bytes uncompressed
 *   VAPID_PRIVATE_KEY     — base64url, 32 bytes
 *   VAPID_SUBJECT         — "mailto:..." or "https://..."
 *   PUSH_MAX_CONCURRENT   — fan-out cap, default 20
 *   PUSH_TTL_SECONDS      — push TTL header, default 86400 (1 day)
 */

import http from 'node:http';
import webpush from 'web-push';

const PORT             = Number(process.env.PUSH_PORT || 11600);
const SHARED_SECRET    = process.env.PUSH_SHARED_SECRET || '';
const VAPID_PUBLIC     = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE    = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT    = process.env.VAPID_SUBJECT     || '';
const MAX_CONCURRENT   = Number(process.env.PUSH_MAX_CONCURRENT || 20);
const TTL              = Number(process.env.PUSH_TTL_SECONDS || 86400);

if (!SHARED_SECRET || !VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
  console.error('[push-sender] missing required env vars. Refusing to start.');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function authMatches(header) {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const given = m[1].trim();
  if (given.length !== SHARED_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ SHARED_SECRET.charCodeAt(i);
  return diff === 0;
}

async function readBody(req, max = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let len = 0;
    const chunks = [];
    req.on('data', (c) => {
      len += c.length;
      if (len > max) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(c);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Process at most `cap` items concurrently, preserving order in `out`. */
async function pmap(items, cap, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function sendOne(sub, payload) {
  try {
    const res = await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL,
      urgency: 'normal',
    });
    return { ok: true, status: res?.statusCode || 201, endpoint: sub.endpoint };
  } catch (err) {
    const status = err?.statusCode || 0;
    return {
      ok: false,
      status,
      endpoint: sub.endpoint,
      gone: status === 404 || status === 410,
      reason: err?.body?.toString?.()?.slice?.(0, 200) || err?.message || 'unknown',
    };
  }
}

const server = http.createServer(async (req, res) => {
  // Cheap auth-less health probe so the tunnel marks the origin up.
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.method !== 'POST' || req.url !== '/') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  }

  if (!authMatches(req.headers.authorization)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid json: ' + err.message }));
  }

  const payload = body?.payload;
  const subs    = Array.isArray(body?.subscriptions) ? body.subscriptions : [];
  if (!payload || !payload.title || subs.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'payload.title and subscriptions[] required' }));
  }

  const results = await pmap(subs, MAX_CONCURRENT, (s) => sendOne(s, payload));
  const sent   = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).map((r) => ({
    endpoint: r.endpoint, status: r.status, reason: r.reason,
  }));
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ sent, failed, gone, total: subs.length }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[push-sender] listening on 127.0.0.1:${PORT}`);
  console.log(`[push-sender] max concurrent: ${MAX_CONCURRENT}, ttl: ${TTL}s`);
});

process.on('SIGINT',  () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
