/**
 * @module router
 * @description Hash-based SPA router for Dona'm Bauxa.
 * Listens to hashchange events and shows/hides data-view sections.
 */

import { setActiveNavLink } from './modules/ui.js';

/** @type {Object<string, Function>} Route handlers keyed by view name */
let routeHandlers = {};

/** @type {string|null} Currently active view name */
let currentView = null;

/** @type {Function|null} Cleanup function for map view */
let mapCleanup = null;

/**
 * Registers route handler functions for each view.
 * @param {Object<string, Function>} handlers - Map of view name to init function
 */
export function registerRoutes(handlers) {
  routeHandlers = handlers;
}

/**
 * Registers a cleanup function to call when leaving the map view.
 * @param {Function} fn - Cleanup function (should call map.remove())
 */
export function registerMapCleanup(fn) {
  mapCleanup = fn;
}

/**
 * Resolves the current hash to a view name.
 * Defaults to 'home' if hash is empty or unrecognized.
 * @returns {string} View name
 */
function resolveView() {
  const hash = window.location.hash.replace('#', '') || 'home';
  const validViews = ['home', 'artists', 'events', 'map', 'favorits', 'profile', 'solicituds', 'admin', 'joc'];
  return validViews.includes(hash) ? hash : 'home';
}

/**
 * Switches to the specified view: hides all sections, shows the target,
 * calls the route handler, updates nav state, and resets scroll.
 * @param {string} view - The view name to activate
 */
function switchView(view) {
  // Close any open Bootstrap navbar (mobile)
  const navCollapse = document.getElementById('mainNav');
  if (navCollapse && navCollapse.classList.contains('show')) {
    const bsCollapse = bootstrap.Collapse.getInstance(navCollapse);
    if (bsCollapse) bsCollapse.hide();
  }

  // Close any open modals
  document.querySelectorAll('.modal.show').forEach(modal => {
    const bsModal = bootstrap.Modal.getInstance(modal);
    if (bsModal) bsModal.hide();
  });

  // If leaving the map view, run cleanup
  if (currentView === 'map' && view !== 'map' && mapCleanup) {
    mapCleanup();
  }

  // Hide all views
  document.querySelectorAll('[data-view]').forEach(el => {
    el.style.display = 'none';
  });

  // Show target view
  const target = document.querySelector(`[data-view="${view}"]`);
  if (target) {
    target.style.display = 'block';
  }

  // Update active nav link
  setActiveNavLink();

  // Scroll to top
  window.scrollTo(0, 0);

  // Call route handler if registered
  if (routeHandlers[view]) {
    routeHandlers[view]();
  }

  currentView = view;
}

/**
 * Re-calls the current view's route handler without navigating.
 * Used by i18n to refresh dynamic content after a language change.
 */
export function refreshView() {
  if (currentView && routeHandlers[currentView]) {
    routeHandlers[currentView]();
  }
}

/**
 * Initializes the router: listens to hashchange and triggers initial route.
 */
export function initRouter() {
  window.addEventListener('hashchange', () => {
    const view = resolveView();
    switchView(view);
  });

  // Initial route
  const view = resolveView();
  switchView(view);
}
