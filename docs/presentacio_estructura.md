# Estructura de la Presentació Final — Dona'm Bauxa
> Assignatura: Tecnologia Multimèdia · Presentació Pràctica Final (P3)  
> Segueix l'índex de documentació oficial de l'assignatura

---

## BLOC 0 — INTRODUCCIÓ (2 diapositives)

---

### Diapositiva 1 — Portada
**Contingut:**
- Títol gran: **Dona'm Bauxa**
- Subtítol: *Plataforma interactiva de l'escena musical de Mallorca*
- URL en viu: `donambauxa.online`
- Nom complet de l'autor / grup
- Assignatura, curs i data

**Visual:** Logo SVG del projecte centrat, fons amb la paleta de colors de l'app (blau fosc `#1B4965`, terracota `#C45A3C`).

---

### Diapositiva 2 — Introducció: Objectiu i Abast
**Contingut:**
- **Objectiu:** Crear una WebApp SPA per descobrir artistes, concerts i festes populars de Mallorca, amb joc musical interactiu i panell d'administració.
- **Públic objectiu:** Residents i turistes a Mallorca interessats en la música i cultura local.
- **Temàtica:** Escena musical mallorquina (música en català/mallorquí).
- **Funcionalitats principals enumerades en 1 línia cadascuna:**
  - Catàleg d'artistes amb filtres
  - Agenda d'esdeveniments amb mapa geolocalitzat
  - Joc musical multimèdia (àudio, imatge, vídeo)
  - Gestió d'usuaris i rols (lector / promotor / admin)
  - Exportació de calendari (.ics)
  - Favorits persistits al navegador

---

## BLOC 1 — ARQUITECTURA EN EL SERVIDOR (2 diapositives)

---

### Diapositiva 3 — Arquitectura General
**Contingut:**
- **Diagrama de blocs** (dibuixat a la diapositiva):
  ```
  Navegador (SPA)
       │  fetch JSON estàtics
       │  fetch /api/* (JWT)
       ▼
  Express.js (Node.js) ─── Vercel Serverless
       │
       ├── /frontend/ (static files: HTML, CSS, JS, assets)
       ├── /routes/   (content, profile, users, requests)
       ├── /middleware/auth.js  (JWT → Supabase)
       └── /helpers/  (json.js mutex, supabase.js mock)
            │
            ├── Supabase DB  (users, requests)
            └── JSON files   (artists, events, news, questions)
  ```
- **Stack tècnic:**
  - Frontend: Vanilla JS ES6 Modules + Bootstrap 5.3.3
  - Backend: Node.js `"type":"module"` + Express 4
  - Auth/DB: Supabase (PostgreSQL + GoTrue JWT)
  - Deploy: Vercel (serverless) → `donambauxa.online`

---

### Diapositiva 4 — Estructura de Fitxers i Carpetes
**Contingut:**
```
donam-bauxa/
├── server.js               ← Servidor Express + CORS + redirect 301
├── vercel.json             ← Config deploy serverless
├── routes/
│   ├── content.js          ← CRUD genèric (artists/events/news/questions)
│   ├── profile.js          ← Perfil d'usuari autenticat
│   ├── users.js            ← Gestió d'usuaris (admin)
│   └── requests.js         ← Sol·licituds promotor → admin
├── middleware/auth.js       ← Verificació JWT doble (Supabase + DB)
├── helpers/
│   ├── json.js             ← Mutex lock + readJSON/writeJSON
│   └── supabase.js         ← Client Supabase + mock dev
├── frontend/
│   ├── index.html          ← Única pàgina HTML (SPA)
│   ├── css/                ← Estils propis + Bootstrap
│   ├── js/
│   │   ├── app.js          ← Entry point + orquestració de vistes
│   │   ├── router.js       ← Hash-based SPA router
│   │   ├── config.js       ← Supabase client + apiFetch helper
│   │   └── modules/        ← dataLoader, renderer, filters, joc,
│   │                          mapModule, favorites, calendar, admin...
│   ├── data/               ← JSON Schema.org (artists, events, news...)
│   └── assets/             ← images (AVIF/WebP/JPEG), audio (M4A)
└── docs/                   ← Documentació tècnica
```
**Nota visual:** Ressaltar amb colors les capes: blau = backend, verd = frontend/data, taronja = assets multimèdia.

---

