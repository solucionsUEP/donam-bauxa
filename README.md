# Dona'm Bauxa 🎶

**Plataforma de descoberta musical i d'esdeveniments en directe de Mallorca.**
Concerts, festivals, festes populars, artistes locals, un mapa interactiu, un joc
musical i un assistent d'IA — tot en una SPA progressiva (PWA) multiidioma.

🌐 **Live:** https://www.donambauxa.online/

---

## ✨ Característiques

- **SPA en Vanilla JS** (sense framework) amb routing hash-based i ES Modules.
- **Multiidioma (i18n)** complet en 4 llengües: Català, Castellà, English, Deutsch.
- **PWA** de nivell producció: service worker amb múltiples estratègies de caché,
  notificacions push (VAPID), background sync i mode offline.
- **Mapa interactiu** (Leaflet + OpenStreetMap) amb filtres i geolocalització de
  l'usuari.
- **Assistent d'IA** amb RAG (Ollama al backend, Gemini Nano on-device de
  fallback) i lectura en veu alta (Web Speech API / TTS).
- **Joc musical** amb 156 preguntes (àudio, imatge i vídeo propis).
- **Web semàntica**: Schema.org exhaustiu (MusicEvent, MusicGroup, Quiz…) i
  JSON-LD dinàmic.
- **Accessibilitat**: landmarks ARIA, skip link, navegació per teclat,
  `aria-current`, contrast WCAG, TTS.
- **Imatges responsive**: `<picture>` amb AVIF/WebP/JPEG i `srcset`/`sizes` per
  resolució.
- **Sistema d'autenticació**: Google OAuth + email/contrasenya (Supabase Auth)
  amb tres rols (lector, promotor, admin).

---

## 🧱 Stack tècnic

| Capa | Tecnologia |
|------|-----------|
| Frontend | Vanilla JS (ES Modules), Bootstrap 5, Leaflet.js |
| Backend producció | PHP 8+ sobre Apache (`api/`), cURL a Supabase REST |
| Backend dev local | Node.js / Express (`server.js`, `routes/`) |
| Base de dades | Supabase (PostgreSQL) — usuaris i sol·licituds |
| Contingut | Fitxers JSON a `frontend/data/` (artistes, events, notícies) |
| Auth | Supabase (Google OAuth 2.0 + email/password, JWT Bearer) |
| IA | Ollama (`gemma`), Chrome Prompt API (Gemini Nano), Instagram analyzer |
| PWA | Service Worker, Web Push (VAPID), Manifest |

---

## 🚀 Desenvolupament local

```bash
npm install          # instal·la dependències
npm run dev          # servidor Node amb --watch (http://localhost:3000)
npm start            # servidor Node en producció
npm run lint         # ESLint sobre els mòduls del frontend
npm run lint:fix     # ESLint amb autocorrecció
npm run build:images # regenera les variants responsive d'imatges (sharp)
npm run build:version# genera frontend/version.json per al SW
```

> No hi ha tests automatitzats configurats.

### Variables d'entorn (`.env`, dev Node)

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
SESSION_SECRET=
FRONTEND_URL=
PORT=3000
NODE_ENV=development
```

### Configuració PHP (`api/config.php`, **gitignored**)

```php
define('SUPABASE_URL',         'https://....supabase.co');
define('SUPABASE_SERVICE_KEY', '...');
define('SUPABASE_JWT_SECRET',  '...');
define('DATA_DIR', dirname(__DIR__) . '/data');
define('FRONTEND_URL', 'https://donambauxa.online');
```

---

## 🗂️ Arquitectura

```
Frontend (SPA) → PHP API (api/index.php) → Supabase REST API (users/requests)
                                          → JSON files (frontend/data/)
```

```
frontend/
  index.html          — SPA shell
  js/
    app.js            — orquestrador principal
    router.js         — routing hash-based
    i18n.js           — internacionalització
    pwa.js            — service worker + push
    modules/
      auth.js         — autenticació (Google + email/password)
      chatbot.js      — assistent d'IA + RAG
      tts.js          — text-to-speech (Web Speech API)
      mapModule.js    — mapa Leaflet
      renderer.js     — render de targetes (picture/srcset, time, figure)
      filters.js, favorites.js, joc.js, jsonld.js, ui.js, …
  data/*.json         — contingut (Schema.org)
  locales/*.json      — ca, es, en, de
  assets/images/      — imatges AVIF/WebP/JPEG + variants -400w/-800w
```

Vegeu [`CLAUDE.md`](CLAUDE.md) per a la guia detallada d'arquitectura i API.

---

## 🚢 Desplegament

- **Frontend** es publica a Apache (DonDominio) via FTP amb GitHub Actions
  (`.github/workflows/deploy-frontend.yml`). El pas de lint s'executa abans del
  deploy. `frontend/.htaccess` encamina `/api/*` i `/auth/*` cap a `api/index.php`.
- **Backend** PHP es desplega per separat (`deploy-backend.yml`).
- `api/config.php` està gitignored i es puja manualment per FTP.

---

## 👥 Autors

- **Dylan Canning** — [@dylanluigi](https://github.com/dylanluigi)
- **Josep Ferriol** — [@JoFeF08](https://github.com/JoFeF08)

Projecte acadèmic — UIB, Tecnologia Multimèdia.

## 📄 Llicència

[MIT](LICENSE)
