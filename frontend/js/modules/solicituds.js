/**
 * @module solicituds
 * @description Handles the edit requests view for promotors.
 * Shows a dynamic form based on entity type (artist, event, news).
 */

import { getAuthState } from './admin.js';
import { apiFetch } from '../config.js';
import { t, getIntlLocale } from '../i18n.js';

function showAlert(message, type) {
  const el = document.getElementById('solicitudsAlert');
  if (!el) return;
  el.className = `alert alert-${type} alert-dismissible mb-4`;
  el.innerHTML = `${message}
    <button type="button" class="btn-close" onclick="this.parentElement.style.display='none'" aria-label="${t('solicituds.closeAlert')}"></button>`;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function getStatusLabel(status) {
  if (status === 'https://schema.org/PotentialActionStatus')
    return `<span class="badge bg-warning text-dark">${t('solicituds.statusPending')}</span>`;
  if (status === 'https://schema.org/CompletedActionStatus')
    return `<span class="badge bg-success">${t('solicituds.statusApproved')}</span>`;
  if (status === 'https://schema.org/FailedActionStatus')
    return `<span class="badge bg-danger">${t('solicituds.statusRejected')}</span>`;
  return '-';
}

// --- Load my requests list ---
async function loadMyRequests() {
  const container = document.getElementById('solicitudsList');
  if (!container) return;

  try {
    const data = await apiFetch('/api/requests');
    const items = data.itemListElement || [];

    if (!items.length) {
      container.innerHTML = `<p class="text-muted">${t('solicituds.emptyList')}</p>`;
      return;
    }

    let html = '';
    for (const el of items) {
      const req = el.item;
      const entityType = req.instrument?.description || '-';
      const actionLabel = req['@type'] === 'CreateAction' ? t('solicituds.actionCreate') : t('solicituds.actionEdit');
      const entityName = req.object?.name || req.object?.headline || req.object?.['@id'] || '-';
      const date = req.startTime ? new Date(req.startTime).toLocaleDateString(getIntlLocale()) : '-';
      const statusHtml = getStatusLabel(req.actionStatus);

      html += `
        <div class="card-bauxa mb-3 p-3">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <strong>${actionLabel} ${entityType}</strong>
              ${req['@type'] !== 'CreateAction' ? `<span class="text-muted small"> — ${entityName}</span>` : ''}
              <p class="small text-muted mb-1 mt-1">${req.description || ''}</p>
              <small class="text-muted">${date}</small>
            </div>
            <div>${statusHtml}</div>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  } catch (err) {
    showAlert(t('solicituds.loadError', { error: err.message }), 'danger');
  }
}

// --- Load entity options for "update" action ---
async function loadEntityOptions(entityType) {
  const select = document.getElementById('requestEntitySelect');
  if (!select) return;
  select.innerHTML = `<option value="">${t('solicituds.selectPlaceholder')}</option>`;

  const fileMap = { artist: 'artists', event: 'events', news: 'news' };
  try {
    const res = await fetch(`data/${fileMap[entityType]}.json`);
    const data = await res.json();
    for (const el of data.itemListElement || []) {
      const item = el.item;
      const name = item.name || item.headline || item['@id'];
      select.innerHTML += `<option value="${item['@id']}">${name}</option>`;
    }
  } catch { /* silent */ }
}

// --- Fill dynamic fields from existing entity data ---
function fillFormFromEntity(entityType, item) {
  if (entityType === 'artist') {
    document.getElementById('req_artistName').value = item.name || '';
    document.getElementById('req_artistGenres').value = (item.genre || []).join(', ');
    document.getElementById('req_artistDescription').value = item.description || '';
    document.getElementById('req_artistFoundingDate').value = item.foundingDate || '';
    document.getElementById('req_artistLocation').value = item.foundingLocation?.name || '';
    document.getElementById('req_artistZone').value = item.areaServed || '';
    document.getElementById('req_artistImage').value = item.image || '';
    document.getElementById('req_artistMembers').value = (item.member || []).map(m => m.name).join(', ');
    const sameAs = item.sameAs || [];
    document.getElementById('req_artistSpotify').value = sameAs.find(u => u.includes('spotify')) || '';
    document.getElementById('req_artistInstagram').value = sameAs.find(u => u.includes('instagram')) || '';
    document.getElementById('req_artistWikipedia').value = sameAs.find(u => u.includes('wikipedia')) || '';
    document.getElementById('req_artistLang').value = item.lang || '';

  } else if (entityType === 'event') {
    document.getElementById('req_eventName').value = item.name || '';
    document.getElementById('req_eventDescription').value = item.description || '';
    document.getElementById('req_eventCategory').value = item.category || 'concert';
    document.getElementById('req_eventZone').value = item.zone || '';
    document.getElementById('req_eventImage').value = item.image || '';
    document.getElementById('req_eventGenres').value = (item.genre || []).join(', ');
    document.getElementById('req_eventLocationName').value = item.location?.name || '';
    document.getElementById('req_eventLat').value = item.location?.geo?.latitude || '';
    document.getElementById('req_eventLng').value = item.location?.geo?.longitude || '';
    if (item.startDate) document.getElementById('req_eventStartDate').value = item.startDate.slice(0, 16);
    if (item.endDate) document.getElementById('req_eventEndDate').value = item.endDate.slice(0, 16);
    if (item.offers?.price) document.getElementById('req_eventPrice').value = item.offers.price;
    document.getElementById('req_eventLang').value = item.lang || '';

  } else if (entityType === 'news') {
    document.getElementById('req_newsHeadline').value = item.headline || item.name || '';
    document.getElementById('req_newsDescription').value = item.description || '';
    document.getElementById('req_newsCategory').value = item.category || '';
    document.getElementById('req_newsImage').value = item.image || '';
    document.getElementById('req_newsAuthor').value = item.author?.name || '';
    if (item.datePublished) document.getElementById('req_newsDate').value = item.datePublished.slice(0, 10);
    document.getElementById('req_newsLang').value = item.lang || '';
  }
}

// --- Show/hide dynamic fields ---
function showFields(entityType) {
  document.getElementById('requestFieldsArtist').style.display = entityType === 'artist' ? 'block' : 'none';
  document.getElementById('requestFieldsEvent').style.display = entityType === 'event' ? 'block' : 'none';
  document.getElementById('requestFieldsNews').style.display = entityType === 'news' ? 'block' : 'none';
  document.getElementById('requestMotiveWrapper').style.display = entityType ? 'block' : 'none';
  document.getElementById('requestSubmitWrapper').style.display = entityType ? 'block' : 'none';
}

// --- Collect form data into Schema.org object ---
function collectProposedData(entityType) {
  if (entityType === 'artist') {
    const genres = document.getElementById('req_artistGenres').value.split(',').map(g => g.trim()).filter(Boolean);
    const members = document.getElementById('req_artistMembers').value.split(',').map(m => m.trim()).filter(Boolean);

    const data = {
      '@type': 'MusicGroup',
      name: document.getElementById('req_artistName').value.trim(),
      description: document.getElementById('req_artistDescription').value.trim(),
      genre: genres
    };

    const foundingDate = document.getElementById('req_artistFoundingDate').value.trim();
    if (foundingDate) data.foundingDate = foundingDate;

    const location = document.getElementById('req_artistLocation').value.trim();
    if (location) {
      data.foundingLocation = {
        '@type': 'Place',
        name: location,
        address: { '@type': 'PostalAddress', addressLocality: location, addressRegion: 'Mallorca' }
      };
    }

    const zone = document.getElementById('req_artistZone').value;
    if (zone) data.areaServed = zone;

    const image = document.getElementById('req_artistImage').value.trim();
    if (image) data.image = image;

    const sameAs = [];
    const spotify = document.getElementById('req_artistSpotify').value.trim();
    const instagram = document.getElementById('req_artistInstagram').value.trim();
    const wikipedia = document.getElementById('req_artistWikipedia').value.trim();
    if (spotify) sameAs.push(spotify);
    if (instagram) sameAs.push(instagram);
    if (wikipedia) sameAs.push(wikipedia);
    if (sameAs.length) data.sameAs = sameAs;

    if (members.length) data.member = members.map(name => ({ '@type': 'Person', name }));

    const artistLang = document.getElementById('req_artistLang').value;
    if (artistLang) data.lang = artistLang;

    return data;

  } else if (entityType === 'event') {
    const data = {
      '@type': 'MusicEvent',
      name: document.getElementById('req_eventName').value.trim(),
      description: document.getElementById('req_eventDescription').value.trim(),
      category: document.getElementById('req_eventCategory').value
    };

    const startDate = document.getElementById('req_eventStartDate').value;
    if (startDate) data.startDate = startDate + ':00+02:00';
    const endDate = document.getElementById('req_eventEndDate').value;
    if (endDate) data.endDate = endDate + ':00+02:00';

    const locName = document.getElementById('req_eventLocationName').value.trim();
    const lat = document.getElementById('req_eventLat').value;
    const lng = document.getElementById('req_eventLng').value;
    if (locName) {
      data.location = { '@type': 'Place', name: locName };
      if (lat && lng) {
        data.location.geo = { '@type': 'GeoCoordinates', latitude: parseFloat(lat), longitude: parseFloat(lng) };
      }
    }

    const price = document.getElementById('req_eventPrice').value;
    if (price) data.offers = { '@type': 'Offer', price: parseFloat(price), priceCurrency: 'EUR' };

    const zone = document.getElementById('req_eventZone').value;
    if (zone) data.zone = zone;

    const genres = document.getElementById('req_eventGenres').value.split(',').map(g => g.trim()).filter(Boolean);
    if (genres.length) data.genre = genres;

    const image = document.getElementById('req_eventImage').value.trim();
    if (image) data.image = image;

    const eventLang = document.getElementById('req_eventLang').value;
    if (eventLang) data.lang = eventLang;

    return data;

  } else if (entityType === 'news') {
    const headline = document.getElementById('req_newsHeadline').value.trim();
    const data = {
      '@type': 'NewsArticle',
      headline,
      name: headline,
      description: document.getElementById('req_newsDescription').value.trim()
    };

    const date = document.getElementById('req_newsDate').value;
    if (date) data.datePublished = date;

    const author = document.getElementById('req_newsAuthor').value.trim();
    if (author) data.author = { '@type': 'Person', name: author };

    const category = document.getElementById('req_newsCategory').value.trim();
    if (category) data.category = category;

    const image = document.getElementById('req_newsImage').value.trim();
    if (image) data.image = image;

    const newsLang = document.getElementById('req_newsLang').value;
    if (newsLang) data.lang = newsLang;

    return data;
  }
  return null;
}

// --- Reset all dynamic fields ---
function resetDynamicFields() {
  ['req_artistName','req_artistGenres','req_artistDescription','req_artistFoundingDate',
   'req_artistLocation','req_artistImage','req_artistMembers','req_artistSpotify',
   'req_artistInstagram','req_artistWikipedia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('req_artistZone').value = '';
  document.getElementById('req_artistLang').value = '';

  ['req_eventName','req_eventDescription','req_eventStartDate','req_eventEndDate',
   'req_eventPrice','req_eventLocationName','req_eventLat','req_eventLng',
   'req_eventGenres','req_eventImage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('req_eventCategory').value = 'concert';
  document.getElementById('req_eventZone').value = '';
  document.getElementById('req_eventLang').value = '';

  ['req_newsHeadline','req_newsDescription','req_newsCategory','req_newsDate',
   'req_newsAuthor','req_newsImage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('req_newsLang').value = '';
}

// --- Init ---
let solicitudsInitialized = false;

export async function initSolicituds() {
  const auth = getAuthState();
  const notAuth = document.getElementById('solicitudsNotAuth');
  const content = document.getElementById('solicitudsContent');

  const role = auth?.profile?.role;
  if (!auth?.authenticated || (role !== 'promotor' && role !== 'admin')) {
    if (notAuth) notAuth.style.display = 'block';
    if (content) content.style.display = 'none';
    return;
  }

  if (notAuth) notAuth.style.display = 'none';
  if (content) content.style.display = 'block';

  loadMyRequests();

  // Only bind event listeners once
  if (solicitudsInitialized) return;
  solicitudsInitialized = true;

  const formWrapper = document.getElementById('newRequestForm');
  const newBtn = document.getElementById('newRequestBtn');
  const cancelBtn = document.getElementById('cancelRequestBtn');
  const entityTypeSelect = document.getElementById('requestEntityType');
  const actionSelect = document.getElementById('requestAction');
  const entitySelectWrapper = document.getElementById('requestEntitySelectWrapper');
  const entitySelect = document.getElementById('requestEntitySelect');

  newBtn?.addEventListener('click', () => {
    document.getElementById('requestForm')?.reset();
    resetDynamicFields();
    showFields('');
    entitySelectWrapper.style.display = 'none';
    if (formWrapper) formWrapper.style.display = 'block';
    formWrapper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  cancelBtn?.addEventListener('click', () => {
    if (formWrapper) formWrapper.style.display = 'none';
    document.getElementById('requestForm')?.reset();
    resetDynamicFields();
    showFields('');
  });

  // When entity type changes → show/hide fields, reset entity select
  entityTypeSelect?.addEventListener('change', () => {
    const type = entityTypeSelect.value;
    resetDynamicFields();
    showFields(type);
    entitySelect.innerHTML = `<option value="">${t('solicituds.selectPlaceholder')}</option>`;
    if (actionSelect.value === 'update' && type) {
      loadEntityOptions(type);
    }
    // Reset action if needed
    if (!type) actionSelect.value = '';
  });

  // When action changes → show/hide entity select
  actionSelect?.addEventListener('change', () => {
    const isUpdate = actionSelect.value === 'update';
    entitySelectWrapper.style.display = isUpdate ? '' : 'none';
    if (isUpdate && entityTypeSelect.value) {
      loadEntityOptions(entityTypeSelect.value);
    }
    // Show fields if entity type already selected
    const type = entityTypeSelect.value;
    if (type) showFields(type);
  });

  // When specific entity selected (update mode) → pre-fill form
  entitySelect?.addEventListener('change', async () => {
    const entityId = entitySelect.value;
    const entityType = entityTypeSelect.value;
    if (!entityId || !entityType) return;

    const fileMap = { artist: 'artists', event: 'events', news: 'news' };
    try {
      const res = await fetch(`data/${fileMap[entityType]}.json`);
      const data = await res.json();
      const found = data.itemListElement.find(el => el.item['@id'] === entityId);
      if (found) fillFormFromEntity(entityType, found.item);
    } catch { /* silent */ }
  });

  // Form submit
  document.getElementById('requestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const entityType = entityTypeSelect?.value;
    const action = actionSelect?.value;
    const entityId = action === 'update' ? entitySelect?.value : null;
    const description = document.getElementById('requestDescription')?.value?.trim();

    if (!entityType || !action) {
      showAlert(t('solicituds.errorSelectType'), 'danger');
      return;
    }
    if (action === 'update' && !entityId) {
      showAlert(t('solicituds.errorSelectEntity'), 'danger');
      return;
    }
    if (!description) {
      showAlert(t('solicituds.errorMotive'), 'danger');
      document.getElementById('requestDescription')?.focus();
      return;
    }

    const proposedData = collectProposedData(entityType);
    if (!proposedData) {
      showAlert(t('solicituds.errorLoadData'), 'danger');
      return;
    }

    // Validate minimum fields depending on entity type
    if (entityType === 'artist' && !document.getElementById('req_artistName')?.value.trim()) {
      showAlert(t('solicituds.errorArtistName'), 'danger');
      document.getElementById('req_artistName')?.focus();
      return;
    }
    if (entityType === 'event' && !document.getElementById('req_eventName')?.value.trim()) {
      showAlert(t('solicituds.errorEventName'), 'danger');
      document.getElementById('req_eventName')?.focus();
      return;
    }
    if (entityType === 'news' && !document.getElementById('req_newsHeadline')?.value.trim()) {
      showAlert(t('solicituds.errorNewsTitle'), 'danger');
      document.getElementById('req_newsHeadline')?.focus();
      return;
    }

    try {
      await apiFetch('/api/requests', {
        method: 'POST',
        body: JSON.stringify({ entityType, entityId, action, proposedData, description })
      });
      showAlert(t('solicituds.sentOk'), 'success');
      document.getElementById('requestForm')?.reset();
      resetDynamicFields();
      showFields('');
      if (formWrapper) formWrapper.style.display = 'none';
      loadMyRequests();
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  });
}
