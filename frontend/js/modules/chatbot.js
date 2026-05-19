/**
 * @module chatbot
 * @description On-device AI chatbot for Dona'm Bauxa, powered by Chrome's
 * built-in Gemini Nano (Prompt API: `window.LanguageModel` / `window.ai`).
 *
 * The module is self-contained: it injects a floating launcher and chat
 * window into the document, manages a per-session conversation, streams
 * responses, and degrades gracefully on browsers that don't expose the
 * Prompt API or on devices that don't (yet) have the model downloaded.
 *
 * Public surface:
 *   - initChatbot()        Mount the UI and prepare runtime state.
 *   - sendMessage(text)    Programmatic send (useful for tests).
 *   - __mockTest()         Console-driven mock test entry point.
 */

/* ------------------------------------------------------------------ */
/*  System instruction                                                 */
/* ------------------------------------------------------------------ */

const SYSTEM_INSTRUCTION = `Ets l'assistent virtual de Dona'm Bauxa, una plataforma de descoberta musical i d'esdeveniments a Mallorca. Respons en catala per defecte (canvia a castella o angles si l'usuari ho fa). Mante un to amistos, breu i concret.

Tens tres especialitats:

1. PLANIFICADOR DE CAP DE SETMANA
   Si l'usuari demana un pla i menciona un dia concret (dissabte / diumenge / divendres vespre), respon amb un itinerari estructurat en franges horaries (mati, migdia, tarda, vespre, nit). Cada franja: 1 activitat + 1 frase de context. Si menciona Mallorca, dona suggeriments locals plausibles (cala, mercat, ruta, concert). Si no especifica dia, demana-li quin dia vol planificar.

2. RECOMANADOR MUSICAL
   Si l'usuari nomena un artista, canco o genere, suggereix 3-5 artistes o temes similars amb una frase curta explicant la connexio (estil, escena, epoca). Si nomes diu "recomana'm musica", pregunta quin estil li agrada.

3. AJUDANT GENERAL
   Per a qualsevol altra pregunta (saludar, dubtes sobre la plataforma, preguntes curioses), respon de manera educada i concisa (1-3 frases).

DADES DE LA PLATAFORMA: Quan rebis un bloc "CONTEXT (dades reals…)" abans del missatge de l'usuari, basa la teva resposta NOMES en aquestes dades. Cita els esdeveniments i artistes pel nom exacte i, si esmentes una data o lloc, fes-ho amb les dades del context. No inventis esdeveniments, dates ni recintes que no apareguin al context. Si el context esta buit o no inclou cap element rellevant, digues que no trobes res a l'agenda i suggereix que l'usuari ajusti la cerca.

Format: usa llistes Markdown quan ajudin a la lectura. Evita disclaimers innecessaris.`;

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

/** @type {Object|null} Active LanguageModel session */
let session = null;

/** @type {'unknown'|'unsupported'|'unavailable'|'downloadable'|'downloading'|'ready'|'error'} */
let modelStatus = 'unknown';

/** @type {Array<{role: 'user'|'assistant', text: string}>} */
const history = [];

/** @type {boolean} Whether a generation is in flight */
let generating = false;

/** @type {AbortController|null} */
let currentAbort = null;

/** @type {{events: Array<Object>, artists: Array<Object>}} */
let dataCtx = { events: [], artists: [] };

/**
 * Lets the host SPA hand the chatbot a live view of the loaded catalog.
 * Called from app.js once `ensureDataLoaded()` resolves.
 * @param {{events: Array<Object>, artists: Array<Object>}} payload
 */
export function setDataContext({ events, artists }) {
  dataCtx = { events: events || [], artists: artists || [] };
  console.log(`[chatbot] data context updated: ${dataCtx.events.length} events, ${dataCtx.artists.length} artists`);
}

/* ------------------------------------------------------------------ */
/*  Retrieval (RAG-style filter into the system context)              */
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

function eventDate(e) {
  const d = e?.startDate || e?.date || null;
  return d ? new Date(d) : null;
}

function eventVenue(e) {
  return e?.location?.name || e?.venue || '';
}

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

