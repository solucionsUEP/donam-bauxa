/**
 * @module chatbot
 * @description Dona'm Bauxa chatbot. Runs against a server-side LLM
 * (Ollama, proxied through `POST /api/chat`) — the model lives on the
 * host machine and is reachable from any device on the same network
 * (e.g. Tailscale). The browser handles UI, RAG context building, and
 * intent classification; the server holds the system prompt and streams
 * NDJSON chunks back.
 *
 * Public surface:
 *   - initChatbot()           Mount the UI and prepare runtime state.
 *   - sendMessage(text)       Programmatic send.
 *   - setDataContext({...})   Inject the loaded catalog for RAG.
 *   - classifyIntent(text)    Lightweight intent label (for logs / tests).
 *   - diagnose()              Server / model availability snapshot.
 */

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

/** @type {Array<{role: 'user'|'assistant', content: string}>} */
const history = [];

/** @type {boolean} */
let generating = false;

/** @type {AbortController|null} */
let currentAbort = null;

/** @type {{events: Array<Object>, artists: Array<Object>}} */
let dataCtx = { events: [], artists: [] };

/**
 * Lets the host SPA hand the chatbot a live view of the loaded catalog.
 * @param {{events: Array<Object>, artists: Array<Object>}} payload
 */
export function setDataContext({ events, artists }) {
  dataCtx = { events: events || [], artists: artists || [] };
  console.log(`[chatbot] data context updated: ${dataCtx.events.length} events, ${dataCtx.artists.length} artists`);
}

/* ------------------------------------------------------------------ */
/*  Retrieval (RAG-style filter)                                       */
/* ------------------------------------------------------------------ */

const DAY_NAMES = {
  dilluns: 1, dimarts: 2, dimecres: 3, dijous: 4, divendres: 5, dissabte: 6, diumenge: 0,
  lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 0,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
};

const KNOWN_GENRES = [
  'pop', 'rock', 'indie', 'folk', 'jazz', 'electronic', 'electronica', 'electrònica',
  'reggae', 'hip hop', 'rap', 'flamenc', 'flamenco', 'classica', 'clàssica', 'clasica',
  'tradicional', 'punk', 'metal', 'blues', 'soul', 'funk',
];

const KNOWN_ZONES = [
  'palma', 'soller', 'sóller', 'manacor', 'inca', 'llucmajor', 'alcudia', 'alcúdia',
  'pollença', 'pollensa', 'arta', 'artà', 'tramuntana', 'pla de mallorca', 'llevant', 'migjorn',
];

function eventDate(e) { const d = e?.startDate || e?.date || null; return d ? new Date(d) : null; }
function eventVenue(e) { return e?.location?.name || e?.venue || ''; }
function eventGenres(e) {
  if (Array.isArray(e?.genre)) return e.genre;
  if (typeof e?.genre === 'string') return [e.genre];
  return [];
}
function artistGenres(a) {
  if (Array.isArray(a?.genre)) return a.genre;
  if (typeof a?.genre === 'string') return [a.genre];
  return [];
}
function artistZone(a) {
  return a?.foundingLocation?.name || a?.foundingLocation?.address?.addressLocality || a?.zone || '';
}

function extractFilters(query) {
  const q = query.toLowerCase();
  const filters = { day: null, genre: null, zone: null, artistMention: null };
  for (const [name, idx] of Object.entries(DAY_NAMES)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(q)) { filters.day = idx; break; }
  }
  filters.genre = KNOWN_GENRES.find(g => q.includes(g)) || null;
  filters.zone = KNOWN_ZONES.find(z => q.includes(z)) || null;
  for (const a of dataCtx.artists) {
    if (a?.name && q.includes(a.name.toLowerCase())) { filters.artistMention = a; break; }
  }
  return filters;
}

function selectEvents(filters, intent) {
  const now = Date.now();
  const score = (e) => {
    const d = eventDate(e);
    if (!d) return Infinity;
    const diff = d.getTime() - now;
    return diff >= 0 ? diff : (-diff) + 365 * 86400000;
  };
  let events = dataCtx.events.filter(e => eventDate(e)).sort((a, b) => score(a) - score(b));
  if (filters.day !== null) events = events.filter(e => eventDate(e).getDay() === filters.day);
  if (filters.genre) events = events.filter(e => eventGenres(e).some(g => g.toLowerCase().includes(filters.genre)));
  if (filters.zone) events = events.filter(e => (e.zone || '').toLowerCase().includes(filters.zone));
  if (filters.artistMention?.name) {
    const an = filters.artistMention.name.toLowerCase();
    events = events.filter(e => (e?.performer?.name || '').toLowerCase().includes(an));
  }
  return events.slice(0, intent === 'weekend' ? 12 : 6);
}

