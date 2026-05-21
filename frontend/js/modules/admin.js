/**
 * @module admin
 * @description Handles authentication state, navbar updates, and the admin dashboard.
 */

import { clearDataCache } from './dataLoader.js';
import { supabase, BACKEND_URL, apiFetch } from '../config.js';
import { initDownloadAgenda } from './downloadAgenda.js';
import { t, getIntlLocale } from '../i18n.js';

/** @type {{ authenticated: boolean, user: Object|null, profile: Object|null }|null} */
let authState = null;

export function getAuthState() {
  return authState;
}

/**
 * Checks authentication status with the server.
 * Updates the navbar based on role.
 */
export async function checkAuth() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      authState = { authenticated: false, user: null, profile: null };
    } else {
      const res = await fetch(BACKEND_URL + '/auth/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      authState = await res.json();
      if (!authState.authenticated) {
        await supabase.auth.signOut();
      }
    }
  } catch {
    authState = { authenticated: false, user: null, profile: null };
  }

  const navLogin = document.getElementById('navLogin');
  const navUser = document.getElementById('navUser');
  const navLangSwitcher = document.getElementById('navLangSwitcher');
  const navSolicituds = document.getElementById('navSolicituds');
  const navAdmin = document.getElementById('navAdmin');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  if (authState.authenticated && authState.profile) {
    const role = authState.profile.role;

    if (navLogin) navLogin.classList.add('d-none');
    if (navLangSwitcher) navLangSwitcher.classList.add('d-none');
    if (navUser) navUser.classList.remove('d-none');
    if (userAvatar) userAvatar.src = authState.profile.image || '';
    if (userName) userName.textContent = authState.profile.displayName || authState.user?.name || '';

    // Show solicituds for promotor and admin
    if (navSolicituds) {
      navSolicituds.classList.toggle('d-none', role === 'lector');
    }
    // Show admin only for admin
    if (navAdmin) {
      navAdmin.classList.toggle('d-none', role !== 'admin');
    }
  } else {
    if (navLogin) navLogin.classList.remove('d-none');
    if (navLangSwitcher) navLangSwitcher.classList.remove('d-none');
    if (navUser) navUser.classList.add('d-none');
    if (navSolicituds) navSolicituds?.classList.add('d-none');
    if (navAdmin) navAdmin?.classList.add('d-none');
  }
}

// --- Admin Dashboard ---

function showAlert(message, type) {
  const el = document.getElementById('adminAlert');
  if (!el) return;
  el.className = `alert alert-${type} mb-4`;
  el.textContent = message;
  el.style.display = 'block';
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
}


// --- Content table rendering ---

