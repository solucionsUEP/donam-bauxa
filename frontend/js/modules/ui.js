/**
 * @module ui
 * @description Shared UI utilities: scroll-to-top, favorites badge, event delegation.
 */

import { toggleFavorite, getTotalFavoriteCount } from './favorites.js';
import { downloadICS } from './calendar.js';

/**
 * Initializes the scroll-to-top button behavior.
 */
export function initScrollToTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/**
 * Updates the favorites badge count in the navbar.
 */
export function updateFavoriteBadge() {
  const count = getTotalFavoriteCount();
  for (const id of ['favBadge', 'favBadgeUser']) {
    const badge = document.getElementById(id);
    if (!badge) continue;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

/**
 * Sets up global event delegation for favorite buttons and calendar buttons.
 * @param {Array<Object>} allEvents - All events data (needed for calendar downloads)
 */
export function initGlobalEventHandlers(allEvents = []) {
  // Favorites delegation
  document.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav-type]');
    if (favBtn) {
      e.preventDefault();
      const type = favBtn.dataset.favType;
      const id = favBtn.dataset.favId;
      const isNowFav = toggleFavorite(type, id);
      const icon = favBtn.querySelector('i');
      if (icon) {
        icon.className = isNowFav ? 'bi bi-heart-fill' : 'bi bi-heart';
      }
      favBtn.classList.toggle('active', isNowFav);

      // Update all other buttons with the same ID
      document.querySelectorAll(`[data-fav-type="${type}"][data-fav-id="${id}"]`).forEach(btn => {
        if (btn !== favBtn) {
          const ic = btn.querySelector('i');
          if (ic) ic.className = isNowFav ? 'bi bi-heart-fill' : 'bi bi-heart';
          btn.classList.toggle('active', isNowFav);
        }
      });

      updateFavoriteBadge();
    }
  });

  // Calendar delegation
  document.addEventListener('click', (e) => {
    const calBtn = e.target.closest('.btn-calendar');
    if (calBtn) {
      e.preventDefault();
      const eventId = calBtn.dataset.eventId;
      const event = allEvents.find(ev => ev['@id'] === eventId);
      if (event) {
        downloadICS(event);
      }
    }
  });

  // Listen for favorites changes to update badge
  window.addEventListener('favoritesChanged', () => {
    updateFavoriteBadge();
  });
}

/**
 * Sets the active nav link based on the current hash route.
 */
export function setActiveNavLink() {
  const hash = window.location.hash || '#home';
  document.querySelectorAll('.sidebar-link[href]').forEach(link => {
    const href = link.getAttribute('href');
    link.classList.toggle('active', href === hash);
  });
}

/**
 * Populates a select element with options.
 * @param {string} selectId - DOM ID of the select element
 * @param {string[]} options - Array of option values
 * @param {string} [defaultLabel='Tots'] - Default option label
 */
export function populateSelect(selectId, options, defaultLabel = 'Tots') {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = `<option value="">${defaultLabel}</option>`;
  options.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt;
    select.appendChild(el);
  });
}
