/**
 * @file app.js
 * @description Unified SPA entry point for Dona'm Bauxa.
 * Replaces the per-page entry points (main.js, artists.js, events.js, map.js).
 */

import { loadArtists, loadEvents, loadNews, loadExternEvents } from './modules/dataLoader.js';
import {
  renderFeaturedEvent, renderEventCard, renderNewsCard, renderArtistCard,
  renderLoading, renderEmptyState, renderArtistDetail, renderEventDetail,
  renderDeveloperProfiles
} from './modules/renderer.js';
import {
  filterArtists, filterEvents, sortEventsByDate, getUpcomingEvents,
  getUniqueGenres, getUniqueZones, getUniqueCategories
} from './modules/filters.js';
import {
  initScrollToTop, initMobileFab, updateFavoriteBadge, initGlobalEventHandlers,
  setActiveNavLink, populateSelect
} from './modules/ui.js';
import { initMap, addEventMarkers, fitToMarkers } from './modules/mapModule.js';
import { initRouter, registerRoutes, registerMapCleanup, refreshView } from './router.js';
import { initI18n, setLang, t, applyTranslations } from './i18n.js';
import { getFavorites as getFavoritesForType } from './modules/favorites.js';
import { initAdmin, checkAuth } from './modules/admin.js';
import { supabase } from './config.js';
import { initProfile } from './modules/profile.js';
import { initSolicituds } from './modules/solicituds.js';
import { initJoc } from './modules/joc.js';
import { initChatbot, setDataContext as setChatbotData } from './modules/chatbot.js';

/* ------------------------------------------------------------------ */
/*  Shared state                                                       */
/* ------------------------------------------------------------------ */

/** @type {Array<Object>} Cached artist data */
let allArtists = [];

/** @type {Array<Object>} Cached event data */
let allEvents = [];

/** @type {Array<Object>} Cached news data */
let allNews = [];

/** @type {boolean} Whether data has been loaded from JSON */
let dataLoaded = false;

/** @type {Object|null} Leaflet map instance */
let leafletMap = null;

/** @type {Object|null} Current Leaflet marker layer */
let markerLayer = null;

/** @type {Set<string>} Views that have been initialized */
const initializedViews = new Set();

/* ------------------------------------------------------------------ */
/*  Data loading                                                       */
/* ------------------------------------------------------------------ */

/**
 * Loads all JSON data once and caches it.
 */
let dataLoadingPromise = null;
async function ensureDataLoaded() {
  if (dataLoaded) return;
  if (dataLoadingPromise) return dataLoadingPromise;
  dataLoadingPromise = (async () => {
  try {
    const [artists, events, news, externEvents] = await Promise.all([
      loadArtists(), loadEvents(), loadNews(), loadExternEvents()
    ]);
    allArtists = artists;
    allEvents = [...events, ...externEvents];
    allNews = news;
    dataLoaded = true;

    // Setup global event handlers (favorites, calendar) once
    initGlobalEventHandlers(allEvents);

    // Hand the catalog to the chatbot for per-message retrieval.
    setChatbotData({ events: allEvents, artists: allArtists });

    // Setup modal handlers available globally
    window.showArtistDetail = (id) => {
      const artist = allArtists.find(a => a['@id'] === id);
      if (!artist) return;
      const title = document.querySelector('#artistModal .modal-title');
      const body = document.querySelector('#artistModal .modal-body');
      if (title) title.textContent = artist.name;
      if (body) body.innerHTML = renderArtistDetail(artist);
    };

    window.showEventDetail = (id) => {
      const event = allEvents.find(e => e['@id'] === id);
      if (!event) return;
      const title = document.querySelector('#eventModal .modal-title');
      const body = document.querySelector('#eventModal .modal-body');
      if (title) title.textContent = event.name;
      if (body) body.innerHTML = renderEventDetail(event);
    };

  } catch (error) {
    console.error('[app] Error loading data:', error);
  }
  })();
  return dataLoadingPromise;
}

/**
 * Loads developer profiles from GitHub and renders them in the footer.
 */
async function initFooterDevelopers() {
  const footerContainer = document.getElementById('footerDevelopers');
  const profileContainer = document.getElementById('developersSection');
  if (!footerContainer && !profileContainer) return;

  try {
    const usernames = ['dylanluigi', 'JoFeF08'];
    const devData = await Promise.all(usernames.map(user =>
      fetch(`https://api.github.com/users/${user}`).then(r => r.json())
    ));
    const html = renderDeveloperProfiles(devData);
    if (footerContainer) footerContainer.innerHTML = html;
    if (profileContainer) profileContainer.innerHTML = html;
  } catch (err) {
    console.error('[app] Error loading developer profiles:', err);
  }
}

