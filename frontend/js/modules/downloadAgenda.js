import { loadEvents, loadExternEvents } from './dataLoader.js';

const API_URL = 'https://html-to-image-api-self.vercel.app/api/generate';

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function formatDayLabel(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('ca-ES', { day: 'numeric', month: 'long' });
}

function filterEventsByDate(events, dateStr) {
  return events.filter(e => e.startDate && e.startDate.startsWith(dateStr));
}

function buildPayload(events, dayLabel) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': dayLabel,
    'itemListElement': events.map((e, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'item': {
        '@type': e['@type'] || 'MusicEvent',
        'name': e.name,
        'zone': e.zone || 'Mallorca',
        'startDate': e.startDate,
        'category': e.category || ''
      }
    }))
  };
}

function setModalBody(html) {
  const body = document.getElementById('agendaModalBody');
  if (body) body.innerHTML = html;
}

function setFooterVisible(visible) {
  const footer = document.getElementById('agendaModalFooter');
  if (footer) footer.classList.toggle('d-none', !visible);
}

async function callApi(payload) {
  document.activeElement?.blur();
  const modalEl = document.getElementById('agendaModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  setFooterVisible(false);
  setModalBody('<div class="py-4"><div class="spinner-border text-secondary" role="status" aria-label="Generant..."></div><p class="mt-3 text-muted">Generant imatge...</p></div>');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Error ${response.status}: ${text || response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  setModalBody(`<img src="${url}" class="img-fluid rounded" alt="Cartell de l'agenda">`);

  const downloadBtn = document.getElementById('agendaDownloadBtn');
  if (downloadBtn) {
    downloadBtn.href = url;
    downloadBtn.download = `agenda-${payload.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
  }
  setFooterVisible(true);
}

export function initDownloadAgenda() {
  const btn = document.getElementById('btnGenerarCartell');
  const regenBtn = document.getElementById('agendaRegenerateBtn');
  if (!btn) return;

  // Fix aria-hidden warning: blur focus when modal hides
  const modalEl = document.getElementById('agendaModal');
  modalEl?.addEventListener('hide.bs.modal', () => { document.activeElement?.blur(); });

  let lastPayload = null;

  async function generate() {
    const dateInput = document.getElementById('agendaDate');
    const dateStr = dateInput?.value || toDateStr(new Date());

    let events = [];
    try {
      const [internal, external] = await Promise.all([loadEvents(), loadExternEvents()]);
      events = [...internal, ...external];
    } catch {
      events = [];
    }

    const dayEvents = filterEventsByDate(events, dateStr);

    if (!dayEvents.length) {
      document.activeElement?.blur();
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
      setFooterVisible(false);
      setModalBody(`<div class="py-4 text-muted"><i class="bi bi-calendar-x fs-1"></i><p class="mt-3">No hi ha events per al dia <strong>${formatDayLabel(dateStr)}</strong>.</p></div>`);
      return;
    }

    const dayLabel = formatDayLabel(dateStr);
    lastPayload = buildPayload(dayEvents, dayLabel);

    try {
      await callApi(lastPayload);
    } catch (err) {
      setFooterVisible(false);
      setModalBody(`<div class="py-4 text-danger"><i class="bi bi-exclamation-triangle fs-1"></i><p class="mt-3">Error en generar el cartell:<br><small>${err.message}</small></p></div>`);
    }
  }

  btn.addEventListener('click', generate);

  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      if (!lastPayload) return;
      try {
        await callApi(lastPayload);
      } catch (err) {
        setFooterVisible(false);
        setModalBody(`<div class="py-4 text-danger"><i class="bi bi-exclamation-triangle fs-1"></i><p class="mt-3">Error en regenerar:<br><small>${err.message}</small></p></div>`);
      }
    });
  }

  const dateInput = document.getElementById('agendaDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = toDateStr(new Date());
  }
}
