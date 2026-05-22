#!/usr/bin/env node
/**
 * scripts/build-version.mjs
 *
 * Generates `frontend/version.json` for the production (Dondominio) deploy.
 * The service worker fetches this file on every load with `Cache-Control:
 * no-store` and compares it to the versions baked into its cache names.
 *
 * Output shape:
 *   { "app": "<git short SHA or package version>",
 *     "data": "<ISO timestamp of newest file under frontend/data/*.json>" }
 *
 * Run from the project root before publishing:
 *
 *     node scripts/build-version.mjs
 *
 * The Apache vhost / CDN in front of Dondominio MUST serve this file with a
 * no-store header so the freshness probe is never cached. See
 * frontend/.htaccess for the local equivalent.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = join(ROOT, 'frontend');
const DATA_DIR = join(FRONTEND, 'data');
const OUT_FILE = join(FRONTEND, 'version.json');

function resolveAppVersion() {
  // Prefer CI-provided commit SHA so we don't depend on .git being present
  // in the deploy artefact.
  const ci = process.env.GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (ci) return ci.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore','pipe','ignore'] })
      .toString().trim();
  } catch { /* fall through */ }
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || 'dev';
  } catch {
    return 'dev';
  }
}

function resolveDataVersion() {
  let newest = 0;
  try {
    for (const f of readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json')) continue;
      const m = statSync(join(DATA_DIR, f)).mtimeMs;
      if (m > newest) newest = m;
    }
  } catch (err) {
    console.warn('[build-version] data dir unreadable, using current time:', err.message);
  }
  return new Date(newest || Date.now()).toISOString();
}

const payload = {
  app: resolveAppVersion(),
  data: resolveDataVersion(),
  generatedAt: new Date().toISOString(),
};

writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n');
console.log(`[build-version] wrote ${OUT_FILE}`);
console.log('  app: ', payload.app);
console.log('  data:', payload.data);