/* ------------------------------------------------------------------ */
/*  HOME view                                                          */
/* ------------------------------------------------------------------ */

/**
 * Initializes the home view: featured events, upcoming events, news, featured artists.
 */
async function initHome() {
  await ensureDataLoaded();

  // Only populate dynamic content once per session (data doesn't change)
  if (initializedViews.has('home')) return;
  initializedViews.add('home');

  const featuredContainer = document.getElementById('featuredEvents');
  const upcomingContainer = document.getElementById('upcomingEvents');
  const newsContainer = document.getElementById('newsGrid');
  const artistsContainer = document.getElementById('featuredArtists');

  if (featuredContainer) {
    const featured = sortEventsByDate(allEvents.filter(e => e.featured));
    featuredContainer.innerHTML = featured.length > 0
      ? featured.slice(0, 4).map(renderFeaturedEvent).join('')
      : renderEmptyState(t('section.noFeaturedEvents'), 'bi-calendar-x');
  }

  if (upcomingContainer) {
    const upcoming = sortEventsByDate(getUpcomingEvents(allEvents));
    upcomingContainer.innerHTML = upcoming.length > 0
      ? upcoming.slice(0, 5).map(renderEventCard).join('')
      : renderEmptyState(t('section.noUpcomingEvents'), 'bi-calendar-x');
  }

  if (newsContainer && allNews.length > 0) {
    newsContainer.innerHTML = allNews.slice(0, 3).map(renderNewsCard).join('');
  }

  if (artistsContainer) {
    const featuredArtists = allArtists.filter(a => a.featured);
    if (featuredArtists.length > 0) {
      artistsContainer.innerHTML = featuredArtists.slice(0, 4).map(renderArtistCard).join('');
    }
  }
}

/* ------------------------------------------------------------------ */
/*  ARTISTS view                                                       */
/* ------------------------------------------------------------------ */

/**
 * Renders the artists grid based on current filter values.
 */
function renderArtistsGrid() {
  const container = document.getElementById('artistsGrid');
  if (!container) return;

  const search = document.getElementById('searchArtists')?.value || '';
  const genre = document.getElementById('artistsFilterGenre')?.value || '';
  const zone = document.getElementById('artistsFilterZone')?.value || '';

  const filtered = filterArtists(allArtists, { search, genre, zone });

  if (filtered.length === 0) {
    container.innerHTML = renderEmptyState(t('artist.notFound'), 'bi-music-note-list');
    const countEl = document.getElementById('artistsResultsCount');
    if (countEl) countEl.textContent = t('artist.count', { n: 0 }, 0);
    return;
  }

  container.innerHTML = filtered.map(renderArtistCard).join('');

  const countEl = document.getElementById('artistsResultsCount');
  if (countEl) countEl.textContent = t('artist.count', { n: filtered.length }, filtered.length);
}

/**
 * Initializes the artists view: populates filters, renders grid, binds listeners.
 */
async function initArtists() {
  await ensureDataLoaded();

  if (initializedViews.has('artists')) {
    // Re-render to refresh favorite states
    renderArtistsGrid();
    return;
  }
  initializedViews.add('artists');

  // Populate filter selects
  populateSelect('artistsFilterGenre', getUniqueGenres(allArtists), t('filter.allGenres'));
  populateSelect('artistsFilterZone', getUniqueZones(allArtists), t('filter.allZones'));

  // Render initial grid
  renderArtistsGrid();

  // Setup filter event listeners
  document.getElementById('searchArtists')?.addEventListener('input', renderArtistsGrid);
  document.getElementById('artistsFilterGenre')?.addEventListener('change', renderArtistsGrid);
  document.getElementById('artistsFilterZone')?.addEventListener('change', renderArtistsGrid);
  document.getElementById('artistsClearFilters')?.addEventListener('click', () => {
    const search = document.getElementById('searchArtists');
    const genre = document.getElementById('artistsFilterGenre');
    const zone = document.getElementById('artistsFilterZone');
    if (search) search.value = '';
    if (genre) genre.value = '';
    if (zone) zone.value = '';
    renderArtistsGrid();
  });
}

/* ------------------------------------------------------------------ */
/*  EVENTS view                                                        */
/* ------------------------------------------------------------------ */

/**
 * Renders the events list based on current filter values.
 */