function renderContentTable(items, entityType) {
  if (!items.length) return `<p class="text-muted">${t('admin.noItems')}</p>`;

  const getName = (item) => item.name || item.headline || t('admin.noName');
  const isArchived = (item) => item.additionalProperty?.find(p => p.name === 'archived')?.value === true;

  let html = `<table class="table table-sm">
    <thead><tr><th>${t('admin.colId')}</th><th>${t('admin.colName')}</th><th>${t('admin.colStatus')}</th><th>${t('admin.colActions')}</th></tr></thead><tbody>`;

  for (const el of items) {
    const item = el.item;
    const archived = isArchived(item);
    html += `<tr class="${archived ? 'opacity-50' : ''}">
      <td><small>${item['@id']}</small></td>
      <td>${getName(item)}</td>
      <td>${archived ? `<span class="badge bg-warning">${t('admin.statusArchived')}</span>` : `<span class="badge bg-success">${t('admin.statusActive')}</span>`}</td>
      <td>
        <button class="btn btn-sm btn-bauxa-outline me-1 admin-edit-btn" data-type="${entityType}" data-id="${item['@id']}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-bauxa-outline me-1 admin-archive-btn" data-type="${entityType}" data-id="${item['@id']}" data-archived="${archived}">
          <i class="bi bi-${archived ? 'eye' : 'archive'}"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger admin-delete-btn" data-type="${entityType}" data-id="${item['@id']}"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

async function loadContentList(entityType, containerId) {
  clearDataCache(); // Invalidate public data cache
  document.dispatchEvent(new CustomEvent('admin:contentChanged')); // Signal app.js to re-fetch
  try {
    const data = await apiFetch(`/api/admin/${entityType}`);
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = renderContentTable(data.itemListElement || [], entityType);
    bindContentActions(entityType);
  } catch (err) {
    showAlert(t('admin.loadError', { type: entityType, error: err.message }), 'danger');
  }
}

function bindContentActions(entityType) {
  // Archive buttons
  document.querySelectorAll(`.admin-archive-btn[data-type="${entityType}"]`).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const currentlyArchived = btn.dataset.archived === 'true';
      try {
        await apiFetch(`/api/admin/${entityType}/${id}/archive`, {
          method: 'PUT',
          body: JSON.stringify({ archived: !currentlyArchived })
        });
        showAlert(t(currentlyArchived ? 'admin.unarchivedOk' : 'admin.archivedOk'), 'success');
        loadContentList(entityType, `admin${capitalize(entityType)}List`);
      } catch (err) {
        showAlert(err.message, 'danger');
      }
    });
  });

  // Delete buttons
  document.querySelectorAll(`.admin-delete-btn[data-type="${entityType}"]`).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.confirmDelete'))) return;
      try {
        await apiFetch(`/api/admin/${entityType}/${btn.dataset.id}`, { method: 'DELETE' });
        showAlert(t('admin.deletedOk'), 'success');
        loadContentList(entityType, `admin${capitalize(entityType)}List`);
      } catch (err) {
        showAlert(err.message, 'danger');
      }
    });
  });

  // Edit buttons
  document.querySelectorAll(`.admin-edit-btn[data-type="${entityType}"]`).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        const data = await apiFetch(`/api/admin/${entityType}`);
        const item = data.itemListElement.find(el => el.item['@id'] === id)?.item;
        if (item) openEditForm(entityType, item);
      } catch (err) {
        showAlert(err.message, 'danger');
      }
    });
  });
}

function capitalize(str) {
  if (str === 'news') return 'News';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function openEditForm(entityType, item) {
  if (entityType === 'artists') {
    fillArtistForm(item);
    document.getElementById('adminArtistFormTitle').textContent = t('admin.formTitleEditArtist');
    document.getElementById('adminArtistForm').style.display = 'block';
  } else if (entityType === 'events') {
    fillEventForm(item);
    document.getElementById('adminEventFormTitle').textContent = t('admin.formTitleEditEvent');
    document.getElementById('adminEventForm').style.display = 'block';
  } else if (entityType === 'news') {
    fillNewsForm(item);
    document.getElementById('adminNewsFormTitle').textContent = t('admin.formTitleEditNews');
    document.getElementById('adminNewsForm').style.display = 'block';
  }
}

// --- Artist form ---

function fillArtistForm(item) {
  document.getElementById('editArtistId').value = item['@id'] || '';
  document.getElementById('artistName').value = item.name || '';
  document.getElementById('artistGenres').value = (item.genre || []).join(', ');
  document.getElementById('artistDescription').value = item.description || '';
  document.getElementById('artistFoundingDate').value = item.foundingDate || '';
  document.getElementById('artistLocation').value = item.foundingLocation?.name || '';
  document.getElementById('artistZone').value = item.areaServed || '';
  document.getElementById('artistImage').value = item.image || '';
  document.getElementById('artistLang').value = item.lang || '';
  document.getElementById('artistFeatured').checked = item.additionalProperty?.find(p => p.name === 'featured')?.value === true;

  const sameAs = item.sameAs || [];
  document.getElementById('artistSpotify').value = sameAs.find(u => u.includes('spotify')) || '';
  document.getElementById('artistInstagram').value = sameAs.find(u => u.includes('instagram')) || '';
  document.getElementById('artistWikipedia').value = sameAs.find(u => u.includes('wikipedia')) || '';

  document.getElementById('artistMembers').value = (item.member || []).map(m => m.name).join(', ');
}

function collectArtistFormData() {
  const genres = document.getElementById('artistGenres').value.split(',').map(g => g.trim()).filter(Boolean);
  const members = document.getElementById('artistMembers').value.split(',').map(m => m.trim()).filter(Boolean);
  const albums = [];
  document.querySelectorAll('#adminArtistForm .album-row, #addArtistForm .album-row').forEach(row => {
    const name = row.querySelector('.album-name')?.value?.trim();
    const year = row.querySelector('.album-year')?.value?.trim();
    if (name) albums.push({ name, year });
  });

  const data = {
    '@type': 'MusicGroup',
    name: document.getElementById('artistName').value.trim(),
    description: document.getElementById('artistDescription').value.trim(),
    genre: genres
  };

  const foundingDate = document.getElementById('artistFoundingDate').value.trim();
  if (foundingDate) data.foundingDate = foundingDate;

  const location = document.getElementById('artistLocation').value.trim();
  if (location) {
    data.foundingLocation = {
      '@type': 'Place',
      name: location,
      address: { '@type': 'PostalAddress', addressLocality: location, addressRegion: 'Mallorca' }
    };
  }

  const image = document.getElementById('artistImage').value.trim();
  if (image) data.image = image;

  const sameAs = [];
  const spotify = document.getElementById('artistSpotify').value.trim();
  const instagram = document.getElementById('artistInstagram').value.trim();
  const wikipedia = document.getElementById('artistWikipedia').value.trim();
  if (spotify) sameAs.push(spotify);
  if (instagram) sameAs.push(instagram);
  if (wikipedia) sameAs.push(wikipedia);
  if (sameAs.length) data.sameAs = sameAs;

  if (members.length) data.member = members.map(name => ({ '@type': 'Person', name }));
  if (albums.length) data.album = albums.map(a => ({ '@type': 'MusicAlbum', name: a.name, datePublished: a.year || '' }));

  const zone = document.getElementById('artistZone').value;
  if (zone) data.areaServed = zone;

  const lang = document.getElementById('artistLang').value;
  if (lang) data.lang = lang;

  const additionalProperty = [];
  if (spotify) {
    const match = spotify.match(/artist\/([a-zA-Z0-9]+)/);
    if (match) additionalProperty.push({ '@type': 'PropertyValue', name: 'spotifyId', value: match[1] });
  }
  additionalProperty.push({ '@type': 'PropertyValue', name: 'featured', value: document.getElementById('artistFeatured').checked });
  data.additionalProperty = additionalProperty;

  return data;
}

// --- Event form ---

function fillEventForm(item) {
  document.getElementById('editEventId').value = item['@id'] || '';
  document.getElementById('eventName').value = item.name || '';
  document.getElementById('eventDescription').value = item.description || '';
  document.getElementById('eventCategory').value = item.category || 'concert';
  document.getElementById('eventZone').value = item.zone || '';
  document.getElementById('eventImage').value = item.image || '';
  document.getElementById('eventLang').value = item.lang || '';
  document.getElementById('eventFeatured').checked = item.featured === true;
  document.getElementById('eventLocationName').value = item.location?.name || '';
  document.getElementById('eventLat').value = item.location?.geo?.latitude || '';
  document.getElementById('eventLng').value = item.location?.geo?.longitude || '';
  document.getElementById('eventGenres').value = (item.genre || []).join(', ');

  if (item.startDate) {
    document.getElementById('eventStartDate').value = item.startDate.slice(0, 16);
  }
  if (item.endDate) {
    document.getElementById('eventEndDate').value = item.endDate.slice(0, 16);
  }
  if (item.offers?.price) {
    document.getElementById('eventPrice').value = item.offers.price;
  }
}

function collectEventFormData() {
  const data = {
    '@type': 'MusicEvent',
    name: document.getElementById('eventName').value.trim(),
    description: document.getElementById('eventDescription').value.trim(),
    category: document.getElementById('eventCategory').value
  };

  const startDate = document.getElementById('eventStartDate').value;
  if (startDate) data.startDate = startDate + ':00+02:00';
  const endDate = document.getElementById('eventEndDate').value;
  if (endDate) data.endDate = endDate + ':00+02:00';

  const locName = document.getElementById('eventLocationName').value.trim();
  const lat = document.getElementById('eventLat').value;
  const lng = document.getElementById('eventLng').value;
  if (locName) {
    data.location = { '@type': 'Place', name: locName };
    if (lat && lng) {
      data.location.geo = { '@type': 'GeoCoordinates', latitude: parseFloat(lat), longitude: parseFloat(lng) };
    }
  }

  const price = document.getElementById('eventPrice').value;
  if (price) {
    data.offers = { '@type': 'Offer', price: parseFloat(price), priceCurrency: 'EUR' };
  }

  const zone = document.getElementById('eventZone').value;
  if (zone) data.zone = zone;

  const genres = document.getElementById('eventGenres').value.split(',').map(g => g.trim()).filter(Boolean);
  if (genres.length) data.genre = genres;

  const image = document.getElementById('eventImage').value.trim();
  if (image) data.image = image;

  data.featured = document.getElementById('eventFeatured').checked;

  const eventLang = document.getElementById('eventLang').value;
  if (eventLang) data.lang = eventLang;

  return data;
}

// --- News form ---

function fillNewsForm(item) {
  document.getElementById('editNewsId').value = item['@id'] || '';
  document.getElementById('newsHeadline').value = item.headline || '';
  document.getElementById('newsDescription').value = item.description || '';
  document.getElementById('newsCategory').value = item.category || '';
  document.getElementById('newsImage').value = item.image || '';
  document.getElementById('newsAuthor').value = item.author?.name || '';
  document.getElementById('newsLang').value = item.lang || '';
  if (item.datePublished) {
    document.getElementById('newsDate').value = item.datePublished.slice(0, 10);
  }
}

function collectNewsFormData() {
  const data = {
    '@type': 'NewsArticle',
    headline: document.getElementById('newsHeadline').value.trim(),
    name: document.getElementById('newsHeadline').value.trim(),
    description: document.getElementById('newsDescription').value.trim()
  };

  const date = document.getElementById('newsDate').value;
  if (date) data.datePublished = date;

  const author = document.getElementById('newsAuthor').value.trim();
  if (author) data.author = { '@type': 'Person', name: author };

  const category = document.getElementById('newsCategory').value.trim();
  if (category) data.category = category;

  const image = document.getElementById('newsImage').value.trim();
  if (image) data.image = image;

  const newsLang = document.getElementById('newsLang').value;
  if (newsLang) data.lang = newsLang;

  return data;
}

// --- API Keys management ---

async function loadApiKeys() {
  const container = document.getElementById('adminApiKeysList');
  if (!container) return;
  try {
    const rows = await apiFetch('/api/admin/api-keys');
    if (!rows.length) {
      container.innerHTML = `<p class="text-muted">${t('admin.noApiKeys')}</p>`;
      return;
    }
    container.innerHTML = `
      <table class="table table-bauxa table-sm">
        <thead><tr>
          <th>${t('admin.colName')}</th><th>${t('admin.colAgent')}</th><th>${t('admin.colCreated')}</th><th>${t('admin.colLastUsed')}</th><th>${t('admin.colStatus')}</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map(k => `
            <tr>
              <td>${k.name}</td>
              <td>${k.agent_name}<br><small class="text-muted">${k.agent_email}</small></td>
              <td><small>${new Date(k.created_at).toLocaleDateString(getIntlLocale())}</small></td>
              <td><small>${k.last_used_at ? new Date(k.last_used_at).toLocaleDateString(getIntlLocale()) : '—'}</small></td>
              <td>${k.revoked ? `<span class="badge bg-secondary">${t('admin.keyStatusRevoked')}</span>` : `<span class="badge bg-success">${t('admin.keyStatusActive')}</span>`}</td>
              <td>${!k.revoked ? `<button class="btn btn-sm btn-danger revoke-api-key" data-id="${k.id}"><i class="bi bi-x-circle"></i> ${t('admin.revokeKey')}</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    container.querySelectorAll('.revoke-api-key').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('admin.confirmRevokeKey'))) return;
        try {
          await apiFetch(`/api/admin/api-keys/${btn.dataset.id}`, { method: 'DELETE' });
          showAlert(t('admin.keyRevokedOk'), 'success');
          loadApiKeys();
        } catch (err) { showAlert(err.message, 'danger'); }
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

// --- Users management ---

async function loadUsers() {
  try {
    const data = await apiFetch('/api/admin/users');
    const container = document.getElementById('adminUsersList');
    if (!container) return;

    if (!data.itemListElement?.length) {
      container.innerHTML = `<p class="text-muted">${t('admin.noUsers')}</p>`;
      return;
    }

    let html = `<table class="table table-sm">
      <thead><tr><th>${t('admin.colName')}</th><th>${t('admin.colEmail')}</th><th>${t('admin.colRole')}</th><th>${t('admin.colRegistered')}</th><th>${t('admin.colActions')}</th></tr></thead><tbody>`;

    for (const el of data.itemListElement) {
      const user = el.item;
      const displayName = user.additionalProperty?.find(p => p.name === 'displayName')?.value || user.name;
      const date = user.dateCreated ? new Date(user.dateCreated).toLocaleDateString(getIntlLocale()) : '-';

      html += `<tr>
        <td>${displayName}</td>
        <td><small>${user.email}</small></td>
        <td>
          <select class="form-select form-select-sm admin-role-select" data-id="${user['@id']}" style="width:auto;display:inline;">
            <option value="lector" ${user.jobTitle === 'lector' ? 'selected' : ''}>Lector</option>
            <option value="promotor" ${user.jobTitle === 'promotor' ? 'selected' : ''}>Promotor</option>
            <option value="admin" ${user.jobTitle === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td><small>${date}</small></td>
        <td>
          <button class="btn btn-sm btn-outline-danger admin-delete-user" data-id="${user['@id']}"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind role change
    container.querySelectorAll('.admin-role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await apiFetch(`/api/admin/users/${sel.dataset.id}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: sel.value })
          });
          showAlert(t('admin.roleSavedOk'), 'success');
        } catch (err) {
          showAlert(err.message, 'danger');
          loadUsers();
        }
      });
    });

    // Bind delete user
    container.querySelectorAll('.admin-delete-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('admin.confirmDeleteUser'))) return;
        try {
          await apiFetch(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
          showAlert(t('admin.userDeletedOk'), 'success');
          loadUsers();
        } catch (err) {
          showAlert(err.message, 'danger');
        }
      });
    });
  } catch (err) {
    showAlert(t('admin.loadError', { type: t('admin.tabUsers'), error: err.message }), 'danger');
  }
}

