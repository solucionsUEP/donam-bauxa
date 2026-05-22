#!/usr/bin/env node
/**
 * ollama-proxy — reverse proxy for a public Ollama endpoint
 *
 * Runs on the same machine as Ollama. Exposed to the internet via a Cloudflare
 * Tunnel (see TODO/OLLAMA-TUNNEL.md). Enforces two things the Vercel backend
 * cannot:
 *
 *   1. **Shared secret**: rejects anything without the right Bearer token, so
 *      the public hostname can be opportunistically discovered without giving
 *      randos free GPU time.
 *   2. **Concurrency cap**: caps how many requests are in-flight to Ollama at
 *      once. Excess requests get a 429 + Retry-After; the backend bubbles this
 *      up and the frontend shows a busy banner. This is the *hard* guard;
 *      Vercel's per-user rate limit is best-effort because of cold starts.
 *
 * Env vars:
 *   OLLAMA_URL              — local Ollama, default http://127.0.0.1:11434
 *   PROXY_PORT              — listen port, default 11500
 *   OLLAMA_SHARED_SECRET    — required; must match the Authorization header
 *   PROXY_MAX_CONCURRENT    — semaphore size, default 2
 *   PROXY_QUEUE_TIMEOUT_MS  — max time a request waits in queue, default 0 (no wait, fail-fast 429)
 */

import http from 'node:http';
import { request as upstreamRequest } from 'node:http';

const OLLAMA_URL = new URL(process.env.OLLAMA_URL || 'http://127.0.0.1:11434');
const PROXY_PORT = Number(process.env.PROXY_PORT || 11500);
const SHARED_SECRET = process.env.OLLAMA_SHARED_SECRET || '';
const MAX_CONCURRENT = Number(process.env.PROXY_MAX_CONCURRENT || 2);
const QUEUE_TIMEOUT_MS = Number(process.env.PROXY_QUEUE_TIMEOUT_MS || 0);

if (!SHARED_SECRET) {
  console.error('[ollama-proxy] OLLAMA_SHARED_SECRET is required. Refusing to start.');
  process.exit(1);
}

// Simple counting semaphore. Resolves when a slot is acquired; caller must release.
let inFlight = 0;
const waiters = [];

function acquire() {
  return new Promise((resolve, reject) => {
    if (inFlight < MAX_CONCURRENT) {
      inFlight++;
      return resolve();
    }
    // Fail-fast when QUEUE_TIMEOUT_MS=0: every "would have queued" becomes 429.
    if (QUEUE_TIMEOUT_MS <= 0) return reject(new Error('busy'));

    const waiter = { resolve, reject };
    waiters.push(waiter);
    waiter.timer = setTimeout(() => {
      const idx = waiters.indexOf(waiter);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(new Error('busy'));
    }, QUEUE_TIMEOUT_MS);
  });
}

function release() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  } else {
    inFlight = Math.max(0, inFlight - 1);
  }
}

// Constant-time-ish string compare. The bearer token isn't worth a real
// timing-safe primitive, but avoid the obvious short-circuit.
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

function proxy(req, res) {
  const opts = {
    hostname: OLLAMA_URL.hostname,
    port: OLLAMA_URL.port || 80,
    method: req.method,
    path: req.url,
    headers: { ...req.headers },
  };
  delete opts.headers.authorization; // strip; Ollama doesn't need it
  delete opts.headers['x-forwarded-for'];
  delete opts.headers['x-forwarded-proto'];
  // Let http.request set Host automatically from hostname:port — overriding
  // it here can confuse strict origins, and forgetting to set .end() on the
  // upstream for bodyless requests causes a "socket hang up" against Ollama.
  delete opts.headers.host;

  const upstream = upstreamRequest(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[ollama-proxy] upstream error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `upstream: ${err.message}` }));
  });

  // If the client aborts mid-request, kill the upstream stream too. Guard
  // against destroying the upstream *after* the response is already flowing
  // back; we only care about aborts that arrive while we're still receiving
  // the request body.
  let upstreamDone = false;
  upstream.on('response', () => { upstreamDone = true; });
  req.on('aborted', () => { if (!upstreamDone) try { upstream.destroy(); } catch {} });

  // GET/HEAD/DELETE have no body — end the upstream request immediately.
  // For other methods, pipe the incoming body through.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
}

const server = http.createServer(async (req, res) => {
  // Cheap health probe that doesn't need auth, doesn't hit Ollama, doesn't
  // count against the semaphore. Cloudflare uses this to mark the tunnel up.
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (!authMatches(req.headers.authorization)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  try {
    await acquire();
  } catch {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': '5',
    });
    return res.end(JSON.stringify({ error: 'busy', inFlight, max: MAX_CONCURRENT }));
  }

  // Whatever happens past here, free the slot when the response ends.
  res.on('close', release);
  res.on('finish', release);

  proxy(req, res);
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[ollama-proxy] listening on 127.0.0.1:${PROXY_PORT}`);
  console.log(`[ollama-proxy] upstream: ${OLLAMA_URL.href}`);
  console.log(`[ollama-proxy] max concurrent: ${MAX_CONCURRENT}, queue timeout: ${QUEUE_TIMEOUT_MS}ms`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
