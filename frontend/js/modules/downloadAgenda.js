import { loadEvents, loadExternEvents } from './dataLoader.js';

const API_URL = 'https://html-to-image-api-self.vercel.app/api/generate';

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function filterEventsByDate(events, dateFrom, dateTo) {
  if (!dateTo || dateTo === dateFrom) {
    return events.filter(e => e.startDate && e.startDate.startsWith(dateFrom));
  }
  return events.filter(e => e.startDate && e.startDate.slice(0, 10) >= dateFrom && e.startDate.slice(0, 10) <= dateTo);
}

function buildPayload(events) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
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

function setDownloadBtnVisible(visible) {
  const btn = document.getElementById('agendaDownloadBtn');
  if (btn) btn.classList.toggle('d-none', !visible);
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

  const { count, images } = await response.json();
  const baseName = (payload._filename || 'agenda').replace(/\.png$/, '');

  if (count === 1) {
    setModalBody(`<img src="${images[0]}" class="img-fluid rounded" alt="Cartell de l'agenda">`);
    const downloadBtn = document.getElementById('agendaDownloadBtn');
    if (downloadBtn) {
      downloadBtn.href = images[0];
      downloadBtn.download = payload._filename;
    }
    setDownloadBtnVisible(true);
  } else {
    const html = images.map((src, i) => `
      <div class="mb-4">
        <p class="text-muted small mb-1">Part ${i + 1} de ${count}</p>
        <img src="${src}" class="img-fluid rounded" alt="Cartell ${i + 1} de ${count}">
        <div class="mt-2 text-center">
          <a href="${src}" download="${baseName}-${i + 1}.png" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-download"></i> Descarregar part ${i + 1}
          </a>
        </div>
      </div>
    `).join('');
    setModalBody(html);
    setDownloadBtnVisible(false);
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
    const dateFrom = document.getElementById('agendaDateFrom')?.value || toDateStr(new Date());
    let dateTo = document.getElementById('agendaDateTo')?.value || '';
    if (dateTo && dateTo < dateFrom) dateTo = dateFrom;

    let events = [];
    try {
      const [internal, external] = await Promise.all([loadEvents(), loadExternEvents()]);
      events = [...internal, ...external];
    } catch {
      events = [];
    }

    const dayEvents = filterEventsByDate(events, dateFrom, dateTo);

    if (!dayEvents.length) {
      document.activeElement?.blur();
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
      setFooterVisible(false);
      setModalBody(`<div class="py-4 text-muted"><i class="bi bi-calendar-x fs-1"></i><p class="mt-3">No hi ha events per al rang de dates seleccionat.</p></div>`);
      return;
    }

    const effectiveDateTo = dateTo || dateFrom;
    const filename = effectiveDateTo === dateFrom
      ? `agenda-${dateFrom}.png`
      : `agenda-${dateFrom}_${effectiveDateTo}.png`;

    lastPayload = buildPayload(dayEvents);
    lastPayload._filename = filename;

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

  const dateFromInput = document.getElementById('agendaDateFrom');
  if (dateFromInput && !dateFromInput.value) {
    dateFromInput.value = toDateStr(new Date());
  }
}