## BLOC 2 — DISSENY DEL FRONT-END (2 diapositives)

---

### Diapositiva 5 — Navegació SPA i Diagrama de Vistes
**Contingut:**
- **Diagrama de navegació** (hash-based routing):
  ```
  #home → Portada (events destacats, notícies, artistes)
  #artists → Catàleg d'artistes + filtres
  #events  → Agenda d'esdeveniments + filtres + data
  #map     → Mapa Leaflet geolocalitzat
  #favorits → Favorits guardats (localStorage)
  #joc     → Joc musical multimèdia
  #profile → Perfil d'usuari (requereix auth)
  #solicituds → Sol·licituds promotor (requereix rol)
  #admin   → Panell d'administració (requereix admin)
  ```
- **Punts clau del router:**
  - Canvi de vista sense recarregar la pàgina (`hashchange`)
  - Tanca automàticament navbar mòbil i modals Bootstrap en cada canvi
  - Patró `initializedViews` (Set) → listeners de filtres no es dupliquen
  - `mapCleanup()` evita l'error `Map container is already initialized` de Leaflet

---

### Diapositiva 6 — HTML5, CSS i Disseny Responsiu
**Contingut:**
- **HTML5 semàntic:** `<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<footer>`; cada targeta d'artista/event és un `<article>`.
- **Bootstrap 5.3.3:** Sistema de grid (`col-md-6 col-lg-4`), modals, navbar collapse, badgets. Manipulat directament via JS (`bootstrap.Modal.getInstance`, `bootstrap.Collapse.getInstance`).
- **CSS propi:** Variables CSS natives (`--color-primary`, etc.), animacions `animate-fade-in-up`, skeleton loaders per anti-CLS.
- **Responsive:** Disseny mobile-first; la navbar col·lapsa en mòbil; les targetes passen de 3 columnes (desktop) a 1 (mòbil).
- **Efectes CSS:** Animació d'entrada `fade-in-up` en les targetes, transicions en els botons de favorit (cor), hover effects en les targetes.

**Visual:** Captura de pantalla de l'app en mòbil vs desktop (side-by-side).

---

## BLOC 3 — GESTIÓ DE DADES (JSON) (2 diapositives)

---

### Diapositiva 7 — Schema.org JSON-LD: Estructura de Dades
**Contingut:**
- **Estàndard utilitzat:** JSON-LD amb vocabulari Schema.org (SEO semàntic + estructura validable).
- **Tipus principals:**
  - `ItemList` → contenidor de tots els fitxers de dades
  - `MusicGroup` → artistes (amb `member`, `album`, `genre`, `areaServed`)
  - `MusicEvent` → esdeveniments (amb `GeoCoordinates`, `Offer`, `performer`)
  - `Person` → usuaris (perfil Schema.org via `rowToProfile`)
  - `Question` + `Answer` → preguntes del joc (amb `acceptedAnswer`, `associatedMedia`)
- **Hidratació `additionalProperty`:** Els camps com `spotifyId`, `featured`, `archived` es guarden com `PropertyValue` dins `additionalProperty[]` i s'eleva al nivell base de l'objecte JS en `extractItems()`. Si `archived === true`, l'element s'exclou automàticament.
- **Mapeig `areaServed → zone`:** Abstracció interna per uniformitzar el camp geogràfic.

**Visual:** Snippet JSON de `artists.json` amb les parts importants ressaltades.

---

### Diapositiva 8 — Integració de Dades Externes
**Contingut:**
- **`events_extern.json`:** Utilitza el format `@graph` de JSON-LD (no `ItemList`). `loadExternEvents()` el normalitza al vocabulari intern i marca cada event amb `isExtern: true`.
- **Fusió al frontend:** `allEvents = [...events, ...externEvents]` → transparència total per als filtres i el mapa.
- **Badge "Extern":** Els events externs mostren un badge `<i class="bi bi-globe2"> Extern</i>` a la targeta.
- **Caché compartida:** Tant events interns com externs es guarden al mateix `Map` de caché d'`dataLoader.js`.
- **Invalidació per admin:** L'event `admin:contentChanged` buida `dataLoaded = false` i força recàrrega en la pròxima navegació.

---

## BLOC 4 — PROGRAMACIÓ I FUNCIONALITATS (JavaScript) (3 diapositives)

---

