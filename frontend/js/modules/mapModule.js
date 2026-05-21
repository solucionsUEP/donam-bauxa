/**
 * @module mapModule
 * @description Initializes and manages the Leaflet map for event locations.
 */

/** Category colors for map markers (design palette) */
const CATEGORY_COLORS = {
  'concert':       '#ff4db5',
  'festival':      '#ffb84d',
  'festa popular': '#4db5ff',
  'extern':        '#94a3b8'
};
const DEFAULT_MARKER_COLOR = '#94a3b8';

/** Default map center (Mallorca) */
const MALLORCA_CENTER = [39.6153, 2.9110];
const DEFAULT_ZOOM = 9;

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS_INTEGRITY = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const LEAFLET_JS_INTEGRITY  = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
let leafletLoadPromise = null;

function loadLeaflet() {
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (window.L) { resolve(); return; }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
      link.integrity = LEAFLET_CSS_INTEGRITY; link.crossOrigin = '';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS; script.integrity = LEAFLET_JS_INTEGRITY;
    script.crossOrigin = ''; script.onload = resolve; script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

/**
 * Initializes a Leaflet map in the specified container.
 * @param {string} containerId - DOM element ID for the map
 * @returns {Promise<Object>} Leaflet map instance
 */
export async function initMap(containerId) {
  await loadLeaflet();
  const map = L.map(containerId, {
    scrollWheelZoom: true,
    zoomControl: true
  }).setView(MALLORCA_CENTER, DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18
  }).addTo(map);

  return map;
}

/**
 * Creates a custom colored marker icon.
 * @param {string} color - Hex color
 * @returns {Object} Leaflet divIcon
 */
function createMarkerIcon(color) {
  return L.divIcon({
    className: 'custom-map-marker',
    html: `<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="6" fill="#fff" fill-opacity="0.9"/>
    </svg>`,
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -42]
  });
}

/**
 * Adds event markers to the map.
 * @param {Object} map - Leaflet map instance
 * @param {Array<Object>} events - Array of MusicEvent objects
 * @returns {Object} Leaflet layer group containing all markers
 */
export function addEventMarkers(map, events) {
  const markers = L.featureGroup();

  events.forEach(event => {
    const geo = event.location?.geo;
    if (!geo || !geo.latitude || !geo.longitude) return;

    const color = CATEGORY_COLORS[event.category?.toLowerCase?.()] || DEFAULT_MARKER_COLOR;
    const icon = createMarkerIcon(color);

    const date = new Date(event.startDate);
    const dateStr = date.toLocaleDateString('ca-ES', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
    const timeStr = date.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });

    const performers = Array.isArray(event.performer)
      ? event.performer.map(p => p.name).join(', ')
      : event.performer?.name || '';

    const price = parseFloat(event.offers?.price || 0);
    const priceClass = price === 0 ? 'map-popup__price--free' : 'map-popup__price';
    const priceLabel = price === 0 ? 'Gratuït' : `${price.toFixed(0)} EUR`;

    const popupContent = `
      <div style="min-width:210px;">
        <p class="map-popup__title">${event.name}</p>
        <div class="map-popup__row"><i class="bi bi-calendar3"></i> ${dateStr} &mdash; ${timeStr}</div>
        <div class="map-popup__row"><i class="bi bi-geo-alt-fill"></i> ${event.location.name}</div>
        ${performers ? `<div class="map-popup__row"><i class="bi bi-music-note-beamed"></i> ${performers}</div>` : ''}
        <div class="map-popup__row"><i class="bi bi-tag"></i> <span class="${priceClass}">${priceLabel}</span></div>
        ${event.offers?.url && event.offers.url !== '#' ? `<a href="${event.offers.url}" target="_blank" rel="noopener" class="map-popup__link">Entrades &rarr;</a>` : ''}
      </div>`;

    const marker = L.marker([geo.latitude, geo.longitude], { icon })
      .bindPopup(popupContent, { maxWidth: 290 });

    markers.addLayer(marker);
  });

  markers.addTo(map);
  return markers;
}

/**
 * Fits the map bounds to show all markers.
 * @param {Object} map - Leaflet map instance
 * @param {Object} markerLayer - Leaflet layer group
 */
export function fitToMarkers(map, markerLayer) {
  const bounds = markerLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }
}