/**
 * Extracts retrieval filters from a free-text query.
 * @param {string} query
 */
function extractFilters(query) {
  const q = query.toLowerCase();
  const filters = { day: null, genre: null, zone: null, artistMention: null };

  for (const [name, idx] of Object.entries(DAY_NAMES)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(q)) { filters.day = idx; break; }
  }
  filters.genre = KNOWN_GENRES.find(g => q.includes(g)) || null;
  filters.zone = KNOWN_ZONES.find(z => q.includes(z)) || null;

  // Cheap "does the message contain an artist name we know?" — exact substring match.
  for (const a of dataCtx.artists) {
    if (a?.name && q.includes(a.name.toLowerCase())) { filters.artistMention = a; break; }
  }

  return filters;
}

/**
 * Selects relevant events for a query.
 * @param {ReturnType<extractFilters>} filters
 * @param {'weekend'|'music'|'general'} intent
 * @returns {Array<Object>}
 */
function selectEvents(filters, intent) {
  const now = Date.now();

  // Score by "upcoming preferred, then closest in time". Future events get
  // a negative bias so they rank before past events at the same distance.
  const score = (e) => {
    const d = eventDate(e);
    if (!d) return Infinity;
    const diff = d.getTime() - now;
    return diff >= 0 ? diff : (-diff) + 365 * 86400000;
  };

  let events = dataCtx.events.filter(e => eventDate(e)).sort((a, b) => score(a) - score(b));

  if (filters.day !== null) {
    events = events.filter(e => eventDate(e).getDay() === filters.day);
  }
  if (filters.genre) {
    events = events.filter(e => eventGenres(e).some(g => g.toLowerCase().includes(filters.genre)));
  }
  if (filters.zone) {
    events = events.filter(e => (e.zone || '').toLowerCase().includes(filters.zone));
  }
  if (filters.artistMention?.name) {
    const an = filters.artistMention.name.toLowerCase();
    events = events.filter(e => (e?.performer?.name || '').toLowerCase().includes(an));
  }

  // Cap to keep within Gemini Nano's small context budget.
  return events.slice(0, intent === 'weekend' ? 12 : 6);
}

/**
 * Selects relevant artists for a query (music intent + general where useful).
 */