### Diapositiva 9 — Arquitectura de Mòduls ES6
**Contingut:**
- **Sense frameworks pesats** (no React, no Vue): Vanilla JS pur amb ES6 Modules (`import/export`).
- **Graf de dependències simplificat:**
  ```
  app.js (entry point)
  ├── router.js          → canvi de vista sense recàrrega
  ├── dataLoader.js      → fetch + caché Map + hidratació Schema.org
  ├── renderer.js        → generació HTML (picture, SVG placeholder)
  ├── filters.js         → filtres multi-criteri (artistes + events)
  ├── mapModule.js       → Leaflet lazy load + SVG markers
  ├── joc.js             → estat joc + 3 fases + media rendering
  ├── favorites.js       → localStorage + CustomEvent
  ├── calendar.js        → generació RFC 5545 (.ics) + Blob URL
  ├── admin.js           → panell admin + checkAuth
  ├── profile.js         → edició de perfil
  ├── solicituds.js      → flux sol·licituds promotor
  └── config.js          → Supabase client + apiFetch (JWT auto)
  ```
- **`apiFetch` helper:** Extreu automàticament el JWT de la sessió Supabase i l'injecta a `Authorization: Bearer …` en cada petició autenticada.

---

### Diapositiva 10 — Funcionalitats Clau: Filtres, DOM i Caché
**Contingut:**
- **Filtres multi-criteri** (`filters.js`):
  - Artistes: text (nom + descripció + gènere), gènere, zona.
  - Events: text (nom + descripció + ubicació + artistes), gènere, zona, categoria, rang de dates (dateFrom / dateTo).
  - Selectors `<select>` generats dinàmicament amb els valors únics presents a les dades.
- **Maneig del DOM:**
  - Generació d'HTML completa via strings de plantilla (`renderer.js`), mai manipulació element per element.
  - `escapeHtml()` usa `div.textContent` del navegador per protegir contra XSS.
  - Modals Bootstrap oberts via `data-bs-toggle` + `onclick="window.showArtistDetail(...)"`.
- **Caché de vistes (`initializedViews`):**
  - Primer accés → inicialitza filtres + listeners. Accessos posteriors → només re-renderitza.
  - Excepció: artistes i events re-renderitzen per actualitzar l'estat dels favorits.

---

### Diapositiva 11 — APIs HTML5: Web Storage, Calendar i Geolocalització
**Contingut:**
- **Web Storage (`localStorage`)** — Mòdul `favorites.js`:
  - Claus: `bauxa_fav_artists` i `bauxa_fav_events` (arrays JSON serialitzats).
  - `toggleFavorite()` dispara `CustomEvent('favoritesChanged')` → el badge del navbar s'actualitza automàticament sense acoblament directe.
- **Calendar API (RFC 5545)** — Mòdul `calendar.js`:
  - Genera fitxers `.ics` compatibles amb Apple Calendar, Google Calendar i Outlook.
  - Usa `Blob + URL.createObjectURL()` + `link.click()` + `URL.revokeObjectURL()` (allibera memòria).
- **Geolocalització (Leaflet + GeoCoordinates Schema.org)**:
  - Les coordenades `geo.latitude / geo.longitude` provenen directament del JSON.
  - `fitBounds({ padding:[30,30], maxZoom:12 })` adapta el zoom als markers visibles.

---

## BLOC 5 — CONTINGUT MULTIMÈDIA I GRÀFICS (2 diapositives)

---

### Diapositiva 12 — Tipus de Media Integrats i Optimització
**Contingut:**
- **Imatges:** Pipeline AVIF → WebP → JPEG amb `<picture><source>`:
  ```html
  <picture>
    <source srcset="artista.avif" type="image/avif">
    <source srcset="artista.webp" type="image/webp">
    <img src="artista.jpg" loading="lazy" fetchpriority="auto">
  </picture>
  ```
  Above-the-fold: `loading="eager" fetchpriority="high"` (millora LCP).
- **SVG Inline:** Logo Hero com SVG inline (LCP zero-latència). Placeholder SVG generat dinàmicament per artistes sense imatge (inicials + color determinista basat en `name.length % 6`).
- **Àudio (Joc):** Fitxers M4A (AAC) a `frontend/assets/audio/`. Reproductor `<audio controls autoplay>` natiu per a accessibilitat (Media Session API del SO).
- **Vídeo (Joc):** `<video controls autoplay playsinline muted>` amb `<source>` WebM → MP4 fallback. `playsinline muted` evita el bloqueig de Safari iOS.
- **Icons:** Bootstrap Icons via CDN carregat de forma asíncrona (`media="print"` → `media="all"`).

