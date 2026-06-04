#!/usr/bin/env node
/**
 * scripts/build-image-variants.mjs
 *
 * Generates responsive resolution variants for the content images (events and
 * artists) so the frontend can serve different *sizes* (not just formats) via
 * `srcset` + `sizes`.
 *
 * For every base image found in `frontend/assets/images/{events,artists}` it
 * emits, for each target width, an AVIF / WebP / JPEG file named:
 *
 *     <basename>-<width>w.<ext>
 *
 * e.g. `antonia-font-concert-de-reunio-400w.avif`.
 *
 * The original (un-suffixed) files are left untouched so they keep working as
 * the `<img src>` fallback. The script is idempotent: it skips a variant when
 * the output already exists and is newer than the source.
 *
 * Run from the project root:
 *
 *     node scripts/build-image-variants.mjs
 */

import sharp from 'sharp';
import { readdir, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'frontend', 'assets', 'images');

// Widths we generate for every content image. 550px artist sources are
// upscaled to 800w (≈1.45x) so the renderer can use one uniform srcset.
const TARGET_WIDTHS = [400, 800];
const SUBDIRS = ['events', 'artists'];
// Only these source extensions are treated as "base" images to derive from.
const SOURCE_EXT = '.jpg';

const QUALITY = { avif: 50, webp: 78, jpeg: 80 };

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isStale(out, srcMtime) {
  if (!(await exists(out))) return true;
  const s = await stat(out);
  return s.mtimeMs < srcMtime;
}

async function generateForImage(dir, file) {
  const base = path.basename(file, SOURCE_EXT);
  // Skip files that are already generated variants (…-400w.jpg).
  if (/-\d+w$/.test(base)) return 0;

  const srcPath = path.join(dir, file);
  const srcStat = await stat(srcPath);
  let made = 0;

  for (const width of TARGET_WIDTHS) {
    const targets = [
      { ext: 'avif', opts: { quality: QUALITY.avif } },
      { ext: 'webp', opts: { quality: QUALITY.webp } },
      { ext: 'jpg', opts: { quality: QUALITY.jpeg, mozjpeg: true } },
    ];

    for (const { ext, opts } of targets) {
      const out = path.join(dir, `${base}-${width}w.${ext}`);
      if (!(await isStale(out, srcStat.mtimeMs))) continue;

      const pipeline = sharp(srcPath).resize({
        width,
        withoutEnlargement: false,
        fit: 'cover',
      });

      if (ext === 'avif') pipeline.avif(opts);
      else if (ext === 'webp') pipeline.webp(opts);
      else pipeline.jpeg(opts);

      await pipeline.toFile(out);
      made++;
    }
  }
  return made;
}

async function run() {
  let total = 0;
  for (const sub of SUBDIRS) {
    const dir = path.join(IMAGES_DIR, sub);
    if (!(await exists(dir))) {
      console.warn(`[img] skip missing dir: ${dir}`);
      continue;
    }
    const files = (await readdir(dir)).filter(
      (f) => f.toLowerCase().endsWith(SOURCE_EXT) && !/-\d+w\./.test(f)
    );
    for (const file of files) {
      const made = await generateForImage(dir, file);
      if (made) console.log(`[img] ${sub}/${file} → ${made} variant(s)`);
      total += made;
    }
  }
  console.log(`[img] done — ${total} variant file(s) written.`);
}

run().catch((err) => {
  console.error('[img] failed:', err);
  process.exit(1);
});
