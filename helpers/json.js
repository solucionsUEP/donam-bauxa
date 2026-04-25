import { readFileSync, writeFileSync } from 'fs';

// Simple in-memory lock to prevent concurrent writes to the same file
const locks = {};

const EMPTY_LIST = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  numberOfItems: 0,
  itemListElement: []
};

async function withLock(filePath, fn) {
  while (locks[filePath]) await new Promise(r => setTimeout(r, 50));
  locks[filePath] = true;
  try {
    return await fn();
  } finally {
    locks[filePath] = false;
  }
}

export function readJSON(filePath, defaultValue = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[readJSON] No s'ha pogut llegir ${filePath}:`, err.message);
    return defaultValue ?? structuredClone(EMPTY_LIST);
  }
}

export function writeJSON(filePath, data) {
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    // On Vercel the filesystem is read-only — log the warning but don't crash
    console.warn(`[writeJSON] No s'ha pogut escriure a ${filePath}:`, err.message);
  }
}

export async function writeJSONSafe(filePath, updateFn) {
  return withLock(filePath, async () => {
    const data = readJSON(filePath);
    const result = await updateFn(data);
    writeJSON(filePath, data);
    return result;
  });
}

export function generateId(prefix, items) {
  const maxPos = items.reduce((max, el) => Math.max(max, el.position || 0), 0);
  return { id: `${prefix}-${maxPos + 1}`, position: maxPos + 1 };
}
