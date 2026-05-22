/**
 * @module routes/version
 * @description GET /version.json — exposes the app + data versions used by
 * the service worker to decide when to invalidate caches.
 *
 *   { app:  "<git short SHA or package.json version>",
 *     data: "<ISO timestamp of newest file under frontend/data>" }
 *
 * Must always be served with `Cache-Control: no-store` so the freshness
 * check is itself never cached.
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'frontend', 'data');

let cachedAppVersion = null;
function getAppVersion() {
  if (cachedAppVersion) return cachedAppVersion;
  try {
    cachedAppVersion = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore','pipe','ignore'] })
      .toString().trim();
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      cachedAppVersion = pkg.version || 'dev';
    } catch { cachedAppVersion = 'dev'; }
  }
  return cachedAppVersion;
}

function getDataVersion() {
  let newest = 0;
  try {
    for (const f of readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json')) continue;
      const m = statSync(join(DATA_DIR, f)).mtimeMs;
      if (m > newest) newest = m;
    }
  } catch { /* no data dir in some envs */ }
  return new Date(newest || Date.now()).toISOString();
}

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ app: getAppVersion(), data: getDataVersion() });
});

export default router;