// --- Requests management (admin side) ---

async function loadAdminRequests() {
  const filter = document.getElementById('adminRequestsFilter')?.value || '';
  try {
    const url = filter ? `/api/admin/requests?status=${filter}` : '/api/admin/requests';
    const data = await apiFetch(url);
    const container = document.getElementById('adminRequestsList');
    if (!container) return;

    const items = data.itemListElement || [];

    // Update pending badge
    if (filter === 'pending' || filter === '') {
      const pendingCount = items.filter(el =>
        el.item.actionStatus === 'https://schema.org/PotentialActionStatus'
      ).length;
      const badge = document.getElementById('pendingRequestsBadge');
      if (badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? '' : 'none';
      }
    }

    if (!items.length) {
      container.innerHTML = `<p class="text-muted">${t('admin.noRequests')}</p>`;
      return;
    }

    let html = `<table class="table table-sm">
      <thead><tr><th>${t('admin.colId')}</th><th>${t('admin.colRequestedBy')}</th><th>${t('admin.colType')}</th><th>${t('admin.colAction')}</th><th>${t('admin.colStatus')}</th><th>${t('admin.colDate')}</th><th></th></tr></thead><tbody>`;

    for (const el of items) {
      const req = el.item;
      const entityType = req.instrument?.description || '-';
      const isRoleReq = entityType === 'role';
      const actionLabel = isRoleReq
        ? `<span class="badge bg-warning text-dark">${t('admin.typeRoleRequest')}</span>`
        : req['@type'] === 'CreateAction' ? t('solicituds.actionCreate') : t('solicituds.actionEdit');
      const date = req.startTime ? new Date(req.startTime).toLocaleDateString(getIntlLocale()) : '-';
      const statusBadge = req.actionStatus === 'https://schema.org/PotentialActionStatus'
        ? `<span class="badge bg-warning">${t('solicituds.statusPending')}</span>`
        : req.actionStatus === 'https://schema.org/CompletedActionStatus'
        ? `<span class="badge bg-success">${t('solicituds.statusApproved')}</span>`
        : req.actionStatus === 'https://schema.org/FailedActionStatus'
        ? `<span class="badge bg-danger">${t('solicituds.statusRejected')}</span>`
        : '-';

      html += `<tr>
        <td><small>${req['@id']}</small></td>
        <td>${req.agent?.name || '-'}</td>
        <td>${isRoleReq ? '<i class="bi bi-person-badge"></i>' : entityType}</td>
        <td>${actionLabel}</td>
        <td>${statusBadge}</td>
        <td><small>${date}</small></td>
        <td><button class="btn btn-sm btn-bauxa-outline admin-view-request" data-id="${req['@id']}"><i class="bi bi-eye"></i></button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind view buttons
    container.querySelectorAll('.admin-view-request').forEach(btn => {
      btn.addEventListener('click', () => viewRequestDetail(btn.dataset.id));
    });
  } catch (err) {
    showAlert(t('admin.loadError', { type: t('admin.tabRequests'), error: err.message }), 'danger');
  }
}

async function viewRequestDetail(requestId) {
  try {
    const data = await apiFetch(`/api/requests/${requestId}`);
    const req = data.request;
    const detail = document.getElementById('adminRequestDetail');
    const content = document.getElementById('requestDetailContent');
    const actions = document.getElementById('requestActions');

    if (!detail || !content) return;

    const isPending = req.actionStatus === 'https://schema.org/PotentialActionStatus';
    const isRoleReq = req.instrument?.description === 'role';

    if (isRoleReq) {
      content.innerHTML = `
        <div class="mb-3">
          <span class="badge bg-warning text-dark fs-6 mb-2"><i class="bi bi-person-badge me-1"></i>${t('admin.typeRoleRequest')}</span>
          <p class="mb-1"><strong>${t('admin.colRequestedBy')}:</strong> ${req.agent?.name || '-'} <span class="text-muted small">&lt;${req.agent?.email || ''}&gt;</span></p>
        </div>
        <p><strong>${t('admin.motive')}:</strong> ${req.description || '-'}</p>
      `;
    } else {
      content.innerHTML = `
        <div class="row">
          <div class="col-md-6">
            <h6>${t('admin.currentData')}</h6>
            <pre class="p-2" style="background:var(--color-bg-alt);border-radius:8px;font-size:0.75rem;max-height:300px;overflow:auto;">${JSON.stringify(req.object, null, 2)}</pre>
          </div>
          <div class="col-md-6">
            <h6>${t('admin.proposedData')}</h6>
            <pre class="p-2" style="background:var(--color-bg-alt);border-radius:8px;font-size:0.75rem;max-height:300px;overflow:auto;">${JSON.stringify(req.result, null, 2)}</pre>
          </div>
        </div>
        <p class="mt-2"><strong>${t('admin.motive')}:</strong> ${req.description || '-'}</p>
      `;
    }

    detail.style.display = 'block';
    if (actions) actions.style.display = isPending ? 'block' : 'none';

    // Bind approve/reject
    const approveBtn = document.getElementById('approveRequestBtn');
    const rejectBtn = document.getElementById('rejectRequestBtn');
    const closeBtn = document.getElementById('closeRequestDetail');

    const cleanup = () => {
      detail.style.display = 'none';
      approveBtn?.replaceWith(approveBtn.cloneNode(true));
      rejectBtn?.replaceWith(rejectBtn.cloneNode(true));
    };

    closeBtn?.addEventListener('click', cleanup, { once: true });

    if (isPending) {
      approveBtn?.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/admin/requests/${requestId}/approve`, { method: 'PUT' });
          showAlert(isRoleReq ? t('admin.approveRoleOk') : t('admin.approvedOk'), 'success');
          cleanup();
          loadAdminRequests();
        } catch (err) {
          showAlert(err.message, 'danger');
        }
      }, { once: true });

      rejectBtn?.addEventListener('click', async () => {
        const notes = document.getElementById('adminReviewerNotes')?.value || '';
        try {
          await apiFetch(`/api/admin/requests/${requestId}/reject`, {
            method: 'PUT',
            body: JSON.stringify({ notes })
          });
          showAlert(t('admin.rejectedOk'), 'success');
          cleanup();
          loadAdminRequests();
        } catch (err) {
          showAlert(err.message, 'danger');
        }
      }, { once: true });
    }
  } catch (err) {
    showAlert(t('admin.loadError', { type: 'detall', error: err.message }), 'danger');
  }
}