**Visual:** Taula visual de formats per tipus de media amb pes/qualitat comparatiu.

---

### Diapositiva 13 — El Joc Musical (SVG Dinàmics + Plataformes Externes)
**Contingut:**
- **3 tipus de preguntes:** Àudio (`AudioObject`), Imatge (`ImageObject`), Vídeo (`VideoObject`) — normalitzats des de Schema.org via `normalizeQuestion()`.
- **Estat centralitzat:** Un únic objecte `gameState` controla totes les fases (`setup → playing → results`).
- **Barreja Fisher-Yates:** Distribució uniformement aleatòria del pool de preguntes.
- **Resolució correcta:** La resposta correcta es desa com a índex numèric (0–3), no com a text → resistent a canvis de contingut.
- **Integració Spotify (plataforma externa):**
  - Badge d'artista amb link directe a `open.spotify.com/artist/{spotifyId}`.
  - Embed iframe de Spotify al modal de detall de l'artista (`loading="lazy"`).
- **Mapa OpenStreetMap** via Leaflet (tiles `tile.openstreetmap.org`): Markers SVG inline amb color per categoria (concert = terracota, festival = or, festa popular = verd).

---

## BLOC 6 — WEB SEMÀNTICA I SEO (1 diapositiva)

---

### Diapositiva 14 — Web Semàntica, JSON-LD i SEO
**Contingut:**
- **JSON-LD complet** per a tots els fitxers de dades:
  - `MusicGroup`, `MusicEvent`, `Person`, `Question`, `Answer`, `MusicAlbum`, `Offer`, `GeoCoordinates`, `PostalAddress`, `Place` → vocabulari Schema.org pur.
  - `eventStatus: "https://schema.org/EventScheduled"`, `eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode"` → bots de Google entenen l'estructura.
- **Estatus d'accions com Schema.org URIs:**
  - Sol·licituds: `PotentialActionStatus` / `CompletedActionStatus` / `FailedActionStatus`.
- **HTML5 semàntic:** `<article>` per a cada targeta, `<section>` per blocs, `<h2>`/`<h3>` correctament jerarquitzats.
- **SEO tècnic:**
  - Etiquetes `<meta name="description">`, `<meta property="og:*">` (Open Graph).
  - URLs amigables via hash (`#artists`, `#events`, `#map`).
  - SVG Hero inline → LCP indexable.
  - Redirect 301 de `donam-bauxa.vercel.app` → `donambauxa.online` (domain authority unificada).

---

## BLOC 7 — ACCESSIBILITAT (1 diapositiva)

---

### Diapositiva 15 — Accessibilitat (WCAG / ARIA)
**Contingut:**
- **Atributs ARIA implementats:**
  - `aria-label` en tots els botons d'icona (favorit, calendari, detalls).
  - `aria-live="polite"` al HUD de puntuació del joc (anuncis dinàmics per lectors de pantalla).
  - `role="progressbar"` + `aria-valuenow/min/max` a la barra de progrés del joc.
  - `role="group"` + `aria-label` als grups de botons d'opcions.
  - `aria-disabled="true"` en botons desactivats per compatibilitat.
- **Focus management:** Quan l'usuari respon una pregunta, `nextBtn.focus()` mou el focus automàticament.
- **Textos alternatius:** Totes les imatges i SVG placeholder inclouen `alt` descriptiu.
- **Àudio natiu:** `<audio controls>` delega al sistema operatiu (accessible per a lectors de pantalla via Media Session API).
- **Vídeo:** `<video controls>` amb `aria-label="Clip de vídeo per endevinar"`.
- **Navegació:** Estructura `<header>/<main>/<footer>` permet navegació ràpida per tecla Tab.

---

## BLOC 8 — TESTING, RENDIMENT I OPTIMITZACIONS (2 diapositives)

---