function selectArtists(filters, intent) {
  if (intent !== 'music' && !filters.artistMention) return [];
  let artists = dataCtx.artists.slice();
  if (filters.artistMention) {
    const seedGenres = artistGenres(filters.artistMention).map(g => g.toLowerCase());
    artists = artists.filter(a => a !== filters.artistMention && artistGenres(a).some(g => seedGenres.includes(g.toLowerCase())));
  } else if (filters.genre) {
    artists = artists.filter(a => artistGenres(a).some(g => g.toLowerCase().includes(filters.genre)));
  } else {
    artists = artists.filter(a => a.featured);
  }
  return artists.slice(0, 8);
}

function formatEventLine(e) {
  const d = eventDate(e);
  const date = d ? d.toISOString().slice(0, 10) : '';
  const venue = eventVenue(e);
  const zone = e.zone || '';
  const genres = eventGenres(e).join('/');
  const performer = e?.performer?.name || '';
  return `- ${e.name} | ${date} | ${venue}${zone ? ' (' + zone + ')' : ''} | ${genres}${performer && performer !== e.name ? ' | ' + performer : ''}`;
}

function formatArtistLine(a) {
  const genres = artistGenres(a).join('/');
  const zone = artistZone(a);
  return `- ${a.name} | ${genres}${zone ? ' | ' + zone : ''}`;
}

