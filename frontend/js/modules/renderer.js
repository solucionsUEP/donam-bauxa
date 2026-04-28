/**
 * @module renderer
 * @description Generates HTML components for artists, events, and news.
 */

import { isFavorite, toggleFavorite } from './favorites.js';
import { downloadICS } from './calendar.js';

/** Month abbreviations in Catalan */
const MONTHS_CA = ['Gen', 'Feb', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Des'];

/**
 * Generates an inline SVG placeholder for items without images.
 * @param {string} name - Item name (used for initials)
 * @param {string} [bgColor='#1B4965'] - Background color
 * @returns {string} SVG markup
 */
function generatePlaceholderSVG(name, bgColor = '#1B4965') {
  const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  return `<svg class="placeholder-svg" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="300" fill="${bgColor}"/>
    <circle cx="200" cy="120" r="60" fill="rgba(255,255,255,0.15)"/>
    <text x="200" y="135" font-family="Georgia, serif" font-size="42" fill="rgba(255,255,255,0.9)" text-anchor="middle" font-weight="bold">${initials}</text>
    <text x="200" y="230" font-family="sans-serif" font-size="16" fill="rgba(255,255,255,0.6)" text-anchor="middle">${escapeHtml(name)}</text>
  </svg>`;
}

/**
 * Generates a <picture> element with AVIF, WebP, and JPEG sources.
 * Falls back to the inline SVG placeholder if no image path is provided.
 * @param {string} imagePath - Path to the JPEG fallback image (e.g. "assets/images/artists/name.jpg")
 * @param {string} altText - Alt text for the image
 * @param {string} name - Item name (used for placeholder fallback)
 * @param {string} [bgColor='#1B4965'] - Background color for placeholder
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.lazy=true] - Whether to lazy load the image
 * @param {boolean} [options.highPriority=false] - Whether this is an LCP/above-the-fold image
 * @param {number} [options.width=800] - Image width attribute
 * @param {number} [options.height=600] - Image height attribute
 * @param {string} [options.className=''] - CSS class for the img element
 * @returns {string} HTML string with <picture> element or SVG fallback
 */
function generatePictureElement(imagePath, altText, name, bgColor = '#1B4965', options = {}) {
  if (!imagePath) {
    return generatePlaceholderSVG(name, bgColor);
  }

  const {
    lazy = true,
    highPriority = false,
    width = 800,
    height = 600,
    className = ''
  } = options;

  // Derive AVIF and WebP paths from the JPEG path
  const basePath = imagePath.replace(/\.[^.]+$/, '');
  const avifPath = basePath + '.avif';
  const webpPath = basePath + '.webp';

  const loadingAttr = lazy && !highPriority ? ' loading="lazy"' : '';
  const fetchPriorityAttr = highPriority ? ' fetchpriority="high"' : '';
  const classAttr = className ? ` class="${className}"` : '';

  return `<picture>
    <source srcset="${avifPath}" type="image/avif">
    <source srcset="${webpPath}" type="image/webp">
    <img src="${imagePath}" alt="${escapeHtml(altText)}" width="${width}" height="${height}"${loadingAttr}${fetchPriorityAttr}${classAttr}>
  </picture>`;
}

/**
 * Escapes HTML special characters.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Formats an ISO date string to a localized date string.
 * @param {string} dateStr - ISO 8601 date
 * @returns {{ day: string, month: string, time: string, full: string }}
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return {
    day: d.getDate().toString(),
    month: MONTHS_CA[d.getMonth()],
    time: d.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' }),
    full: d.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  };
}

/**
 * Extracts performer names from an event.
 * @param {Object} event
 * @returns {string}
 */
function getPerformerNames(event) {
  if (!event.performer) return '';
  if (Array.isArray(event.performer)) {
    return event.performer.map(p => p.name).join(', ');
  }
  return event.performer.name || '';
}

/**
 * Renders an artist card.
 * @param {Object} artist - MusicGroup object
 * @returns {string} HTML string
 */
export function renderArtistCard(artist) {
  const genres = (artist.genre || []).map(g =>
    `<span class="badge-genre">${escapeHtml(g)}</span>`
  ).join('');

  const favClass = isFavorite('artist', artist['@id']) ? 'active' : '';
  const favIcon = isFavorite('artist', artist['@id']) ? 'bi-heart-fill' : 'bi-heart';

  const bgColors = ['#1B4965', '#C45A3C', '#6B8E4E', '#A3432A', '#2D6A8F', '#4F6B38'];
  const colorIndex = artist.name.length % bgColors.length;

  return `
    <div class="col-md-6 col-lg-4 mb-4 animate-fade-in-up">
      <article class="card-bauxa artist-card" data-artist-id="${artist['@id']}">
        <div class="artist-card__image-wrapper">
          ${generatePictureElement(artist.image, artist.name, artist.name, bgColors[colorIndex], { width: 800, height: 600, className: 'artist-card__img' })}
          <div class="artist-card__favorite">
            <button class="btn-favorite ${favClass}"
                    data-fav-type="artist"
                    data-fav-id="${artist['@id']}"
                    aria-label="Afegir ${escapeHtml(artist.name)} a favorits"
                    title="Afegir a favorits">
              <i class="bi ${favIcon}"></i>
            </button>
          </div>
        </div>
        <div class="card-body">
          <div class="d-flex align-items-start justify-content-between mb-1">
            <h3 class="card-title mb-0">${escapeHtml(artist.name)}</h3>
            <span class="badge-zone">${escapeHtml(artist.zone || '')}</span>
          </div>
          <div class="artist-card__genres">${genres}</div>
          <p class="card-text small text-muted-custom mb-2">${escapeHtml((artist.description || '').substring(0, 120))}...</p>
          <div class="artist-card__meta">
            ${artist.foundingDate ? `<span><i class="bi bi-calendar3"></i> ${artist.foundingDate}</span>` : ''}
            ${artist.album ? `<span><i class="bi bi-disc"></i> ${artist.album.length} albums</span>` : ''}
          </div>
          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-sm btn-bauxa flex-grow-1"
                    data-bs-toggle="modal"
                    data-bs-target="#artistModal"
                    data-artist-id="${artist['@id']}"
                    onclick="window.showArtistDetail && window.showArtistDetail('${artist['@id']}')">
              <i class="bi bi-info-circle"></i> Veure mes
            </button>
            ${artist.spotifyId ? `
              <a href="https://open.spotify.com/artist/${artist.spotifyId}"
                 class="btn btn-sm btn-bauxa-secondary"
                 target="_blank"
                 rel="noopener noreferrer"
                 aria-label="Escoltar ${escapeHtml(artist.name)} a Spotify">
                <i class="bi bi-spotify"></i>
              </a>` : ''}
          </div>
        </div>
      </article>
    </div>`;
}

/**
 * Renders an event card (compact list style).
 * @param {Object} event - MusicEvent object
 * @returns {string} HTML string
 */
export function renderEventCard(event) {
  const date = formatDate(event.startDate);
  const performers = getPerformerNames(event);
  const price = parseFloat(event.offers?.price || 0);
  const priceLabel = price === 0 ? 'Gratuit' : `${price.toFixed(0)} EUR`;
  const priceClass = price === 0 ? 'badge-price--free' : '';

  const favClass = isFavorite('event', event['@id']) ? 'active' : '';
  const favIcon = isFavorite('event', event['@id']) ? 'bi-heart-fill' : 'bi-heart';

  const genres = (event.genre || []).slice(0, 3).map(g =>
    `<span class="badge-genre">${escapeHtml(g)}</span>`
  ).join('');

  return `
    <div class="col-12 mb-3 animate-fade-in-up">
      <article class="card-bauxa">
        <div class="card-body">
          <div class="d-flex gap-3 align-items-start">
            <div class="event-card__date">
              <span class="event-card__date-day">${date.day}</span>
              <span class="event-card__date-month">${date.month}</span>
            </div>
            <div class="event-card__info flex-grow-1">
              <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                <div>
                  <span class="badge-category">${escapeHtml(event.category || 'concert')}</span>
                  ${event.isExtern ? '<span class="badge-extern ms-1"><i class="bi bi-globe2"></i> Extern</span>' : ''}
                  <h3 class="card-title mt-1 mb-1">${escapeHtml(event.name)}</h3>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <span class="badge-price ${priceClass}">${priceLabel}</span>
                  <button class="btn-favorite ${favClass}"
                          data-fav-type="event"
                          data-fav-id="${event['@id']}"
                          aria-label="Afegir ${escapeHtml(event.name)} a favorits">
                    <i class="bi ${favIcon}"></i>
                  </button>
                </div>
              </div>
              ${performers ? `<p class="mb-1 small"><strong><i class="bi bi-music-note-beamed"></i> ${escapeHtml(performers)}</strong></p>` : ''}
              <p class="event-card__time mb-1">
                <i class="bi bi-clock"></i> ${date.time} &mdash; ${date.full}
              </p>
              <p class="event-card__location mb-2">
                <i class="bi bi-geo-alt-fill"></i> ${escapeHtml(event.location?.name || '')}, ${escapeHtml(event.location?.address?.addressLocality || '')}
              </p>
              <div class="d-flex flex-wrap align-items-center gap-2">
                ${genres}
                <span class="badge-zone ms-1">${escapeHtml(event.zone || '')}</span>
              </div>
              <div class="d-flex flex-wrap gap-2 mt-3">
                <button class="btn btn-sm btn-bauxa"
                        data-bs-toggle="modal"
                        data-bs-target="#eventModal"
                        onclick="window.showEventDetail && window.showEventDetail('${event['@id']}')">
                  <i class="bi bi-info-circle"></i> Detalls
                </button>
                ${event.offers?.url && event.offers.url !== '#' ? `
                  <a href="${event.offers.url}" class="btn btn-sm btn-bauxa-outline" target="_blank" rel="noopener noreferrer">
                    <i class="bi bi-ticket-perforated"></i> Entrades
                  </a>` : ''}
                <button class="btn btn-sm btn-bauxa-secondary btn-calendar" data-event-id="${event['@id']}" aria-label="Afegir al calendari">
                  <i class="bi bi-calendar-plus"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>`;
}

/**
 * Renders a featured event card (large format for homepage).
 * @param {Object} event
 * @returns {string}
 */
export function renderFeaturedEvent(event) {
  const date = formatDate(event.startDate);
  const performers = getPerformerNames(event);
  const price = parseFloat(event.offers?.price || 0);
  const priceLabel = price === 0 ? 'Gratuit' : `${price.toFixed(0)} EUR`;

  return `
    <div class="col-md-6 mb-4 animate-fade-in-up">
      <article class="featured-event">
        ${event.image ? generatePictureElement(event.image, event.name, event.name, '#0F2E42', { lazy: false, highPriority: true, width: 800, height: 600, className: 'featured-event__img' }) : ''}
        <div class="featured-event__overlay"></div>
        <div class="featured-event__content">
          <span class="featured-event__badge">${escapeHtml(event.category || 'concert')}</span>
          <h3>${escapeHtml(event.name)}</h3>
          <p class="mb-1"><i class="bi bi-calendar3"></i> ${date.full} &mdash; ${date.time}</p>
          <p class="mb-1"><i class="bi bi-geo-alt-fill"></i> ${escapeHtml(event.location?.name || '')}, ${escapeHtml(event.location?.address?.addressLocality || '')}</p>
          ${performers ? `<p class="mb-2"><i class="bi bi-music-note-beamed"></i> ${escapeHtml(performers)}</p>` : ''}
          <div class="d-flex gap-2 align-items-center">
            <span class="badge-price ${price === 0 ? 'badge-price--free' : ''}">${priceLabel}</span>
            ${event.offers?.url && event.offers.url !== '#' ? `
              <a href="${event.offers.url}" class="btn btn-sm btn-bauxa" target="_blank" rel="noopener noreferrer">
                <i class="bi bi-ticket-perforated"></i> Entrades
              </a>` : ''}
            <button class="btn btn-sm btn-bauxa-secondary btn-calendar" data-event-id="${event['@id']}">
              <i class="bi bi-calendar-plus"></i> Calendari
            </button>
          </div>
        </div>
      </article>
    </div>`;
}

/**
 * Renders a news article card.
 * @param {Object} article - NewsArticle object
 * @returns {string}
 */
export function renderNewsCard(article) {
  const date = new Date(article.datePublished);
  const dateStr = date.toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <div class="col-md-6 col-lg-4 mb-4 animate-fade-in-up">
      <article class="card-bauxa">
        ${article.image ? `<div class="news-card__image-wrapper">
          ${generatePictureElement(article.image, article.headline, article.headline, '#1B4965', { width: 800, height: 600, className: 'news-card__img' })}
        </div>` : ''}
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="news-card__category">${escapeHtml(article.category || '')}</span>
            <span class="news-card__date">${dateStr}</span>
          </div>
          <h3 class="card-title">${escapeHtml(article.headline)}</h3>
          <p class="card-text small text-muted-custom">${escapeHtml(article.description)}</p>
        </div>
      </article>
    </div>`;
}

/**
 * Renders artist detail content for a modal.
 * @param {Object} artist
 * @returns {string}
 */
export function renderArtistDetail(artist) {
  const genres = (artist.genre || []).map(g => `<span class="badge-genre">${escapeHtml(g)}</span>`).join(' ');

  const albums = (artist.album || []).map(a => `
    <li class="list-group-item d-flex justify-content-between align-items-center">
      <span><i class="bi bi-disc"></i> ${escapeHtml(a.name)}</span>
      <span class="text-muted small">${a.datePublished}</span>
    </li>
  `).join('');

  const members = (artist.member || []).map(m =>
    `<span class="badge bg-light text-dark border me-1 mb-1">${escapeHtml(m.name)}</span>`
  ).join('');

  const links = (artist.sameAs || []).map(url => {
    let icon = 'bi-link-45deg';
    let label = 'Enllac';
    if (url.includes('spotify')) { icon = 'bi-spotify'; label = 'Spotify'; }
    else if (url.includes('instagram')) { icon = 'bi-instagram'; label = 'Instagram'; }
    else if (url.includes('wikipedia')) { icon = 'bi-wikipedia'; label = 'Wikipedia'; }
    return `<a href="${url}" class="btn btn-sm btn-bauxa-outline me-2 mb-2" target="_blank" rel="noopener noreferrer"><i class="bi ${icon}"></i> ${label}</a>`;
  }).join('');

  const spotifyEmbed = artist.spotifyId && artist.spotifyId !== '' && !artist.spotifyId.startsWith('example')
    ? `<div class="spotify-embed mt-3">
        <iframe src="https://open.spotify.com/embed/artist/${artist.spotifyId}?theme=0"
                width="100%" height="152" allow="encrypted-media" loading="lazy"
                title="Spotify player per ${escapeHtml(artist.name)}"></iframe>
       </div>`
    : '';

  return `
    <div class="row">
      <div class="col-12">
        <p class="mb-3">${escapeHtml(artist.description || '')}</p>
        <div class="mb-3">${genres} <span class="badge-zone ms-2">${escapeHtml(artist.zone || '')}</span></div>
        ${artist.foundingDate ? `<p class="small text-muted"><i class="bi bi-calendar3"></i> Des de ${artist.foundingDate} &mdash; ${escapeHtml(artist.foundingLocation?.name || '')}</p>` : ''}
        ${members ? `<div class="mb-3"><strong class="small">Membres:</strong><br>${members}</div>` : ''}
        ${albums ? `<div class="mb-3"><strong class="small">Discografia:</strong><ul class="list-group list-group-flush mt-1">${albums}</ul></div>` : ''}
        ${links ? `<div class="mb-3"><strong class="small d-block mb-2">Enllacos:</strong>${links}</div>` : ''}
        ${spotifyEmbed}
      </div>
    </div>`;
}

/**
 * Renders event detail content for a modal.
 * @param {Object} event
 * @returns {string}
 */
export function renderEventDetail(event) {
  const date = formatDate(event.startDate);
  const endDate = formatDate(event.endDate);
  const performers = getPerformerNames(event);
  const price = parseFloat(event.offers?.price || 0);
  const priceLabel = price === 0 ? 'Gratuit' : `${price.toFixed(2)} EUR`;
  const genres = (event.genre || []).map(g => `<span class="badge-genre">${escapeHtml(g)}</span>`).join(' ');

  return `
    <div class="row">
      <div class="col-12">
        <p class="mb-3">${escapeHtml(event.description || '')}</p>
        <div class="mb-3">${genres}</div>
        <ul class="list-unstyled">
          <li class="mb-2"><i class="bi bi-calendar3 text-primary-custom"></i> <strong>${date.full}</strong></li>
          <li class="mb-2"><i class="bi bi-clock text-primary-custom"></i> ${date.time} - ${endDate.time}</li>
          <li class="mb-2"><i class="bi bi-geo-alt-fill text-primary-custom"></i> ${escapeHtml(event.location?.name || '')}, ${escapeHtml(event.location?.address?.streetAddress || '')}, ${escapeHtml(event.location?.address?.addressLocality || '')}</li>
          ${performers ? `<li class="mb-2"><i class="bi bi-music-note-beamed text-primary-custom"></i> ${escapeHtml(performers)}</li>` : ''}
          <li class="mb-2"><i class="bi bi-tag text-primary-custom"></i> ${priceLabel}</li>
        </ul>
        <div class="d-flex flex-wrap gap-2 mt-3">
          ${event.offers?.url && event.offers.url !== '#' ? `
            <a href="${event.offers.url}" class="btn btn-bauxa" target="_blank" rel="noopener noreferrer">
              <i class="bi bi-ticket-perforated"></i> Comprar Entrades
            </a>` : ''}
          <button class="btn btn-bauxa-secondary btn-calendar" data-event-id="${event['@id']}">
            <i class="bi bi-calendar-plus"></i> Afegir al Calendari
          </button>
          <button class="btn btn-bauxa-outline btn-favorite-modal ${isFavorite('event', event['@id']) ? 'active' : ''}"
                  data-fav-type="event" data-fav-id="${event['@id']}">
            <i class="bi ${isFavorite('event', event['@id']) ? 'bi-heart-fill' : 'bi-heart'}"></i> Favorit
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * Renders a loading spinner.
 * @param {string} [message='Carregant...']
 * @returns {string}
 */
export function renderLoading(message = 'Carregant...') {
  return `
    <div class="loading-spinner">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">${message}</span>
      </div>
      <p>${message}</p>
    </div>`;
}

/**
 * Renders an empty state message.
 * @param {string} [message='No s\'han trobat resultats']
 * @param {string} [icon='bi-search']
 * @returns {string}
 */
export function renderEmptyState(message = "No s'han trobat resultats", icon = 'bi-search') {
  return `
    <div class="col-12">
      <div class="empty-state">
        <i class="bi ${icon}"></i>
        <p>${message}</p>
      </div>
    </div>`;
}