### Diapositiva 16 — Rendiment i Core Web Vitals
**Contingut:**
- **LCP (Largest Contentful Paint):** Logo SVG Hero inline → temps de càrrega 0ms (ja parsejat amb el HTML).
- **CLS (Cumulative Layout Shift):** Skeleton loaders amb `height` fix per a tots els grids → reserva l'espai mentre carreguen les targetes.
- **TTI (Time to Interactive):**
  - `<link rel="modulepreload">` per als mòduls JS crítics.
  - CSS de Bootstrap Icons carregat asíncronament (`media="print"` → `media="all"`).
  - `<link rel="preconnect">` per a tots els CDNs (Supabase, Bootstrap, Google Fonts, Leaflet).
- **DNS Prefetch:** Preconnect als dominis externs avança la resolució TLS.
- **Imatges lazy:** `loading="lazy"` en totes les imatges below-the-fold; `fetchpriority="high"` per als events destacats de la portada.
- **Mapa Leaflet:** Carregat sota demanda (primera visita a `#map`), mai en el carregament inicial.

**Visual:** Captura del resultat de Lighthouse / PageSpeed Insights.

---

### Diapositiva 17 — Proves Funcionals i Eines d'Avaluació
**Contingut:**
- **Casos de prova principals:**
  - Filtres: combinació de múltiples criteris simultanis (text + gènere + zona + data).
  - Joc: selecció correcta/incorrecta, barra de progrés, pantalla de resultats, "Jugar de nou".
  - Favorits: afegir/treure favorit → badge navbar s'actualitza, vista Favorits reflecteix canvis.
  - Exportació ICS: descàrrega del fitxer i importació a Google Calendar verificada.
  - Admin: CRUD complet (crear, editar, arxivar, esborrar) per a artistes, events i notícies.
  - Auth: login Google → rol `lector` assignat; canvi de rol des d'admin → efecte immediat.
- **Eines utilitzades:**
  - **Lighthouse** → Core Web Vitals + accessibilitat.
  - **WAVE / Axe** → errors d'accessibilitat.
  - **DevTools Network** → verificació de caché (0 peticions duplicades en navegació repetida).
- **Carga asíncrona:** `Promise.all([loadArtists(), loadEvents(), loadNews(), loadExternEvents()])` → totes les dades en paral·lel al primer accés.

---

## BLOC 9 — CONTROL DE VERSIONS I DESPLEGAMENT (1 diapositiva)

---

### Diapositiva 18 — Git, Vercel i Desplegament en Producció
**Contingut:**
- **Control de versions:** Git + GitHub, branca `main` com a branca de producció.
- **Desplegament Vercel:**
  - `vercel.json`: totes les rutes passen per `server.js` (`"src":"/(.*)", "dest":"/server.js"`).
  - Deploy automàtic en cada push a `main`.
  - Variables d'entorn configurades al dashboard de Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NODE_ENV=production`.
- **Redirect 301:** `donam-bauxa.vercel.app` → `donambauxa.online` (consolida el domain authority per SEO).
- **Sistema de fitxers Vercel (EROFS):** En producció el filesystem és de només lectura → les escriptures JSON fallen silenciosament (capturat amb `try/catch`, no crash del servidor). Limitació coneguda del sistema de desplegament serverless.
- **Entorn local de dev:** Mock automàtic de Supabase quan `SUPABASE_URL` no és definit → `role: 'admin'` per defecte, sense configuració addicional.

---

## BLOC 10 — SEGURETAT (1 diapositiva)

---

### Diapositiva 19 — Seguretat: HTTPS, JWT, CORS i XSS
**Contingut:**
- **HTTPS:** Certificat TLS gestionat per Vercel automàticament. `app.set('trust proxy', 1)` per llegir IPs reals a través del proxy.
- **Autenticació JWT doble verificació:**
  1. `supabase.auth.getUser(token)` → verifica signatura JWT i caducitat.
  2. `SELECT * FROM users WHERE id = ?` → comprova el rol actual a la DB. Un token d'admin amb rol canviat a lector → `403 Forbidden`.
- **CORS whitelist explícita:** Només `donambauxa.online`, `www.donambauxa.online` i `localhost`. Preflight `OPTIONS` → `204 No Content`.
- **SRI (Subresource Integrity):** Leaflet carregat amb hash `sha256-…` → protecció contra supply chain attacks des del CDN.
- **XSS Protection:** `escapeHtml()` usa `div.textContent` del navegador per escapar tot el text dinàmic injectat al DOM.
- **Mutex Lock (concurrència):** `withLock(filePath, fn)` prevé escriptures concurrents corruptes al JSON (busy-wait de 50ms).
- **Gestió de sessió:** Token JWT guardat per Supabase a `localStorage`; `onAuthStateChange` detecta canvis de sessió en temps real.