function selectArtists(filters, intent) {
  if (intent !== 'music' && !filters.artistMention) return [];
  let artists = dataCtx.artists.slice();

  // If a known artist was named, prioritise same-genre artists.
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

/**
 * Compact one-line representation of an event.
 */
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

/**
 * Builds the per-message retrieval context block, or '' if nothing relevant.
 * @param {string} query
 * @param {'weekend'|'music'|'general'} intent
 */
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
/*  Prompt API detection                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolves the Prompt API entry point across the various Chrome rollouts:
 *   - `window.LanguageModel` (current / Chrome 138+ stable surface)
 *   - `window.ai.languageModel` (mid-2024 Canary surface)
 *   - `window.ai.assistant` (early 2024 alias)
 *   - `window.ai` with `canCreateTextSession` (oldest Canary surface, wrapped)
 * @returns {Object|null}
 */
function getLanguageModelAPI() {
  if (typeof window === 'undefined') return null;
  if (window.LanguageModel) return window.LanguageModel;
  if (window.ai?.languageModel) return window.ai.languageModel;
  if (window.ai?.assistant) return window.ai.assistant;

  // Oldest API surface (Canary, pre-July 2024). Adapt it to the modern shape.
  if (window.ai && typeof window.ai.canCreateTextSession === 'function') {
    return {
      async availability() {
        const r = await window.ai.canCreateTextSession();
        // Old values: 'readily' | 'after-download' | 'no'
        return r;
      },
      async capabilities() {
        const r = await window.ai.canCreateTextSession();
        return { available: r };
      },
      async create() {
        const s = await window.ai.createTextSession();
        return {
          prompt: (t) => s.prompt(t),
          promptStreaming: s.promptStreaming ? (t) => s.promptStreaming(t) : undefined,
          destroy: s.destroy ? () => s.destroy() : () => {},
        };
      },
    };
  }
  return null;
}

/**
 * Returns a human-readable diagnostic snapshot of the AI API surface area.
 * Useful when the chatbot reports "unsupported" but the user believes
 * they've enabled the flag.
 * @returns {{secureContext: boolean, host: string, userAgent: string, apiSurfaces: string[], windowAi: any}}
 */
export function diagnose() {
  if (typeof window === 'undefined') return null;
  const surfaces = [];
  if (window.LanguageModel) surfaces.push('window.LanguageModel');
  if (window.ai?.languageModel) surfaces.push('window.ai.languageModel');
  if (window.ai?.assistant) surfaces.push('window.ai.assistant');
  if (typeof window.ai?.canCreateTextSession === 'function') surfaces.push('window.ai.canCreateTextSession');

  const info = {
    secureContext: window.isSecureContext,
    host: window.location.host || window.location.href,
    protocol: window.location.protocol,
    userAgent: navigator.userAgent,
    apiSurfaces: surfaces,
    windowAiKeys: window.ai ? Object.keys(window.ai) : null,
    hasLanguageModel: !!window.LanguageModel,
    hasWindowAi: !!window.ai,
  };
  console.log('[chatbot] diagnostic:', info);
  return info;
}

/**
 * Probes the API for availability. Normalises return values across
 * historical names ('readily', 'after-download', 'no') and the newer
 * strings ('available', 'downloadable', 'downloading', 'unavailable').
 * @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'|'unsupported'>}
 */
async function checkAvailability() {
  const api = getLanguageModelAPI();
  if (!api) return 'unsupported';

  try {
    let raw;
    if (typeof api.availability === 'function') {
      raw = await api.availability();
    } else if (typeof api.capabilities === 'function') {
      const caps = await api.capabilities();
      raw = caps?.available;
    } else {
      return 'unsupported';
    }

    switch (raw) {
      case 'readily':
      case 'available':
        return 'available';
      case 'after-download':
      case 'downloadable':
        return 'downloadable';
      case 'downloading':
        return 'downloading';
      case 'no':
      case 'unavailable':
      default:
        return raw ? 'unavailable' : 'unsupported';
    }
  } catch (err) {
    console.warn('[chatbot] availability check failed:', err);
    return 'unsupported';
  }
}

/**
 * Lazily creates a LanguageModel session. Sets up a download-progress
 * monitor so the UI can surface progress while Gemini Nano is fetched.
 * @returns {Promise<Object>} The active session
 */
async function ensureSession() {
  if (session) return session;

  const api = getLanguageModelAPI();
  if (!api) throw new Error('Prompt API not available');

  // Chrome's Prompt API only supports safety-attestation for [en, es, ja].
  // Catalan isn't on that list — declaring `ca` raises NotSupportedError.
  // Use Spanish (linguistically closest to Catalan) for both attestation
  // sides. The system prompt still steers the model to reply in Catalan;
  // safety filtering will run against Spanish toxic-word lists.
  const createOptions = {
    initialPrompts: [{ role: 'system', content: SYSTEM_INSTRUCTION }],
    expectedInputs: [{ type: 'text', languages: ['es', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['es'] }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        const pct = Math.round((e.loaded ?? 0) * 100);
        modelStatus = 'downloading';
        renderStatus(`Descarregant el model… ${pct}%`);
      });
    },
  };

  // Try each option shape that Chrome has historically accepted. Newer
  // builds reject unknown keys, so we strip and retry on failure.
  const attempts = [
    createOptions,
    { ...createOptions, expectedInputs: undefined, expectedOutputs: undefined },
    { systemPrompt: SYSTEM_INSTRUCTION, monitor: createOptions.monitor },
  ];

  let lastErr = null;
  for (const opts of attempts) {
    try {
      // Strip undefined keys so Chrome doesn't reject the object outright.
      const clean = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
      session = await api.create(clean);
      modelStatus = 'ready';
      renderStatus('');
      return session;
    } catch (err) {
      lastErr = err;
      console.warn('[chatbot] create attempt failed:', err?.name, err?.message);
      // If it's InvalidStateError, retrying with different options won't help.
      if (err?.name === 'InvalidStateError') break;
    }
  }
  modelStatus = 'error';
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/*  Intent classification (used for logging / testing only)            */
/* ------------------------------------------------------------------ */

/**
 * Lightweight keyword classifier so we can log which use case was hit.
 * The model itself is responsible for the actual response — this is only
 * instrumentation for the test harness.
 * @param {string} text
 * @returns {'weekend'|'music'|'general'}
 */
export function classifyIntent(text) {
  const t = text.toLowerCase();
  const dayHit = /\b(dissabte|diumenge|divendres|saturday|sunday|friday|sabado|domingo|viernes)\b/.test(t);
  const planHit = /\b(pla|plan|itinerari|itinerario|cap de setmana|weekend|fin de semana)\b/.test(t);
  if (dayHit && (planHit || /\b(fer|hacer|do|que faig|que hago)\b/.test(t))) return 'weekend';
  if (planHit) return 'weekend';

  // Stem-friendly match: `artist`, `artista`, `artistes`, `recomana`, `recomanacio`, etc.
  const musicHit = /\b(m[uú]sic\w*|can[çc]\w*|song\w*|artist\w*|band\w*|grup\w*|group\w*|g[èeé]ner\w*|genre\w*|recoman\w*|recomien\w*|recommend\w*|playlist)\b/.test(t);
  if (musicHit) return 'music';

  return 'general';
}

/* ------------------------------------------------------------------ */
/*  UI: markup injection                                               */
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
          <div class="chatbot-subtitle" id="${STATUS_ID}">IA al dispositiu</div>
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
/*  UI: rendering helpers                                              */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal Markdown→HTML for what Gemini Nano typically emits in chat
 * (bold, italics, inline code, bullet lists, line breaks). Escapes first.
 * @param {string} text
 * @returns {string} HTML
 */
function formatMessage(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // Bullet lists: lines starting with -, * or • become <li>.
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
  if (el) el.textContent = text || (modelStatus === 'ready' ? 'IA al dispositiu · llest' : 'IA al dispositiu');
}

function renderUnsupportedNotice(detail) {
  const list = document.getElementById(MESSAGES_ID);
  if (!list || list.querySelector('.chatbot-notice')) return;
  const row = document.createElement('div');
  row.className = 'chatbot-notice';

  const insecure = typeof window !== 'undefined' && !window.isSecureContext;
  const intro = detail === 'unavailable'
    ? "El navegador exposa l'API pero Gemini Nano no esta disponible al dispositiu."
    : "Aquest navegador no exposa l'API de Gemini Nano integrat.";

  row.innerHTML = `
    <i class="bi bi-info-circle" aria-hidden="true"></i>
    <strong>${intro}</strong>
    <br><br>
    ${insecure ? '<strong>Atencio:</strong> la pagina no es <em>secure context</em> (cal HTTPS o localhost).<br><br>' : ''}
    Per habilitar-lo a Chrome 138+:
    <ol style="margin: 0.4rem 0 0.4rem 1.1rem; padding: 0;">
      <li>Activa <code>chrome://flags/#prompt-api-for-gemini-nano</code> → <em>Enabled</em></li>
      <li>Activa <code>chrome://flags/#optimization-guide-on-device-model</code> → <em>Enabled BypassPerfRequirement</em></li>
      <li>Reinicia Chrome</li>
      <li>Obre <code>chrome://components</code>, cerca <strong>Optimization Guide On Device Model</strong> i prem <em>Check for update</em> (el model fa ~2 GB)</li>
      <li>Espera fins que la versio sigui diferent de 0.0.0.0 i recarrega aquesta pagina</li>
    </ol>
    Executa <code>window.__chatbotDiagnose()</code> a la consola per veure detalls.
  `;
  list.appendChild(row);
}

/* ------------------------------------------------------------------ */
/*  Chat orchestration                                                 */
/* ------------------------------------------------------------------ */

/**
 * Sends a user message, drives the model, streams the response into the
 * UI, and returns the final assistant text. Reusable for the test harness.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sendMessage(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || generating) return '';

  appendMessage('user', trimmed);
  history.push({ role: 'user', text: trimmed });

  const intent = classifyIntent(trimmed);
  const retrievalContext = buildRetrievalContext(trimmed, intent);
  const modelInput = retrievalContext ? `${retrievalContext}\n\nUsuari: ${trimmed}` : trimmed;
  console.log(`[chatbot] intent=${intent} retrieval=${retrievalContext ? 'yes' : 'no'} msg=${JSON.stringify(trimmed)}`);
  if (retrievalContext) console.log('[chatbot] context:\n' + retrievalContext);

  const typing = appendTypingIndicator();
  generating = true;
  setSendingState(true);

  try {
    const s = await ensureSession();
    currentAbort = new AbortController();

    let finalText = '';
    let bubble = null;

    if (typeof s.promptStreaming === 'function') {
      const stream = s.promptStreaming(modelInput, { signal: currentAbort.signal });
      typing?.remove();
      bubble = appendMessage('assistant', '');
      const bubbleBody = bubble?.querySelector?.('.chatbot-bubble') ?? null;

      let lastChunk = '';
      for await (const chunk of stream) {
        // Some implementations emit cumulative text; others emit deltas.
        if (chunk.startsWith(lastChunk) && chunk.length > lastChunk.length) {
          finalText = chunk;
        } else {
          finalText += chunk;
        }
        lastChunk = chunk;
        if (bubbleBody) bubbleBody.innerHTML = formatMessage(finalText);
        const list = document.getElementById(MESSAGES_ID);
        if (list) list.scrollTop = list.scrollHeight;
      }
    } else if (typeof s.prompt === 'function') {
      finalText = await s.prompt(modelInput, { signal: currentAbort.signal });
      typing?.remove();
      appendMessage('assistant', finalText);
    } else {
      throw new Error('Session has no prompt() method');
    }

    history.push({ role: 'assistant', text: finalText });
    return finalText;
  } catch (err) {
    typing?.remove();
    console.error('[chatbot] generation failed:', err);
    let msg;
    if (err?.name === 'AbortError') {
      msg = 'Resposta cancel·lada.';
    } else if (err?.name === 'InvalidStateError') {
      msg = "El model encara no esta llest al dispositiu. Comprova a `chrome://components` que **Optimization Guide On Device Model** te una versio diferent de `0.0.0.0` i que el flag `optimization-guide-on-device-model` esta en **Enabled BypassPerfRequirement**.";
    } else if (err?.name === 'QuotaExceededError') {
      msg = 'El missatge es massa llarg per al model. Resumeix-lo i torna a provar.';
    } else if (err?.name === 'NotSupportedError' && /space|disk/i.test(String(err?.message))) {
      msg = "**No hi ha prou espai al disc** per descarregar Gemini Nano. Chrome requereix ~22 GB lliures. Allibera espai i torna-ho a intentar.";
    } else if (err?.name === 'NotSupportedError' && /service is not running/i.test(String(err?.message))) {
      msg = "**El servei d'IA al dispositiu no esta actiu.** Obre `chrome://components`, busca **Optimization Guide On Device Model** i prem _Check for update_. Si la versio segueix sent `0.0.0.0` despres de descarregar, comprova que tens almenys 22 GB lliures al disc i reinicia Chrome.";
    } else if (err?.name === 'NotSupportedError') {
      msg = `Opcions no suportades: ${err.message}`;
    } else {
      msg = `L'assistent no ha pogut respondre (${err?.name || 'error'}). Mira la consola per detalls.`;
    }
    appendMessage('assistant', msg);
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

  // First open: seed greeting + verify model.
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
  // Always log a diagnostic on first model probe so the developer console
  // tells us exactly which API surface (if any) Chrome is exposing.
  diagnose();

  const status = await checkAvailability();
  modelStatus = status === 'available' ? 'ready' : status;
  console.log('[chatbot] availability:', status);

  if (status === 'unsupported') {
    renderStatus('No disponible en aquest navegador');
    renderUnsupportedNotice('unsupported');
    return;
  }
  if (status === 'unavailable') {
    renderStatus('Model no disponible al dispositiu');
    renderUnsupportedNotice('unavailable');
    return;
  }
  if (status === 'downloadable') {
    // Don't trigger the download here — `create()` needs a user gesture and
    // the gesture from "open the chat window" may have lapsed across awaits.
    // We let the next message kick it off.
    renderStatus("Model llest per descarregar (s'iniciara amb el primer missatge)");
    return;
  }
  if (status === 'downloading') {
    renderStatus("El model s'esta descarregant en segon pla…");
    return;
  }
  // 'available' — defer session creation until first send to save memory.
  renderStatus('IA al dispositiu · llest');
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

  // ESC closes the chat window.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && win?.classList.contains('open')) closeWindow();
  });
}

/* ------------------------------------------------------------------ */
/*  Public init                                                        */
/* ------------------------------------------------------------------ */

/**
 * Mounts the chatbot UI and binds events. Idempotent.
 */
export function initChatbot() {
  mountUI();
  bindEvents();
  // Expose mock-test entry point + diagnostic helper on window for easy console use.
  if (typeof window !== 'undefined') {
    window.__chatbotMockTest = mockTest;
    window.__chatbotDiagnose = diagnose;
    window.__chatbot = { sendMessage, classifyIntent, history, diagnose };
  }
}

/* ------------------------------------------------------------------ */
/*  Mock test harness                                                  */
/* ------------------------------------------------------------------ */

/**
 * Installs a fake LanguageModel that returns canned streamed responses
 * for the two main use cases, runs them through `sendMessage()`, asserts
 * the intent classifier picked the right bucket, and restores the
 * original API. Usable from the browser console: `__chatbotMockTest()`.
 */
export async function mockTest() {
  console.group('[chatbot] mock test');
  const original = {
    LanguageModel: window.LanguageModel,
    ai: window.ai,
  };

  const canned = {
    weekend: `Itinerari de **dissabte** a Mallorca:\n- Mati: esmorzar a un forn de Palma\n- Migdia: Cala Mondrago\n- Tarda: passeig per Soller\n- Vespre: concert a Es Gremi`,
    music: `Si t'agrada Antònia Font, prova:\n- Manel — pop català melodic\n- Sopa de Cabra — rock català classic\n- Love of Lesbian — pop indie en català`,
  };

  async function* streamOf(text) {
    for (const piece of text.match(/.{1,8}/g) || []) {
      await new Promise(r => setTimeout(r, 15));
      yield piece;
    }
  }

  const fake = {
    async availability() { return 'available'; },
    async create() {
      let nextIntent = 'general';
      return {
        promptStreaming(text) {
          nextIntent = classifyIntent(text);
          const reply = canned[nextIntent] || 'Resposta de prova general.';
          return streamOf(reply);
        },
        async prompt(text) {
          const reply = canned[classifyIntent(text)] || 'Resposta de prova general.';
          return reply;
        },
        destroy() {},
      };
    },
  };

  // Reset session so we pick up the fake.
  session = null;
  window.LanguageModel = fake;
  delete window.ai;

  const cases = [
    { input: 'Fes-me un pla per dissabte a Mallorca', expected: 'weekend' },
    { input: 'Recomana\'m musica si m\'agrada Antònia Font', expected: 'music' },
  ];

  let pass = 0;
  for (const c of cases) {
    const got = classifyIntent(c.input);
    const ok = got === c.expected;
    console.log(`  ${ok ? '✓' : '✗'} intent: input=${JSON.stringify(c.input)} expected=${c.expected} got=${got}`);
    if (ok) pass++;
    const reply = await sendMessage(c.input);
    console.log(`    reply preview: ${reply.slice(0, 80).replace(/\n/g, ' ')}…`);
  }

  // Restore originals.
  session = null;
  window.LanguageModel = original.LanguageModel;
  if (original.ai) window.ai = original.ai;

  console.log(`[chatbot] mock test done: ${pass}/${cases.length} intent assertions passed`);
  console.groupEnd();
  return pass === cases.length;
}