// --- Quiz/Question management ---

let cachedQuestions = [];

function renderQuizTable(items) {
  if (!items.length) return `<p class="text-muted">${t('admin.noQuizzes')}</p>`;
  let html = `<table class="table table-sm"><thead><tr><th>${t('admin.colId')}</th><th>${t('admin.colName')}</th><th>${t('admin.colBadge')}</th><th>${t('admin.colSection')}</th><th>${t('admin.colQuestions')}</th><th>${t('admin.colActions')}</th></tr></thead><tbody>`;
  for (const el of items) {
    const item = el.item;
    html += `<tr>
      <td><small>${item['@id']}</small></td><td>${item.name}</td>
      <td><span class="badge-genre">${item.badge || ''}</span></td><td>${item.section || ''}</td>
      <td>${item.hasPart?.length || 0}</td>
      <td>
        <button class="btn btn-sm btn-bauxa-outline me-1 admin-edit-quiz" data-id="${item['@id']}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger admin-delete-quiz" data-id="${item['@id']}"><i class="bi bi-trash"></i></button>
      </td></tr>`;
  }
  return html + '</tbody></table>';
}

function renderQuestionTable(items) {
  if (!items.length) return `<p class="text-muted">${t('admin.noQuestions')}</p>`;
  let html = `<table class="table table-sm"><thead><tr><th>${t('admin.colId')}</th><th>${t('admin.colCategory')}</th><th>${t('admin.colType')}</th><th>${t('admin.colCorrect')}</th><th>${t('admin.colActions')}</th></tr></thead><tbody>`;
  for (const el of items) {
    const item = el.item;
    const mt = item.associatedMedia?.['@type'] || '?';
    const icon = mt === 'AudioObject' ? '🎵' : mt === 'ImageObject' ? '📸' : '🎬';
    const accepted = item.acceptedAnswer?.['@id'] || '';
    const correct = (item.suggestedAnswer || []).find(a => a['@id'] === accepted);
    html += `<tr>
      <td><small>${item['@id']}</small></td><td>${item.about?.name || ''}</td>
      <td>${icon}</td><td><small>${correct?.text || '?'}</small></td>
      <td>
        <button class="btn btn-sm btn-bauxa-outline me-1 admin-edit-question" data-id="${item['@id']}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger admin-delete-question" data-id="${item['@id']}"><i class="bi bi-trash"></i></button>
      </td></tr>`;
  }
  return html + '</tbody></table>';
}