function buildRetrievalContext(query, intent) {
  if (!dataCtx.events.length && !dataCtx.artists.length) return '';
  const filters = extractFilters(query);
  const events = selectEvents(filters, intent);
  const artists = selectArtists(filters, intent);
  if (!events.length && !artists.length) return '';
  const sections = ["CONTEXT (dades reals de Dona'm Bauxa — utilitza-les en la resposta):"];
  if (events.length) {
    sections.push('\nEsdeveniments rellevants:');
    sections.push(events.map(formatEventLine).join('\n'));
  }
  if (artists.length) {
    sections.push('\nArtistes rellevants:');
    sections.push(artists.map(formatArtistLine).join('\n'));
  }
  return sections.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Server-side LLM transport                                          */
/* ------------------------------------------------------------------ */

const CHAT_ENDPOINT = '/api/chat';
const HEALTH_ENDPOINT = '/api/chat/health';

export async function diagnose() {
  try {
    const r = await fetch(HEALTH_ENDPOINT, { signal: AbortSignal.timeout(3000) });
    const json = await r.json();
    console.log('[chatbot] server health:', json);
    return json;
  } catch (err) {
    const info = { ok: false, error: err.message };
    console.warn('[chatbot] health check failed:', info);
    return info;
  }
}

/**
 * Streams an assistant reply by reading NDJSON from POST /api/chat.
 * Each line is `{message: {content: "..."}, done: false}` or `{done: true}`.
 * Yields delta strings.
 */
async function* streamChat(messages, signal) {
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.error) throw new Error(obj.error);
      const piece = obj?.message?.content || obj?.response || '';
      if (piece) yield piece;
      if (obj.done) return;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Intent classifier (logging / tests only)                           */
/* ------------------------------------------------------------------ */

export function classifyIntent(text) {
  const t = text.toLowerCase();
  const dayHit = /\b(dissabte|diumenge|divendres|saturday|sunday|friday|sabado|domingo|viernes)\b/.test(t);
  const planHit = /\b(pla|plan|itinerari|itinerario|cap de setmana|weekend|fin de semana)\b/.test(t);
  if (dayHit && (planHit || /\b(fer|hacer|do|que faig|que hago)\b/.test(t))) return 'weekend';
  if (planHit) return 'weekend';
  const musicHit = /\b(m[uú]sic\w*|can[çc]\w*|song\w*|artist\w*|band\w*|grup\w*|group\w*|g[èeé]ner\w*|genre\w*|recoman\w*|recomien\w*|recommend\w*|playlist)\b/.test(t);
  if (musicHit) return 'music';
  return 'general';
}

/* ------------------------------------------------------------------ */
/*  UI: markup                                                         */
/* ------------------------------------------------------------------ */

const LAUNCHER_ID = 'chatbotLauncher';
const WINDOW_ID = 'chatbotWindow';
const MESSAGES_ID = 'chatbotMessages';
const INPUT_ID = 'chatbotInput';
const FORM_ID = 'chatbotForm';
const STATUS_ID = 'chatbotStatus';

function mountUI() {
  if (document.getElementById(LAUNCHER_ID)) return;

  const launcher = document.createElement('button');
  launcher.id = LAUNCHER_ID;
  launcher.className = 'chatbot-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Obrir assistent');
  launcher.innerHTML = '<i class="bi bi-chat-dots-fill" aria-hidden="true"></i>';

  const win = document.createElement('section');
  win.id = WINDOW_ID;
  win.className = 'chatbot-window';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', "Assistent Dona'm Bauxa");
  win.setAttribute('aria-hidden', 'true');
  win.innerHTML = `
    <header class="chatbot-header">
      <div class="chatbot-header-title">
        <span class="chatbot-avatar" aria-hidden="true"><i class="bi bi-stars"></i></span>
        <div>
          <div class="chatbot-title">Assistent Bauxa</div>
          <div class="chatbot-subtitle" id="${STATUS_ID}">IA al servidor</div>
        </div>
      </div>
      <button type="button" class="chatbot-close" aria-label="Tancar assistent">
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    </header>
    <div id="${MESSAGES_ID}" class="chatbot-messages" aria-live="polite" aria-atomic="false"></div>
    <form id="${FORM_ID}" class="chatbot-input-row" autocomplete="off">
      <input
        id="${INPUT_ID}"
        type="text"
        class="chatbot-input"
        placeholder="Demana'm un pla, musica…"
        aria-label="Escriu un missatge"
        maxlength="500"
        required
      />
      <button type="submit" class="chatbot-send" aria-label="Enviar">
        <i class="bi bi-send-fill" aria-hidden="true"></i>
      </button>
    </form>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(win);
}

/* ------------------------------------------------------------------ */
/*  UI: rendering                                                      */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMessage(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const lines = html.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-*•]\s+(.+)$/);
    if (m) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${m[1]}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

function appendMessage(role, text) {
  const list = document.getElementById(MESSAGES_ID);
  if (!list) return null;
  const row = document.createElement('div');
  row.className = `chatbot-msg chatbot-msg-${role}`;
  row.innerHTML = `<div class="chatbot-bubble">${role === 'assistant' ? formatMessage(text) : escapeHtml(text)}</div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

function appendTypingIndicator() {
  const list = document.getElementById(MESSAGES_ID);
  if (!list) return null;
  const row = document.createElement('div');
  row.className = 'chatbot-msg chatbot-msg-assistant chatbot-typing';
  row.innerHTML = `
    <div class="chatbot-bubble chatbot-bubble-typing" aria-label="Escrivint">
      <span></span><span></span><span></span>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

function renderStatus(text) {
  const el = document.getElementById(STATUS_ID);
  if (el) el.textContent = text || 'IA al servidor';
}

function renderUnavailableNotice(detail) {
  const list = document.getElementById(MESSAGES_ID);
  if (!list || list.querySelector('.chatbot-notice')) return;
  const row = document.createElement('div');
  row.className = 'chatbot-notice';
  row.innerHTML = `
    <i class="bi bi-info-circle" aria-hidden="true"></i>
    <strong>L'assistent no esta disponible.</strong>
    <br><br>
    El servidor no pot arribar al model. Comprova que <code>ollama serve</code>
    esta actiu a la maquina amfitriona i que el model configurat
    (<code>OLLAMA_MODEL</code>) esta descarregat (<code>ollama list</code>).
    <br><br>
    Detall: <code>${escapeHtml(detail || 'unknown')}</code>
  `;
  list.appendChild(row);
}

/* ------------------------------------------------------------------ */
/*  Chat orchestration                                                 */
/* ------------------------------------------------------------------ */

export async function sendMessage(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || generating) return '';

  appendMessage('user', trimmed);
  const intent = classifyIntent(trimmed);
  const retrievalContext = buildRetrievalContext(trimmed, intent);
  const userContent = retrievalContext ? `${retrievalContext}\n\nUsuari: ${trimmed}` : trimmed;
  console.log(`[chatbot] intent=${intent} retrieval=${retrievalContext ? 'yes' : 'no'} msg=${JSON.stringify(trimmed)}`);
  if (retrievalContext) console.log('[chatbot] context:\n' + retrievalContext);

  // History uses the *raw* user text so the model isn't fed the RAG block
  // twice. The RAG context is only attached to the message currently in flight.
  const outboundMessages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];
  history.push({ role: 'user', content: trimmed });

  const typing = appendTypingIndicator();
  generating = true;
  setSendingState(true);
  currentAbort = new AbortController();

  let bubble = null;
  let bubbleBody = null;
  let finalText = '';

  try {
    for await (const piece of streamChat(outboundMessages, currentAbort.signal)) {
      if (!bubble) {
        typing?.remove();
        bubble = appendMessage('assistant', '');
        bubbleBody = bubble?.querySelector?.('.chatbot-bubble') ?? null;
      }
      finalText += piece;
      if (bubbleBody) bubbleBody.innerHTML = formatMessage(finalText);
      const list = document.getElementById(MESSAGES_ID);
      if (list) list.scrollTop = list.scrollHeight;
    }
    if (!finalText) {
      typing?.remove();
      appendMessage('assistant', 'El model no ha retornat resposta.');
    } else {
      history.push({ role: 'assistant', content: finalText });
    }
    return finalText;
  } catch (err) {
    typing?.remove();
    console.error('[chatbot] generation failed:', err);
    if (err?.name === 'AbortError') {
      appendMessage('assistant', 'Resposta cancel·lada.');
    } else {
      renderUnavailableNotice(err?.message || String(err));
    }
    return '';
  } finally {
    generating = false;
    currentAbort = null;
    setSendingState(false);
  }
}

function setSendingState(isSending) {
  const input = document.getElementById(INPUT_ID);
  const form = document.getElementById(FORM_ID);
  if (input) input.disabled = isSending;
  if (form) form.classList.toggle('chatbot-form-busy', isSending);
}

/* ------------------------------------------------------------------ */
/*  UI: open/close + binding                                           */
/* ------------------------------------------------------------------ */

function openWindow() {
  const win = document.getElementById(WINDOW_ID);
  const launcher = document.getElementById(LAUNCHER_ID);
  if (!win) return;
  win.classList.add('open');
  win.setAttribute('aria-hidden', 'false');
  launcher?.classList.add('chatbot-launcher-hidden');
  document.getElementById(INPUT_ID)?.focus();

  if (!history.length) {
    appendMessage(
      'assistant',
      "Hola! Soc l'assistent de Dona'm Bauxa. Et puc ajudar a **planificar un cap de setmana**, **recomanar-te musica** o respondre dubtes. Que et ve de gust?"
    );
    primeModel();
  }
}

function closeWindow() {
  const win = document.getElementById(WINDOW_ID);
  const launcher = document.getElementById(LAUNCHER_ID);
  if (!win) return;
  win.classList.remove('open');
  win.setAttribute('aria-hidden', 'true');
  launcher?.classList.remove('chatbot-launcher-hidden');
  currentAbort?.abort();
}

async function primeModel() {
  const health = await diagnose();
  if (health?.ok) {
    renderStatus(`IA al servidor · ${health.model}`);
  } else {
    renderStatus('Servidor no disponible');
    renderUnavailableNotice(health?.error);
  }
}

function bindEvents() {
  const launcher = document.getElementById(LAUNCHER_ID);
  const win = document.getElementById(WINDOW_ID);
  const form = document.getElementById(FORM_ID);
  const input = document.getElementById(INPUT_ID);
  const closeBtn = win?.querySelector('.chatbot-close');

  launcher?.addEventListener('click', openWindow);
  closeBtn?.addEventListener('click', closeWindow);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input?.value || '';
    if (!value.trim()) return;
    input.value = '';
    sendMessage(value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && win?.classList.contains('open')) closeWindow();
  });
}

/* ------------------------------------------------------------------ */
/*  Public init                                                        */
/* ------------------------------------------------------------------ */

export function initChatbot() {
  mountUI();
  bindEvents();
  if (typeof window !== 'undefined') {
    window.__chatbotDiagnose = diagnose;
    window.__chatbot = { sendMessage, classifyIntent, history, diagnose };
  }
}
