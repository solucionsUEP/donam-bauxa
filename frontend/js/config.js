/**
 * @module config
 * @description Bootstrap-time configuration. Resolves the backend URL from
 * `/api-config.json` (deployed alongside the frontend on Dondominio), creates
 * the Supabase client, and exposes an `apiFetch` helper that attaches the
 * current Supabase JWT.
 *
 * Top-level await is used intentionally — every fetch in the app needs the
 * resolved `BACKEND_URL`, so blocking module evaluation until the config is
 * loaded keeps callers from having to await it themselves.
 */

if (!window.supabase) {
  console.error('[config] window.supabase no definit! El script CDN no ha carregat.');
}
const { createClient } = window.supabase;

const SUPABASE_URL = 'https://bczgsjpqbterxwegqgho.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pC8DdXjqtBwsCbqz8sFjww_Dh34Jb7Z';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('[config] Supabase client creat OK');

/**
 * Resolves the backend base URL.
 *   1. Fetches /api-config.json (served from the same origin as the frontend).
 *   2. Falls back to same-origin ('') if the file is missing or malformed —
 *      keeps local/dev (Node + Express on :3000) working unchanged.
 *   3. The service worker is told the resulting origin via postMessage so it
 *      can keep API responses network-only even when cross-origin.
 */
async function loadBackendUrl() {
  try {
    const res = await fetch('/api-config.json', { cache: 'no-store' });
    if (!res.ok) return '';
    const json = await res.json();
    if (typeof json.backendUrl === 'string') return json.backendUrl;
    return '';
  } catch {
    return '';
  }
}

const rawBackendUrl = await loadBackendUrl();
// Normalise: strip trailing slash so `BACKEND_URL + '/api/foo'` always produces
// a clean URL whether or not the config writer remembered to omit the slash.
export const BACKEND_URL = rawBackendUrl.replace(/\/+$/, '');

// Tell the service worker which origin to treat as the backend (network-only).
if (BACKEND_URL && 'serviceWorker' in navigator) {
  try {
    const backendOrigin = new URL(BACKEND_URL, location.origin).origin;
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({ type: 'SET_BACKEND', origin: backendOrigin });
    }).catch(() => {});
  } catch { /* invalid URL — leave SW with default same-origin assumption */ }
}

/**
 * Authenticated JSON fetch against the configured backend.
 *
 * @param {string}   url      Path beginning with `/` (e.g. `/api/profile`)
 *                            or absolute URL (passed through untouched).
 * @param {RequestInit} [options]
 * @returns {Promise<any>} parsed JSON body
 * @throws if the response is not OK; `error.message` reflects `body.error`.
 */
export async function apiFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const target = /^https?:\/\//i.test(url) ? url : BACKEND_URL + url;
  const res = await fetch(target, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconegut');
  return data;
}