async function loadQuizzesList() {
  try {
    const data = await apiFetch('/api/admin/questionnaires');
    document.getElementById('adminQuizzesList').innerHTML = renderQuizTable(data.itemListElement || []);
    bindQuizActions(data.itemListElement || []);
  } catch (err) { showAlert(t('admin.loadError', { type: t('admin.tabQuizzes'), error: err.message }), 'danger'); }
}

async function loadQuestionsList() {
  try {
    const data = await apiFetch('/api/admin/questions');
    cachedQuestions = data.itemListElement || [];
    document.getElementById('adminQuestionsList').innerHTML = renderQuestionTable(cachedQuestions);
    bindQuestionActions(cachedQuestions);
  } catch (err) { showAlert(t('admin.loadError', { type: t('admin.tabQuizzes'), error: err.message }), 'danger'); }
}

function bindQuizActions(items) {
  document.querySelectorAll('.admin-edit-quiz').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(el => el.item['@id'] === btn.dataset.id)?.item;
      if (item) openQuizForm(item);
    });
  });
  document.querySelectorAll('.admin-delete-quiz').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.confirmDeleteQuestionnaire'))) return;
      try {
        await apiFetch(`/api/admin/questionnaires/${btn.dataset.id}`, { method: 'DELETE' });
        showAlert(t('admin.deletedOk'), 'success'); loadQuizzesList();
      } catch (err) { showAlert(err.message, 'danger'); }
    });
  });
}

function bindQuestionActions(items) {
  document.querySelectorAll('.admin-edit-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(el => el.item['@id'] === btn.dataset.id)?.item;
      if (item) openQuestionForm(item);
    });
  });
  document.querySelectorAll('.admin-delete-question').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.confirmDeleteQuestion'))) return;
      try {
        await apiFetch(`/api/admin/questions/${btn.dataset.id}`, { method: 'DELETE' });
        showAlert(t('admin.deletedOk'), 'success'); loadQuestionsList();
      } catch (err) { showAlert(err.message, 'danger'); }
    });
  });
}

function populateQuestionCheckboxes(selectedIds = []) {
  const container = document.getElementById('quizQuestionCheckboxes');
  if (!container || !cachedQuestions.length) { if (container) container.innerHTML = `<p class="text-muted small mb-0">${t('admin.noQuestionsAvailable')}</p>`; return; }
  const sel = new Set(selectedIds);
  container.innerHTML = cachedQuestions.map(el => {
    const q = el.item;
    const mt = q.associatedMedia?.['@type'] || '';
    const icon = mt === 'AudioObject' ? '🎵' : mt === 'ImageObject' ? '📸' : '🎬';
    const accepted = q.acceptedAnswer?.['@id'] || '';
    const correct = (q.suggestedAnswer || []).find(a => a['@id'] === accepted);
    return `<div class="form-check"><input class="form-check-input" type="checkbox" value="${q['@id']}" id="qc-${q['@id']}" ${sel.has(q['@id']) ? 'checked' : ''}>
      <label class="form-check-label small" for="qc-${q['@id']}">${icon} ${q.about?.name || ''} — ${correct?.text || q['@id']}</label></div>`;
  }).join('');
}