function renderEventsList() {
  const container = document.getElementById('eventsGrid');
  if (!container) return;

  const search = document.getElementById('searchEvents')?.value || '';
  const genre = document.getElementById('eventsFilterGenre')?.value || '';
  const zone = document.getElementById('eventsFilterZone')?.value || '';
  const category = document.getElementById('eventsFilterCategory')?.value || '';
  const dateFrom = document.getElementById('eventsFilterDateFrom')?.value || '';
  const dateTo = document.getElementById('eventsFilterDateTo')?.value || '';

  let filtered = filterEvents(allEvents, { search, genre, zone, category, dateFrom, dateTo });
  filtered = sortEventsByDate(filtered);

  const countEl = document.getElementById('eventsResultsCount');

  if (filtered.length === 0) {
    container.innerHTML = renderEmptyState(t('event.notFound'), 'bi-calendar-x');
    if (countEl) countEl.textContent = t('event.count', { n: 0 }, 0);
    return;
  }

  container.innerHTML = filtered.map(renderEventCard).join('');
  if (countEl) countEl.textContent = t('event.count', { n: filtered.length }, filtered.length);
}

/**
 * Initializes the events view: populates filters, renders list, binds listeners.
 */
async function initEvents() {
  await ensureDataLoaded();

  if (initializedViews.has('events')) {
    renderEventsList();
    return;
  }
  initializedViews.add('events');

  // Populate filters
  populateSelect('eventsFilterGenre', getUniqueGenres(allEvents), t('filter.allGenres'));
  populateSelect('eventsFilterZone', getUniqueZones(allEvents), t('filter.allZones'));
  populateSelect('eventsFilterCategory', getUniqueCategories(allEvents), t('filter.allCategories'));

  // Render initial list
  renderEventsList();

  // Filter listeners
  document.getElementById('searchEvents')?.addEventListener('input', renderEventsList);
  document.getElementById('eventsFilterGenre')?.addEventListener('change', renderEventsList);
  document.getElementById('eventsFilterZone')?.addEventListener('change', renderEventsList);
  document.getElementById('eventsFilterCategory')?.addEventListener('change', renderEventsList);
  document.getElementById('eventsFilterDateFrom')?.addEventListener('change', renderEventsList);
  document.getElementById('eventsFilterDateTo')?.addEventListener('change', renderEventsList);
  document.getElementById('eventsClearFilters')?.addEventListener('click', () => {
    ['searchEvents', 'eventsFilterGenre', 'eventsFilterZone', 'eventsFilterCategory', 'eventsFilterDateFrom', 'eventsFilterDateTo']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    renderEventsList();
  });
}

/* ------------------------------------------------------------------ */
/*  MAP view                                                           */
/* ------------------------------------------------------------------ */

/**
 * Updates map markers and sidebar based on current filter values.
 */
function updateMapView() {
  if (!leafletMap) return;

  const zone = document.getElementById('mapFilterZone')?.value || '';
  const category = document.getElementById('mapFilterCategory')?.value || '';

  const filtered = sortEventsByDate(filterEvents(allEvents, { zone, category }));

  // Update markers
  if (markerLayer) {
    leafletMap.removeLayer(markerLayer);
  }
  markerLayer = addEventMarkers(leafletMap, filtered);
  if (filtered.length > 0) {
    fitToMarkers(leafletMap, markerLayer);
  }

  // Update sidebar list
  const sidebar = document.getElementById('mapEventsList');
  if (sidebar) {
    sidebar.innerHTML = filtered.length > 0
      ? filtered.map(renderEventCard).join('')
      : renderEmptyState(t('event.notFoundZone'), 'bi-geo-alt');
  }

  // Update count
  const countEl = document.getElementById('mapEventsCount');
  if (countEl) countEl.textContent = t('event.count', { n: filtered.length }, filtered.length);
}

/**
 * Initializes the map view: creates Leaflet map, populates filters, renders markers.
 */
async function initMapView() {
  await ensureDataLoaded();

  // Always destroy and recreate the map to avoid Leaflet container issues
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    markerLayer = null;
  }

  // Small delay to let the container become visible before Leaflet measures it
  await new Promise(resolve => setTimeout(resolve, 50));

  leafletMap = await initMap('map');

  // Populate filters only on first init
  if (!initializedViews.has('map')) {
    initializedViews.add('map');

    populateSelect('mapFilterZone', getUniqueZones(allEvents), t('filter.allZones'));
    populateSelect('mapFilterCategory', getUniqueCategories(allEvents), t('filter.allCategories'));

    // Filter listeners
    document.getElementById('mapFilterZone')?.addEventListener('change', updateMapView);
    document.getElementById('mapFilterCategory')?.addEventListener('change', updateMapView);
    document.getElementById('mapClearFilters')?.addEventListener('click', () => {
      const zone = document.getElementById('mapFilterZone');
      const cat = document.getElementById('mapFilterCategory');
      if (zone) zone.value = '';
      if (cat) cat.value = '';
      updateMapView();
    });
  }

  // Render markers
  updateMapView();
}

/**
 * Cleans up the Leaflet map instance when leaving the map view.
 */
function cleanupMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    markerLayer = null;
  }
}