---

## BLOC 11 — AUTOEVALUACIÓ I RESULTATS (1 diapositiva)

---

### Diapositiva 20 — Autoevaluació, Limitacions i Nota Proposada
**Contingut:**

**Objectius assolits:**
- SPA completa amb 9 vistes i routing hash-based sense recàrrega de pàgina.
- Joc musical amb 3 formats multimèdia (àudio, imatge, vídeo) i Schema.org.
- Sistema d'autenticació complet (OAuth Google + JWT + rols) amb 0 dependencies de cookies.
- CRUD d'administració per a 5 tipus d'entitats amb mutex lock per a escriptura concurrent.
- Pipeline d'imatges AVIF/WebP/JPEG automàtic, Core Web Vitals optimitzats.
- Accessibilitat ARIA completa, exportació ICS, mapa geolocalitzat amb Leaflet.

**Limitacions trobades:**
- Vercel EROFS → les escriptures de JSON no es persisteixen en producció (sistema serverless read-only).
- Leaflet requereix un delay de 50ms per al reflow del DOM en cada visita al mapa.
- El joc musical no guarda puntuacions a la base de dades (persistència local no implementada).

**Funcionalitats pendents o millores futures:**
- Migrar la persistència de dades a Supabase Database (eliminar els JSONs locals).
- Implementar historial de partides del joc per usuari.
- Afegir PWA (Service Worker + manifest) per a ús offline.
- Internacionalització (i18n) per a turistes en anglès o castellà.

**Nota proposada: 9.5 / 10**
> Justificació: El projecte supera els requisits bàsics en totes les dimensions (multimèdia, semàntica, accessibilitat, seguretat, rendiment). Incorpora funcionalitats avançades no exigides (OAuth, mutex concurrent, SRI, Schema.org complet, pipeline AVIF, doble verificació JWT). La limitació principal (EROFS) és inherent a l'arquitectura serverless de Vercel, no un error de desenvolupament. Penalització de 0.5 per la manca de persistència de puntuacions del joc.

---

## RESUM — Ordre i Temporització Recomanada

| # | Diapositiva | Bloc | Temps estimat |
|---|-------------|------|--------------|
| 1 | Portada | Intro | 30s |
| 2 | Objectiu i Abast | Intro | 1 min |
| 3 | Arquitectura General | Arquitectura | 2 min |
| 4 | Estructura de Fitxers | Arquitectura | 1.5 min |
| 5 | Navegació SPA | Frontend | 2 min |
| 6 | HTML5, CSS, Responsiu | Frontend | 1.5 min |
| 7 | Schema.org JSON-LD | Dades | 2 min |
| 8 | Dades Externes | Dades | 1 min |
| 9 | Arquitectura Mòduls JS | JS | 1.5 min |
| 10 | Filtres, DOM, Caché | JS | 2 min |
| 11 | APIs HTML5 | JS | 1.5 min |
| 12 | Media: Imatges, SVG, Àudio, Vídeo | Multimèdia | 2 min |
| 13 | Joc Musical + Spotify/Mapa | Multimèdia | 2 min |
| 14 | Web Semàntica i SEO | Semàntica | 1.5 min |
| 15 | Accessibilitat ARIA | Accessibilitat | 1.5 min |
| 16 | Rendiment i Core Web Vitals | Testing | 2 min |
| 17 | Proves Funcionals | Testing | 1.5 min |
| 18 | Git i Vercel | Desplegament | 1 min |
| 19 | Seguretat | Seguretat | 1.5 min |
| 20 | Autoevaluació i Nota | Autoevaluació | 1.5 min |
| **Total** | **20 diapositives** | | **~30 min** |

---

> **Notes per a la presentació en viu:**
> - A la diapositiva 12 (Media), obrir la demo del Joc Musical en directe al navegador.
> - A la diapositiva 3 (Arquitectura), es pot mostrar el `server.js` i el `vercel.json` oberts al codi.
> - A la diapositiva 16 (Rendiment), mostrar el report de Lighthouse generat (`report.json` ja inclòs al repositori).
> - Preparar una sessió activa de Google per demostrar el flux de login OAuth en viu.