function openQuizForm(item) {
  document.getElementById('editQuizId').value = item?.['@id'] || '';
  document.getElementById('quizName').value = item?.name || '';
  document.getElementById('quizBadge').value = item?.badge || '';
  document.getElementById('quizSection').value = item?.section || 'music';
  document.getElementById('quizColor1').value = item?.color1 || '#1B4965';
  document.getElementById('quizColor2').value = item?.color2 || '#2D6A8F';
  const enc = item?.image?.encoding || [];
  document.getElementById('quizImageJpg').value = enc.find(e => e.encodingFormat === 'image/jpeg')?.contentUrl || '';
  document.getElementById('quizImageWebp').value = enc.find(e => e.encodingFormat === 'image/webp')?.contentUrl || '';
  populateQuestionCheckboxes((item?.hasPart || []).map(r => r['@id']));
  document.getElementById('adminQuizFormTitle').textContent = item ? t('admin.formTitleEditQuiz') : t('admin.formTitleNewQuiz');
  document.getElementById('adminQuizForm').style.display = 'block';
}

function collectQuizFormData() {
  const checked = []; document.querySelectorAll('#quizQuestionCheckboxes input:checked').forEach(cb => checked.push({ '@id': cb.value }));
  const data = { '@type': 'Quiz', name: document.getElementById('quizName').value.trim(), badge: document.getElementById('quizBadge').value.trim(),
    section: document.getElementById('quizSection').value, color1: document.getElementById('quizColor1').value, color2: document.getElementById('quizColor2').value, hasPart: checked };
  const jpg = document.getElementById('quizImageJpg').value.trim(), webp = document.getElementById('quizImageWebp').value.trim();
  if (jpg || webp) { data.image = { '@type': 'ImageObject', encoding: [] }; if (webp) data.image.encoding.push({ '@type': 'ImageObject', contentUrl: webp, encodingFormat: 'image/webp' }); if (jpg) data.image.encoding.push({ '@type': 'ImageObject', contentUrl: jpg, encodingFormat: 'image/jpeg' }); }
  return data;
}

function openQuestionForm(item) {
  document.getElementById('editQuestionId').value = item?.['@id'] || '';
  document.getElementById('questionCategory').value = item?.about?.name || '';
  document.getElementById('questionText').value = item?.text || '';
  const mt = item?.associatedMedia?.['@type'] || 'AudioObject';
  const map = { AudioObject: 'audio', ImageObject: 'image', VideoObject: 'video' };
  document.getElementById('questionMediaType').value = map[mt] || 'audio';
  if (mt === 'AudioObject') {
    document.getElementById('questionMediaUrl').value = item?.associatedMedia?.contentUrl || '';
    document.getElementById('questionMediaUrl2Group').style.display = 'none';
  } else {
    const enc = item?.associatedMedia?.encoding || [];
    document.getElementById('questionMediaUrl').value = enc.find(e => e.encodingFormat?.includes('jpeg') || e.encodingFormat?.includes('mp4'))?.contentUrl || '';
    document.getElementById('questionMediaUrl2').value = enc.find(e => e.encodingFormat?.includes('webp') || e.encodingFormat?.includes('webm'))?.contentUrl || '';
    document.getElementById('questionMediaUrl2Group').style.display = '';
  }
  const answers = [...(item?.suggestedAnswer || [])].sort((a, b) => a.position - b.position);
  for (let i = 0; i < 4; i++) document.getElementById(`questionOption${i}`).value = answers[i]?.text || '';
  const correctIdx = answers.findIndex(a => a['@id'] === item?.acceptedAnswer?.['@id']);
  document.getElementById('questionCorrect').value = correctIdx >= 0 ? correctIdx : 0;
  document.getElementById('adminQuestionFormTitle').textContent = item ? t('admin.formTitleEditQuestion') : t('admin.formTitleNewQuestion');
  document.getElementById('adminQuestionForm').style.display = 'block';
  document.getElementById('questionMediaUrl2Group').style.display = document.getElementById('questionMediaType').value !== 'audio' ? '' : 'none';
}

