/**
 * @module dataLoader
 * @description Fetches and caches JSON data from the /data directory.
 */

/** @type {Map<string, any>} In-memory cache for loaded data */
const cache = new Map();


export function clearDataCache() {
  cache.clear();
}

/**
 * Fetches JSON data from a given path, with caching.
 * @param {string} path - Relative path to the JSON file (e.g. 'data/artists.json')
 * @returns {Promise<Object>} Parsed JSON data
 */
export async function loadData(path) {
  if (cache.has(path)) return cache.get(path);

  let preload = null;
  if (window.__dataPreload) {
    if (path === 'data/events.json') { preload = window.__dataPreload.events; window.__dataPreload.events = null; }
    if (path === 'data/artists.json') { preload = window.__dataPreload.artists; window.__dataPreload.artists = null; }
    if (path === 'data/news.json') { preload = window.__dataPreload.news; window.__dataPreload.news = null; }
  }

  try {
    const data = preload ? await preload : await fetch(path, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
      return r.json();
    });
    cache.set(path, data);
    return data;
  } catch (error) {
    console.error(`[dataLoader] Error loading ${path}:`, error);
    throw error;
  }
}

/**
 * Extracts items from a Schema.org ItemList.
 * Hydrates Schema.org additionalProperty values into flat fields for easy access,
 * and maps areaServed → zone for internal use.
 * @param {Object} data - Schema.org ItemList object
 * @returns {Array<Object>} Array of item objects with hydrated properties
 */
export function extractItems(data) {
  if (!data || !data.itemListElement) return [];
  return data.itemListElement
    .map(entry => {
      const item = { ...entry.item };
      // Hydrate additionalProperty into flat fields
      if (Array.isArray(item.additionalProperty)) {
        for (const prop of item.additionalProperty) {
          if (prop.name && prop.name !== '@type') {
            item[prop.name] = prop.value;
          }
        }
      }
      // Map Schema.org areaServed → zone for internal use
      if (item.areaServed && !item.zone) {
        item.zone = item.areaServed;
      }
      return item;
    })
    .filter(item => item.archived !== true); // Exclude archived items from public views
}

/**
 * Loads and extracts artist data.
 * @returns {Promise<Array<Object>>}
 */
export async function loadArtists() {
  const data = await loadData('data/artists.json');
  return extractItems(data);
}

/**
 * Loads and extracts event data.
 * @returns {Promise<Array<Object>>}
 */
export async function loadEvents() {
  const data = await loadData('data/events.json');
  return extractItems(data);
}

/**
 * Loads and extracts news data.
 * @returns {Promise<Array<Object>>}
 */
export async function loadNews() {
  const data = await loadData('data/news.json');
  return extractItems(data);
}

/**
 * Loads and normalizes external events from events_extern.json.
 * Normalizes the @graph format to match internal event structure.
 * @returns {Promise<Array<Object>>}
 */
export async function loadExternEvents() {
  const data = await loadData('data/events_extern.json');
  if (!data || !data['@graph']) return [];
  return data['@graph'].map(event => {
    // Normalize image: pick first ImageObject's contentUrl
    let image = null;
    if (Array.isArray(event.image) && event.image.length > 0) {
      image = event.image[0].contentUrl || event.image[0].url || null;
    } else if (typeof event.image === 'string') {
      image = event.image;
    }
    return {
      ...event,
      image,
      category: event.additionalType || event.category || 'festa',
      genre: Array.isArray(event.genre) ? event.genre : [],
      zone: event.zone || event.location?.address?.addressRegion || event.location?.address?.addressLocality || '',
      isExtern: true,
    };
  });
}
