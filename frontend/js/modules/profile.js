/**
 * @module profile
 * @description Handles the user profile view.
 */

import { getAuthState } from './admin.js';
import { apiFetch } from '../config.js';
import { t } from '../i18n.js';
import {
  pushSupported,
  getPushPermission,
  getPushSubscription,
  subscribePush,
  unsubscribePush,
} from '../pwa.js';

function showProfileAlert(message, type) {
  const el = document.getElementById('profileAlert');
  if (!el) return;
  el.className = `alert alert-${type} mb-4`;
  el.textContent = message;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function showPromotorAlert(message, type) {
  const el = document.getElementById('promotorRequestAlert');
  if (!el) return;
  el.className = `alert alert-${type} mb-3`;
  el.textContent = message;
  el.style.display = 'block';
}

function showNotifAlert(message, type) {
  const el = document.getElementById('notifAlert');
  if (!el) return;
  el.className = `alert alert-${type} mb-3`;
  el.textContent = message;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/**
 * Hide the notifications card on unsupported browsers; otherwise reflect the
 * current subscription state in the toggle and wire change handler.
 *
 * Permission states this card has to handle:
 *   - 'default':  show toggle off; toggling on triggers the OS prompt.
 *   - 'granted' + has subscription: toggle on.
 *   - 'granted' + no subscription:  toggle off (user revoked at app level).
 *   - 'denied':                     disable the toggle, tell the user to fix
 *                                   it in browser settings — we can't re-prompt
 *                                   once they've said no.
 */
async function initNotificationToggle() {
  const row    = document.getElementById('notifPrefsRow');
  const toggle = document.getElementById('notifToggle');
  const status = document.getElementById('notifStatus');
  if (!row || !toggle) return;

  if (!pushSupported()) {
    // Card stays hidden — nothing actionable to show.
    return;
  }
  row.style.display = '';

  async function refreshState() {
    const permission = getPushPermission();
    const sub        = await getPushSubscription();
    const on         = permission === 'granted' && !!sub;

    toggle.checked  = on;
    toggle.disabled = permission === 'denied';

    if (status) {
      if (permission === 'denied')      status.textContent = t('profile.notifBlocked');
      else if (on)                      status.textContent = t('profile.notifOn');
      else                              status.textContent = t('profile.notifOff');
    }
  }

  await refreshState();

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      if (toggle.checked) {
        await subscribePush();
        showNotifAlert(t('profile.notifEnabled'), 'success');
      } else {
        await unsubscribePush();
        showNotifAlert(t('profile.notifDisabled'), 'info');
      }
    } catch (err) {
      console.error('[profile] notification toggle failed:', err);
      // Revert the visual state — the actual subscription didn't change.
      toggle.checked = !toggle.checked;
      const code = err?.message || '';
      let msg;
      if (code === 'PERMISSION_DENIED') msg = t('profile.notifPermissionDenied');
      else                              msg = t('profile.notifError') + ' (' + (code || 'unknown') + ')';
      showNotifAlert(msg, 'danger');
    } finally {
      await refreshState(); // refresh recomputes disabled state
    }
  });
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
    const inlineEmail = document.getElementById('profileEmailInline');
    if (inlineEmail) inlineEmail.textContent = profile.email || '';
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

    // Show promotor request card only for lectors; expand main card when hidden
    const promotorCard = document.getElementById('promotorRequestCard');
    const mainCol = document.getElementById('profileMainCol');
    if (promotorCard) {
      const role = profile.jobTitle || 'lector';
      if (role === 'lector') {
        promotorCard.style.display = 'block';
        if (mainCol) mainCol.className = 'col-12 col-lg-6';
        // Check for existing role request via normal list endpoint
        try {
          const reqData = await apiFetch('/api/requests');
          const requests = (reqData?.itemListElement || []).map(el => el.item);
          const roleReq = requests.find(r => r.instrument?.description === 'role');
          if (roleReq?.actionStatus === 'https://schema.org/PotentialActionStatus') {
            document.getElementById('promotorRequestForm').style.display = 'none';
            showPromotorAlert(t('profile.requestPromotorPending'), 'info');
          }
        } catch { /* silent — show form by default */ }
      } else {
        if (mainCol) mainCol.className = 'col-12 col-lg-8';
      }
    }
  } catch {
    showProfileAlert(t('profile.loadError'), 'danger');
  }

  // Promotor request form submit
  document.getElementById('promotorRequestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const motivation = document.getElementById('promotorMotivation').value.trim();
    if (!motivation) {
      showPromotorAlert(t('profile.requestPromotorErrorMotiv'), 'danger');
      return;
    }
    try {
      await apiFetch('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'role',
          action: 'create',
          proposedData: { role: 'promotor' },
          description: motivation
        })
      });
      document.getElementById('promotorRequestForm').style.display = 'none';
      showPromotorAlert(t('profile.requestPromotorSent'), 'success');
    } catch (err) {
      showPromotorAlert(err.message, 'danger');
    }
  });

  initNotificationToggle();

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