/* ------------------------------------------------------------------ */
/*  FAVORITS view                                                      */
/* ------------------------------------------------------------------ */

/**
 * Initializes the favorites view: shows saved artists and events.
 */
async function initFavorits() {
  await ensureDataLoaded();

  const container = document.getElementById('favoritsContent');
  if (!container) return;

  const favArtistIds = getFavoritesForType('artist');
  const favEventIds = getFavoritesForType('event');

  const favArtists = allArtists.filter(a => favArtistIds.includes(a['@id']));
  const favEvents = allEvents.filter(e => favEventIds.includes(e['@id']));

  let html = '';

  if (favArtists.length > 0) {
    html += `<h2 class="section-title mb-3">${t('favorites.artistsSection')}</h2>`;
    html += `<div class="row">${favArtists.map(renderArtistCard).join('')}</div>`;
  }

  if (favEvents.length > 0) {
    html += `<h2 class="section-title mb-3 mt-4">${t('favorites.eventsSection')}</h2>`;
    html += `<div class="row">${favEvents.map(renderEventCard).join('')}</div>`;
  }

  if (favArtists.length === 0 && favEvents.length === 0) {
    html = renderEmptyState(t('favorites.empty'), 'bi-heart');
  }

  container.innerHTML = html;
}

/* ------------------------------------------------------------------ */
/*  App initialization                                                 */
/* ------------------------------------------------------------------ */

// --- Theme management (fosc / clar) ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = theme === 'dark' ? 'Mode fosc' : 'Mode clar';
}

function initTheme() {
  const stored = localStorage.getItem('bauxa_theme');
  const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  applyTheme(stored || (sysDark ? 'dark' : 'light'));
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('bauxa_theme', next);
  });
}

initTheme();
// --- Fi theme management ---

document.addEventListener('DOMContentLoaded', async () => {
  // Load translations before rendering anything
  await initI18n();
  applyTranslations();

  // Initialize shared UI
  initScrollToTop();
  initMobileFab();
  updateFavoriteBadge();

  // Check auth state for admin nav
  checkAuth();

  // Load footer developers
  initFooterDevelopers();

  // Actualitza el navbar automàticament quan canvia la sessió de Supabase
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[auth] onAuthStateChange:', event, session?.user?.email);
    checkAuth();
  });

  async function googleLogin() {
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) alert(t('auth.loginError', { message: error.message }));
    } catch (e) {
      console.error('[auth] Error inesperat:', e);
      alert(t('auth.genericError', { message: e.message }));
    }
  }

  document.getElementById('loginBtn')?.addEventListener('click', googleLogin);
  document.getElementById('profileLoginBtn')?.addEventListener('click', googleLogin);
  document.getElementById('adminLoginBtn')?.addEventListener('click', googleLogin);

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    checkAuth();
  });

  // Language switcher
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  // Language submenu accordion toggle
  document.querySelectorAll('.lang-submenu-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const submenu = btn.nextElementSibling;
      const chevron = btn.querySelector('.lang-submenu-chevron');
      const open = submenu.style.display !== 'none';
      submenu.style.display = open ? 'none' : 'block';
      if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
    });
  });

  // Re-render dynamic content when language changes
  document.addEventListener('langChanged', () => {
    applyTranslations();
    // Update footer developers title translation
    initFooterDevelopers();
    // Update filter select default options (first option, no listener re-binding)
    const selectDefaults = [
      ['artistsFilterGenre', 'filter.allGenres'],
      ['artistsFilterZone', 'filter.allZones'],
      ['eventsFilterGenre', 'filter.allGenres'],
      ['eventsFilterZone', 'filter.allZones'],
      ['eventsFilterCategory', 'filter.allCategories'],
      ['mapFilterZone', 'filter.allZones'],
      ['mapFilterCategory', 'filter.allCategories'],
    ];
    selectDefaults.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el?.options[0]) el.options[0].text = t(key);
    });
    // Re-render the active view's dynamic content
    refreshView();
  });

  document.addEventListener('admin:contentChanged', () => {
    dataLoaded = false;
    initializedViews.delete('home');
    initializedViews.delete('artists');
    initializedViews.delete('events');
    initializedViews.delete('map');
  });

  // Register route handlers
  registerRoutes({
    home: initHome,
    artists: initArtists,
    events: initEvents,
    map: initMapView,
    favorits: initFavorits,
    profile: initProfile,
    solicituds: initSolicituds,
    admin: initAdmin,
    joc: initJoc
  });

  // Register map cleanup
  registerMapCleanup(cleanupMap);

  // Prefetch catalog data immediately so the chatbot has it ready on first send,
  // regardless of which route the user lands on.
  ensureDataLoaded();

  // Mount the Gemini Nano on-device assistant (available across all views).
  initChatbot();

  // Start router
  initRouter();
});
