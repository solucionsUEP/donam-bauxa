/**
 * @module i18n
 * @description Lightweight i18n singleton for Dona'm Bauxa.
 * Supports ca (default), es, en, de. Loads locale JSON via fetch.
 * Dispatches 'langChanged' on document when language switches.
 */

const SUPPORTED_LANGS = ['ca', 'es', 'en', 'de'];
const LANG_FLAGS = {
  ca: '<img src="/assets/flags/flag-ca.svg" class="flag-icon" alt="CA">',
  en: '<img src="/assets/flags/flag-en.svg" class="flag-icon" alt="EN">',
  de: '<img src="/assets/flags/flag-de.svg" class="flag-icon" alt="DE">',
  es: '<img src="/assets/flags/flag-es.svg" class="flag-icon" alt="ES">',
};
const STORAGE_KEY = 'bauxa_lang';

/** @type {Map<string, Object>} Loaded locale data keyed by lang code */
const cache = new Map();

/** @type {string} */
let currentLang = 'ca';

/** Plural selector — all four langs share the same n===1 rule */
function pluralCategory(n) {
  return n === 1 ? 'one' : 'other';
}

/**
 * Fetches and caches a locale JSON file.
 * @param {string} lang
 */
async function loadLocale(lang) {
  if (cache.has(lang)) return;
  try {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cache.set(lang, await res.json());
  } catch (e) {
    console.warn(`[i18n] Failed to load locale '${lang}':`, e.message);
    cache.set(lang, {});
  }
}

/**
 * Reads a dot-separated key from a nested object.
 * @param {Object} obj
 * @param {string} key  e.g. 'nav.home'
 * @returns {string|undefined}
 */
function getNestedKey(obj, key) {
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/**
 * Translates a key with optional variable substitution and pluralization.
 * Falls back to the key string itself if not found.
 *
 * @param {string} key      Dot-separated key, e.g. 'artist.count'
 * @param {Object} [vars]   Variables to substitute, e.g. { name: 'Antonia Font' }
 * @param {number} [count]  If provided, selects plural form (_one / _other suffix)
 * @returns {string}
 */
export function t(key, vars = {}, count = undefined) {
  const data = cache.get(currentLang) || {};
  const fallback = cache.get('ca') || {};

  let resolvedKey = key;
  if (count !== undefined) {
    const category = pluralCategory(count);
    resolvedKey = `${key}_${category}`;
  }

  let str = getNestedKey(data, resolvedKey)
    ?? getNestedKey(fallback, resolvedKey)
    ?? getNestedKey(data, key)
    ?? getNestedKey(fallback, key)
    ?? key;

  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

/** Returns the current language code. */
export function getLang() {
  return currentLang;
}

/**
 * Returns the BCP-47 locale tag for Intl APIs.
 * @returns {string}  e.g. 'ca-ES', 'de-DE'
 */
export function getIntlLocale() {
  const map = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB', de: 'de-DE' };
  return map[currentLang] || 'ca-ES';
}

/**
 * Swaps the Bootstrap CSS link between LTR and RTL builds.
 * Currently unused (no RTL lang), kept for future extension.
 */
function swapBootstrapCSS(dir) {
  const existing = document.querySelector('[data-bootstrap-dir]');
  if (!existing) return;
  const isRtl = dir === 'rtl';
  const target = isRtl
    ? 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css'
    : 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
  if (existing.href.includes(isRtl ? 'rtl' : 'bootstrap.min')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = target;
  link.setAttribute('data-bootstrap-dir', dir);
  link.onload = () => existing.remove();
  document.head.appendChild(link);
}

/**
 * Applies translations to static DOM nodes decorated with data-i18n attributes.
 * - data-i18n="key"             → element.textContent
 * - data-i18n-aria="key"        → aria-label attribute
 * - data-i18n-placeholder="key" → placeholder attribute
 * - data-i18n-title="key"       → title attribute
 */
export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  const titleEl = document.querySelector('title');
  if (titleEl) titleEl.textContent = t('meta.title');
}

/**
 * Switches the active language, loads its locale file if needed,
 * updates the DOM, and dispatches the 'langChanged' event.
 * @param {string} lang
 */
export async function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'ca';
  await loadLocale(lang);
  if (!cache.has('ca')) await loadLocale('ca');
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', 'ltr'); // extend here for RTL langs

  const label = document.getElementById('currentLangLabel');
  if (label) label.innerHTML = LANG_FLAGS[lang] ?? lang.toUpperCase();

  document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang } }));
}

/**
 * Initialises i18n from stored preference or browser language.
 * Must be awaited before the router starts.
 */
export async function initI18n() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const browser = navigator.language?.slice(0, 2).toLowerCase();
  const lang = SUPPORTED_LANGS.includes(stored) ? stored
    : SUPPORTED_LANGS.includes(browser) ? browser
    : 'ca';

  await loadLocale('ca');
  if (lang !== 'ca') await loadLocale(lang);
  currentLang = lang;
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', 'ltr');

  const label = document.getElementById('currentLangLabel');
  if (label) label.innerHTML = LANG_FLAGS[lang] ?? lang.toUpperCase();
}
