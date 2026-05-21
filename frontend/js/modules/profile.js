/**
 * @module profile
 * @description Handles the user profile view.
 */

import { getAuthState } from './admin.js';
import { apiFetch } from '../config.js';
import { t } from '../i18n.js';

function showProfileAlert(message, type) {
  const el = document.getElementById('profileAlert');
  if (!el) return;
  el.className = `alert alert-${type} mb-4`;
  el.textContent = message;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

export async function initProfile() {
  const auth = getAuthState();
  const notAuth = document.getElementById('profileNotAuth');
  const content = document.getElementById('profileContent');

  if (!auth?.authenticated) {
    if (notAuth) notAuth.style.display = 'block';
    if (content) content.style.display = 'none';
    return;
  }

  if (notAuth) notAuth.style.display = 'none';
  if (content) content.style.display = 'block';

  // Load profile data
  try {
    const data = await apiFetch('/api/profile');
    const profile = data.profile;

    document.getElementById('profileAvatar').src = profile.image || '';
    document.getElementById('profileName').textContent = profile.name || '';
    document.getElementById('profileEmail').value = profile.email || '';
    document.getElementById('profileRole').textContent = profile.jobTitle || 'lector';

    const displayName = profile.additionalProperty?.find(p => p.name === 'displayName')?.value || profile.name;
    document.getElementById('profileDisplayName').value = displayName || '';
    document.getElementById('profileBio').value = profile.description || '';

    // Role badge color
    const roleBadge = document.getElementById('profileRole');
    if (roleBadge) {
      roleBadge.className = 'badge';
      if (profile.jobTitle === 'admin') roleBadge.classList.add('bg-danger');
      else if (profile.jobTitle === 'promotor') roleBadge.classList.add('bg-primary');
      else roleBadge.classList.add('bg-secondary');
    }
  } catch {
    showProfileAlert(t('profile.loadError'), 'danger');
  }

  // Form submit
  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('profileDisplayName').value.trim();
    const description = document.getElementById('profileBio').value.trim();

    try {
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ displayName, description })
      });
      showProfileAlert(t('profile.savedOk'), 'success');
    } catch (err) {
      showProfileAlert(err.message, 'danger');
    }
  });
}