function collectQuestionFormData() {
  const type = document.getElementById('questionMediaType').value;
  const url1 = document.getElementById('questionMediaUrl').value.trim();
  const url2 = document.getElementById('questionMediaUrl2').value.trim();
  let associatedMedia;
  if (type === 'audio') { associatedMedia = { '@type': 'AudioObject', contentUrl: url1, encodingFormat: url1.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' }; }
  else if (type === 'image') { associatedMedia = { '@type': 'ImageObject', encoding: [] }; if (url2) associatedMedia.encoding.push({ '@type': 'ImageObject', contentUrl: url2, encodingFormat: 'image/webp' }); if (url1) associatedMedia.encoding.push({ '@type': 'ImageObject', contentUrl: url1, encodingFormat: 'image/jpeg' }); }
  else { associatedMedia = { '@type': 'VideoObject', encoding: [] }; if (url2) associatedMedia.encoding.push({ '@type': 'VideoObject', contentUrl: url2, encodingFormat: 'video/webm' }); if (url1) associatedMedia.encoding.push({ '@type': 'VideoObject', contentUrl: url1, encodingFormat: 'video/mp4' }); }
  const options = [];
  for (let i = 0; i < 4; i++) { const aid = `ans-${Date.now()}-${i}`; options.push({ '@type': 'Answer', '@id': aid, position: i, text: document.getElementById(`questionOption${i}`).value.trim() }); }
  const ci = parseInt(document.getElementById('questionCorrect').value, 10);
  return { '@type': 'Question', about: { '@type': 'DefinedTerm', name: document.getElementById('questionCategory').value.trim() },
    text: document.getElementById('questionText').value.trim(), associatedMedia, suggestedAnswer: options, acceptedAnswer: { '@id': options[ci]['@id'] } };
}

// --- Init Admin ---

export async function initAdmin() {
  await checkAuth();

  const notAuth = document.getElementById('adminNotAuth');
  const content = document.getElementById('adminContent');

  if (!authState?.authenticated || authState?.profile?.role !== 'admin') {
    if (notAuth) notAuth.style.display = 'block';
    if (content) content.style.display = 'none';
    return;
  }

  if (notAuth) notAuth.style.display = 'none';
  if (content) content.style.display = 'block';

  initDownloadAgenda();
  initInstagramAnalyzer();

  // Load content lists
  loadContentList('artists', 'adminArtistsList');
  loadContentList('events', 'adminEventsList');
  loadContentList('news', 'adminNewsList');
  loadAdminRequests();
  loadUsers();

  // --- Artist form bindings ---
  document.getElementById('adminNewArtist')?.addEventListener('click', () => {
    document.getElementById('addArtistForm')?.reset();
    document.getElementById('editArtistId').value = '';
    document.getElementById('adminArtistFormTitle').textContent = t('admin.formTitleNewArtist');
    document.getElementById('adminArtistForm').style.display = 'block';
  });

  document.getElementById('cancelArtistForm')?.addEventListener('click', () => {
    document.getElementById('adminArtistForm').style.display = 'none';
  });

  document.getElementById('addAlbumRow')?.addEventListener('click', () => {
    const container = document.getElementById('albumsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'row g-2 mb-2 album-row';
    row.innerHTML = `
      <div class="col-7"><input type="text" class="form-control form-control-bauxa form-control-sm album-name" placeholder="Nom de l'album"></div>
      <div class="col-3"><input type="text" class="form-control form-control-bauxa form-control-sm album-year" placeholder="Any" pattern="[0-9]{4}" maxlength="4"></div>
      <div class="col-2"><button type="button" class="btn btn-sm btn-bauxa-outline w-100 remove-album"><i class="bi bi-x"></i></button></div>`;
    container.appendChild(row);
    row.querySelector('.remove-album')?.addEventListener('click', () => row.remove());
  });

  document.getElementById('addArtistForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editArtistId').value;
    const data = collectArtistFormData();
    try {
      if (editId) { await apiFetch(`/api/admin/artists/${editId}`, { method: 'PUT', body: JSON.stringify(data) }); showAlert(t('admin.artistUpdatedOk'), 'success'); }
      else { await apiFetch('/api/admin/artists', { method: 'POST', body: JSON.stringify(data) }); showAlert(t('admin.artistCreatedOk'), 'success'); }
      document.getElementById('adminArtistForm').style.display = 'none';
      loadContentList('artists', 'adminArtistsList');
    } catch (err) { showAlert(err.message, 'danger'); }
  });

  // --- Event form bindings ---
  document.getElementById('adminNewEvent')?.addEventListener('click', () => {
    document.getElementById('addEventForm')?.reset();
    document.getElementById('editEventId').value = '';
    document.getElementById('adminEventFormTitle').textContent = t('admin.formTitleNewEvent');
    document.getElementById('adminEventForm').style.display = 'block';
  });

  document.getElementById('cancelEventForm')?.addEventListener('click', () => {
    document.getElementById('adminEventForm').style.display = 'none';
  });

  document.getElementById('addEventForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editEventId').value;
    const data = collectEventFormData();
    try {
      if (editId) { await apiFetch(`/api/admin/events/${editId}`, { method: 'PUT', body: JSON.stringify(data) }); showAlert(t('admin.eventUpdatedOk'), 'success'); }
      else { await apiFetch('/api/admin/events', { method: 'POST', body: JSON.stringify(data) }); showAlert(t('admin.eventCreatedOk'), 'success'); }
      document.getElementById('adminEventForm').style.display = 'none';
      loadContentList('events', 'adminEventsList');
    } catch (err) { showAlert(err.message, 'danger'); }
  });

  // --- News form bindings ---
  document.getElementById('adminNewNews')?.addEventListener('click', () => {
    document.getElementById('addNewsForm')?.reset();
    document.getElementById('editNewsId').value = '';
    document.getElementById('adminNewsFormTitle').textContent = t('admin.formTitleNewNews');
    document.getElementById('adminNewsForm').style.display = 'block';
  });

  document.getElementById('cancelNewsForm')?.addEventListener('click', () => {
    document.getElementById('adminNewsForm').style.display = 'none';
  });

  document.getElementById('addNewsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editNewsId').value;
    const data = collectNewsFormData();
    try {
      if (editId) { await apiFetch(`/api/admin/news/${editId}`, { method: 'PUT', body: JSON.stringify(data) }); showAlert(t('admin.newsUpdatedOk'), 'success'); }
      else { await apiFetch('/api/admin/news', { method: 'POST', body: JSON.stringify(data) }); showAlert(t('admin.newsCreatedOk'), 'success'); }
      document.getElementById('adminNewsForm').style.display = 'none';
      loadContentList('news', 'adminNewsList');
    } catch (err) { showAlert(err.message, 'danger'); }
  });

  // --- Quiz form bindings ---
  document.getElementById('adminNewQuiz')?.addEventListener('click', () => {
    document.getElementById('addQuizForm')?.reset();
    openQuizForm(null);
  });

  document.getElementById('cancelQuizForm')?.addEventListener('click', () => {
    document.getElementById('adminQuizForm').style.display = 'none';
  });

  document.getElementById('addQuizForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editQuizId').value;
    const data = collectQuizFormData();
    try {
      if (editId) { await apiFetch(`/api/admin/questionnaires/${editId}`, { method: 'PUT', body: JSON.stringify(data) }); showAlert(t('admin.quizUpdatedOk'), 'success'); }
      else { await apiFetch('/api/admin/questionnaires', { method: 'POST', body: JSON.stringify(data) }); showAlert(t('admin.quizCreatedOk'), 'success'); }
      document.getElementById('adminQuizForm').style.display = 'none';
      loadQuizzesList();
    } catch (err) { showAlert(err.message, 'danger'); }
  });

  // --- Question form bindings ---
  document.getElementById('adminNewQuestion')?.addEventListener('click', () => {
    document.getElementById('addQuestionForm')?.reset();
    openQuestionForm(null);
  });

  document.getElementById('cancelQuestionForm')?.addEventListener('click', () => {
    document.getElementById('adminQuestionForm').style.display = 'none';
  });

  document.getElementById('questionMediaType')?.addEventListener('change', () => {
    document.getElementById('questionMediaUrl2Group').style.display = document.getElementById('questionMediaType').value !== 'audio' ? '' : 'none';
  });

  document.getElementById('addQuestionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editQuestionId').value;
    const data = collectQuestionFormData();
    try {
      if (editId) { await apiFetch(`/api/admin/questions/${editId}`, { method: 'PUT', body: JSON.stringify(data) }); showAlert(t('admin.questionUpdatedOk'), 'success'); }
      else { await apiFetch('/api/admin/questions', { method: 'POST', body: JSON.stringify(data) }); showAlert(t('admin.questionCreatedOk'), 'success'); }
      document.getElementById('adminQuestionForm').style.display = 'none';
      loadQuestionsList();
    } catch (err) { showAlert(err.message, 'danger'); }
  });

  // --- Requests filter ---
  document.getElementById('adminRequestsFilter')?.addEventListener('change', () => {
    loadAdminRequests();
  });

  // --- API Keys bindings ---
  document.getElementById('adminNewApiKey')?.addEventListener('click', () => {
    document.getElementById('addApiKeyForm')?.reset();
    document.getElementById('adminApiKeyForm').style.display = 'block';
  });

  document.getElementById('cancelApiKeyForm')?.addEventListener('click', () => {
    document.getElementById('adminApiKeyForm').style.display = 'none';
  });

  document.getElementById('addApiKeyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name        = document.getElementById('apiKeyName').value.trim();
    const agent_name  = document.getElementById('apiKeyAgentName').value.trim();
    const agent_email = document.getElementById('apiKeyAgentEmail').value.trim();
    try {
      const res = await apiFetch('/api/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, agent_name, agent_email }),
      });
      document.getElementById('adminApiKeyForm').style.display = 'none';
      document.getElementById('addApiKeyForm').reset();
      document.getElementById('apiKeyRevealValue').value = res.key;
      new bootstrap.Modal(document.getElementById('apiKeyRevealModal')).show();
      loadApiKeys();
    } catch (err) { showAlert(err.message, 'danger'); }
  });

  document.getElementById('copyApiKey')?.addEventListener('click', () => {
    const val = document.getElementById('apiKeyRevealValue').value;
    navigator.clipboard.writeText(val).then(() => showAlert(t('admin.keyCopiedOk'), 'success'));
  });

  // --- Tab change listeners to reload data ---
  document.getElementById('tab-requests')?.addEventListener('shown.bs.tab', loadAdminRequests);
  document.getElementById('tab-users')?.addEventListener('shown.bs.tab', loadUsers);
  document.getElementById('tab-quizzes')?.addEventListener('shown.bs.tab', () => {
    loadQuestionsList().then(() => loadQuizzesList());
  });
  document.getElementById('tab-api-keys')?.addEventListener('shown.bs.tab', loadApiKeys);
}

