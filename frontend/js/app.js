/**
 * @file app.js
 * @description Unified SPA entry point for Dona'm Bauxa.
 * Replaces the per-page entry points (main.js, artists.js, events.js, map.js).
 */

import { loadArtists, loadEvents, loadNews, loadExternEvents } from './modules/dataLoader.js';
import {
  renderFeaturedEvent, renderEventCard, renderNewsCard, renderArtistCard,
  renderLoading, renderEmptyState, renderArtistDetail, renderEventDetail
} from './modules/renderer.js';
import {
  filterArtists, filterEvents, sortEventsByDate, getUpcomingEvents,
  getUniqueGenres, getUniqueZones, getUniqueCategories
} from './modules/filters.js';
import {
  initScrollToTop, updateFavoriteBadge, initGlobalEventHandlers,
  setActiveNavLink, populateSelect
} from './modules/ui.js';
import { initMap, addEventMarkers, fitToMarkers } from './modules/mapModule.js';
import { initRouter, registerRoutes, registerMapCleanup } from './router.js';
import { getFavorites as getFavoritesForType } from './modules/favorites.js';
import { initAdmin, checkAuth } from './modules/admin.js';
import { supabase } from './config.js';
import { initProfile } from './modules/profile.js';
import { initSolicituds } from './modules/solicituds.js';
import { initJoc } from './modules/joc.js';

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
async function ensureDataLoaded() {
  if (dataLoaded) return;
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
      : renderEmptyState('No hi ha esdeveniments destacats', 'bi-calendar-x');
  }

  if (upcomingContainer) {
    const upcoming = sortEventsByDate(getUpcomingEvents(allEvents));
    upcomingContainer.innerHTML = upcoming.length > 0
      ? upcoming.slice(0, 5).map(renderEventCard).join('')
      : renderEmptyState('No hi ha propers esdeveniments', 'bi-calendar-x');
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
    container.innerHTML = renderEmptyState(
      "No s'han trobat artistes amb aquests filtres.",
      'bi-music-note-list'
    );
    const countEl = document.getElementById('artistsResultsCount');
    if (countEl) countEl.textContent = '0 artistes';
    return;
  }

  container.innerHTML = filtered.map(renderArtistCard).join('');

  const countEl = document.getElementById('artistsResultsCount');
  if (countEl) {
    countEl.textContent = `${filtered.length} artiste${filtered.length !== 1 ? 's' : ''}`;
  }
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
  populateSelect('artistsFilterGenre', getUniqueGenres(allArtists), 'Tots els generes');
  populateSelect('artistsFilterZone', getUniqueZones(allArtists), 'Totes les zones');

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
    container.innerHTML = renderEmptyState(
      "No s'han trobat esdeveniments amb aquests filtres.",
      'bi-calendar-x'
    );
    if (countEl) countEl.textContent = '0 esdeveniments';
    return;
  }

  container.innerHTML = filtered.map(renderEventCard).join('');
  if (countEl) {
    countEl.textContent = `${filtered.length} esdeveniment${filtered.length !== 1 ? 's' : ''}`;
  }
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
  populateSelect('eventsFilterGenre', getUniqueGenres(allEvents), 'Tots els generes');
  populateSelect('eventsFilterZone', getUniqueZones(allEvents), 'Totes les zones');
  populateSelect('eventsFilterCategory', getUniqueCategories(allEvents), 'Totes les categories');

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
      : renderEmptyState("No hi ha esdeveniments en aquesta zona.", 'bi-geo-alt');
  }

  // Update count
  const countEl = document.getElementById('mapEventsCount');
  if (countEl) countEl.textContent = `${filtered.length} esdeveniment${filtered.length !== 1 ? 's' : ''}`;
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

    populateSelect('mapFilterZone', getUniqueZones(allEvents), 'Totes les zones');
    populateSelect('mapFilterCategory', getUniqueCategories(allEvents), 'Totes les categories');

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
    html += `<h2 class="section-title mb-3">Artistes Favorits</h2>`;
    html += `<div class="row">${favArtists.map(renderArtistCard).join('')}</div>`;
  }

  if (favEvents.length > 0) {
    html += `<h2 class="section-title mb-3 mt-4">Esdeveniments Favorits</h2>`;
    html += `<div class="row">${favEvents.map(renderEventCard).join('')}</div>`;
  }

  if (favArtists.length === 0 && favEvents.length === 0) {
    html = renderEmptyState(
      "No tens cap favorit guardat. Explora artistes i esdeveniments per afegir-ne!",
      'bi-heart'
    );
  }

  container.innerHTML = html;
}

/* ------------------------------------------------------------------ */
/*  App initialization                                                 */
/* ------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize shared UI
  initScrollToTop();
  updateFavoriteBadge();

  // Check auth state for admin nav
  checkAuth();

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
      if (error) alert('Error inici de sessió: ' + error.message);
    } catch (e) {
      console.error('[auth] Error inesperat:', e);
      alert('Error: ' + e.message);
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

  // Start router
  initRouter();
});