const ANALYZE_API = '/api/analyze-instagram';

function initInstagramAnalyzer() {
  let pastedImageBase64 = null;
  let pastedImageMime = null;

  const pasteZone   = document.getElementById('instagramPasteZone');
  const preview     = document.getElementById('instagramPastePreview');
  const hint        = document.getElementById('instagramPasteHint');
  const btnAnalyze  = document.getElementById('btnAnalitzarPost');
  const btnClear    = document.getElementById('btnClearPaste');

  if (!pasteZone) return;

  // Canvi de mode caption
  document.getElementById('captionMode')?.addEventListener('change', (e) => {
    const isManual = e.target.value === 'manual';
    document.getElementById('captionInstagramInput').style.display = isManual ? 'none' : '';
    document.getElementById('captionManualInput').style.display   = isManual ? '' : 'none';
  });

  function setImage(file) {
    pastedImageMime = file.type;
    const reader = new FileReader();
    reader.onload = (e) => {
      pastedImageBase64 = e.target.result.split(',')[1];
      preview.src = e.target.result;
      preview.style.display = 'block';
      hint.style.display = 'none';
      btnAnalyze.disabled = false;
      btnClear.style.display = 'inline';
    };
    reader.readAsDataURL(file);
  }

  // Enganxar amb Ctrl+V sobre la zona o sobre el document quan el panell és visible
  document.addEventListener('paste', (e) => {
    const adminView = document.querySelector('[data-view="admin"]');
    if (!adminView || adminView.style.display === 'none') return;
    const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (item) setImage(item.getAsFile());
  });

  // Esborrar imatge
  btnClear?.addEventListener('click', () => {
    pastedImageBase64 = null;
    pastedImageMime = null;
    preview.src = '';
    preview.style.display = 'none';
    hint.style.display = '';
    btnAnalyze.disabled = true;
    btnClear.style.display = 'none';
  });

  // Analitzar
  btnAnalyze?.addEventListener('click', async () => {
    if (!pastedImageBase64) return showAlert(t('admin.instagramPasteFirst'), 'warning');

    const mode         = document.getElementById('captionMode')?.value;
    const instagramUrl = document.getElementById('instagramUrlInput')?.value.trim();
    const manualCaption = document.getElementById('manualCaptionText')?.value.trim();

    if (mode === 'instagram' && !instagramUrl) return showAlert(t('admin.instagramNeedUrl'), 'warning');
    if (mode === 'manual'    && !manualCaption) return showAlert(t('admin.instagramNeedCaption'), 'warning');

    const modalBody = document.getElementById('instagramAnalyzeBody');
    const modal = new bootstrap.Modal(document.getElementById('instagramAnalyzeModal'));

    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${t('admin.instagramAnalyzing')}`;
    modalBody.innerHTML = `<div class="text-center py-4"><span class="spinner-border"></span><p class="mt-2 text-muted">${t('admin.instagramAnalyzingBody')}</p></div>`;
    modal.show();

    const payload = {
      imageBase64:   pastedImageBase64,
      imageMimeType: pastedImageMime,
      ...(mode === 'instagram' ? { instagramUrl } : { caption: manualCaption }),
    };

    try {
      await apiFetch(ANALYZE_API, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      modalBody.innerHTML = `<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> ${t('admin.instagramSentOk')}</div>`;
    } catch (err) {
      modalBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    } finally {
      btnAnalyze.disabled = false;
      btnAnalyze.innerHTML = `<i class="bi bi-search"></i> ${t('admin.instagramAnalyze')}`;
    }
  });
}
