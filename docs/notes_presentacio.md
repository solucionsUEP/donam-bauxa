# Notes de Presentació — Dona'm Bauxa
> Explicació detallada de tots els conceptes, acrònims i decisions tècniques per a cada diapositiva

---

## Diapositiva 1 — Portada

**Dona'm Bauxa** és una expressió mallorquina que significa "dóna'm festa / dóna'm alegria". El nom reflecteix la temàtica de l'app: descobrir l'escena musical i festiva de Mallorca.

**P3** = tercera presentació d'avaluació contínua de l'assignatura Tecnologia Multimèdia. Les tres presentacions són: P1 (disseny gràfic), P2 (prototip funcional), P3 (pràctica final completa).

**donambauxa.online** és el domini personalitzat on l'aplicació és accessible en producció. No és un domini de Vercel sinó un domini propi registrat i configurat per apuntar al deploy de Vercel.

---

## Diapositiva 2 — Objectiu i Abast

### WebApp SPA
**SPA** = *Single Page Application* (Aplicació d'Una Sola Pàgina).

En una web tradicional, cada pàgina (artistes, events, mapa...) seria un fitxer HTML diferent i el navegador faria una petició HTTP nova per a cada una, recol·locant tota la pàgina. En una SPA, hi ha un únic fitxer `index.html` i JavaScript s'encarrega de canviar el contingut visible sense recarregar. L'efecte per a l'usuari és una navegació molt més ràpida i fluida, similar a una app nativa.

A Dona'm Bauxa hi ha exactament **un fitxer HTML** (`frontend/index.html`) amb 9 seccions `<div data-view="...">` — una per vista — i el router JS mostra/amaga la correcta en cada moment.

### Les 6 funcionalitats
- **Catàleg d'artistes amb filtres** → `#artists`, mòdul `filters.js` + `renderer.js`
- **Agenda + Mapa Leaflet** → `#events` i `#map`, mòdul `mapModule.js`
- **Joc musical (3 formats)** → `#joc`, mòdul `joc.js` amb Schema.org `AudioObject`/`ImageObject`/`VideoObject`
- **Gestió d'usuaris i rols** → Supabase + `middleware/auth.js`, rols: `lector`, `promotor`, `admin`
- **Exportació .ics** → `calendar.js`, format RFC 5545 compatible amb Apple Calendar, Google Calendar, Outlook
- **Favorits** → `favorites.js`, `localStorage` del navegador, sense necessitat de compte d'usuari

### Schema.org
Estàndard de dades semàntiques creat per Google, Bing i Yahoo per estructurar el contingut de la web de manera que els motors de cerca el puguin entendre. S'explica en detall a la diapositiva 7.

### OAuth Google
Protocol d'autorització delegada. En lloc de demanar una contrasenya pròpia, la plataforma delega la verificació d'identitat a Google. L'usuari no crea una contrasenya nova: s'autentica amb el compte de Google que ja té.

---

## Diapositiva 3 — Arquitectura General

### Stack tècnic

**Vanilla JS ES6 Modules**
*Vanilla JS* = JavaScript pur, sense cap framework com React, Vue o Angular. *ES6* (ECMAScript 2015, la versió 6 de l'estàndard JavaScript) va introduir els *Modules*: un sistema per dividir el codi en fitxers independents (`import`/`export`). Cada mòdul té el seu propi scope (les variables no es contaminen entre fitxers). A Dona'm Bauxa, cada fitxer a `frontend/js/modules/` és un mòdul ES6 independent.

**Bootstrap 5.3.3**
Framework CSS de codi obert (Twitter, 2011). Proporciona un sistema de grid responsive, components visuals pre-dissenyats (modals, navbar, badges, botons) i JavaScript per a interaccions. El *5.3.3* indica la versió estable usada.

**Node.js `type:module`**
*Node.js* és un entorn d'execució de JavaScript al costat del servidor (fora del navegador). Normalment Node usa el sistema de mòduls antic (`require()`/`module.exports`). La propietat `"type":"module"` al `package.json` activa el suport natiu per a `import`/`export` d'ES6, el mateix sistema que s'usa al frontend. Dona'm Bauxa usa aquest sistema a tota la capa de servidor.

**Express 4**
Framework minimalista per crear servidors HTTP amb Node.js. Simplifica la creació de rutes (`app.get('/api/...')`, `app.post('/api/...')`), middleware i servei de fitxers estàtics. La versió 4 és l'estable actual.

**Supabase (PostgreSQL + GoTrue JWT)**
*Supabase* és un servei BaaS (*Backend as a Service*) de codi obert. Proporciona:
- Una base de dades **PostgreSQL** (relacional, SQL) per guardar usuaris i sol·licituds.
- Un servei d'autenticació basat en **GoTrue**: gestiona l'OAuth amb Google i emet tokens **JWT** (JSON Web Token) per a cada sessió.

**JWT** (JSON Web Token): token signat digitalment format per tres parts separades per `.`: `header.payload.signature`. El servidor el verifica matemàticament sense consultar cap base de dades → autenticació *stateless* (sense estat al servidor).

**Vercel Serverless**
Plataforma de desplegament que executa el codi en *funcions Lambda* (funcions que s'activen per peticions HTTP i s'apaguen quan acaben). No hi ha un servidor dedicat encès contínuament. Avantatge: pagar 0€ sense tràfic. Desavantatge: el filesystem és de lectura (EROFS, explicat a la diapositiva 18).

### Flux de comunicació
El navegador fa dos tipus de peticions:
1. **`fetch` JSON estàtics** → descarrega els fitxers `data/artists.json`, `data/events.json`... directament sense autenticació.
2. **`fetch /api/*` (JWT)** → peticions autenticades al backend per a operacions d'admin, perfil, sol·licituds. El JWT viatja a la capçalera `Authorization: Bearer {token}`.

---

## Diapositiva 4 — Estructura de Fitxers i Carpetes

### Backend (esquerra, blau)
- **`server.js`**: punt d'entrada del servidor. Configura Express, CORS i el redirect 301 de Vercel al domini oficial.
  - **CORS** (*Cross-Origin Resource Sharing*): política de seguretat del navegador que bloqueja peticions HTTP a dominis diferents. `server.js` afegeix les capçaleres `Access-Control-Allow-Origin` per als dominis permesos.
  - **301**: codi HTTP de redirect permanent. Indica al navegador i als bots de Google que el recurs s'ha mogut de manera permanent.
- **`vercel.json`**: fitxer de configuració de Vercel. Indica que totes les rutes han de passar per `server.js`.
- **`routes/content.js`**: implementa el **CRUD** (*Create, Read, Update, Delete*) genèric per a artistes, events, notícies, preguntes i qüestionaris.
- **`middleware/auth.js`**: doble verificació del JWT. S'interposa entre la petició i la ruta per verificar identitat i rol.
  - **Middleware**: funció que s'executa entre la petició HTTP i la resposta. A Express, `app.use(fn)` registra un middleware global.
- **`helpers/json.js`**: mòdul que implementa el **Mutex Lock** per evitar corrupcions en escriptures concurrents als fitxers JSON.
- **`helpers/supabase.js`**: inicialitza el client de Supabase. Si les variables d'entorn no estan definides, retorna un **mock** (objecte fals) per al desenvolupament local.

### Frontend (dreta, verd/taronja)
- **`index.html`**: l'únic fitxer HTML de tota l'aplicació. Tota la UI es genera dins d'ell.
- **`app.js` (entry point)**: mòdul JS principal. S'executa quan el DOM és llest (`DOMContentLoaded`) i orquestra tota l'app.
- **`router.js`**: el *hash-based router* que gestiona la navegació per `#hash`.
- **`config.js`**: inicialitza el client de Supabase al frontend i exposa `apiFetch`, un wrapper de `fetch()` que injecta automàticament el JWT.
- **`data/` → JSON Schema.org**: els 5 fitxers de dades estructurades (`artists.json`, `events.json`, `news.json`, `questions.json`, `questionnaires.json`).
- **`assets/` → AVIF/WebP/M4A**: cada artista té 3 imatges del mateix arxiu en 3 formats (AVIF, WebP, JPEG). L'àudio del joc és en format M4A.

---

## Diapositiva 5 — Navegació SPA i Diagrama de Vistes

### Rutes hash-based
La URL `donambauxa.online/#artists` conté un **fragment** (`#artists`). El navegador **no envia el fragment al servidor** en fer una petició HTTP — el fragment és purament client-side. Això permet que el router JS canviï la "pàgina" visible sense que el servidor sàpiga res. Cada canvi de fragment dispara l'event natiu `hashchange` del navegador.

Comparació:
- URL tradicional: `donambauxa.online/artists` → el servidor rep la petició, retorna un HTML diferent.
- URL hash: `donambauxa.online/#artists` → el servidor no rep res, JS fa el canvi de vista.

A Dona'm Bauxa, el `router.js` escolta `window.addEventListener('hashchange', ...)` i crida `switchView(viewName)`, que oculta tots els `<div data-view="...">` i en mostra només el corresponent.

### `initializedViews` (Set)
Un **`Set`** és una estructura de dades de JavaScript similar a un array però que **no admet duplicats**. `initializedViews.has('artists')` comprova si la vista ja ha estat inicialitzada.

**Per què és necessari?** Si cada vegada que l'usuari visita `#artists` es criden `addEventListener('input', renderArtistsGrid)`, es registren múltiples listeners del mateix event. Cada keystroke al cercador enviaria la crida `renderArtistsGrid` tantes vegades com vegades s'hagi visitat la pàgina. Amb `initializedViews`, els listeners es registren **una sola vegada**.

### `mapCleanup()`
Leaflet guarda la referència al contenidor HTML del mapa internament. Si l'usuari visita `#map`, marxa a `#artists` i torna a `#map`, Leaflet intenta crear un nou mapa al mateix `<div id="map">` que ja conté una instància. Sense cleanup, llança l'error `Map container is already initialized`. `mapCleanup()` crida `leafletMap.remove()` quan l'usuari abandona la vista del mapa, destruint completament la instància i alliberant els event listeners.

### Navbar + modals
Bootstrap gestiona el navbar en mòbil amb un sistema de collapse (s'amaga/mostra en clicar el botó "hamburguesa"). Bootstrap també gestiona els modals. Si l'usuari clica un link del navbar mentre un modal és obert, o en mòbil amb el menú obert, el router **força el tancament programàtic** amb:
- `bootstrap.Collapse.getInstance(el)` → retorna la instància del collapse, permet cridar `.hide()`.
- `bootstrap.Modal.getInstance(el)` → retorna la instància del modal, permet cridar `.hide()`.

---

## Diapositiva 6 — HTML5, CSS i Disseny Responsiu

### HTML5 Semàntic
HTML5 (2014) va introduir etiquetes amb **significat semàntic** en lloc d'usar `<div>` per a tot:
- `<header>`: capçalera de la pàgina o secció.
- `<nav>`: bloc de navegació (menú).
- `<main>`: contingut principal únic de la pàgina.
- `<article>`: contingut independent i autosuficient (cada targeta d'artista o event és un `<article>`).
- `<section>`: agrupació temàtica de contingut.
- `<footer>`: peu de pàgina o secció.

**Per què importa?** Els lectors de pantalla (per a persones cegues) usen l'estructura semàntica per navegar la pàgina. Els bots de Google entenen millor el contingut. I el codi és més llegible per als desenvolupadors.

A Dona'm Bauxa: `renderArtistCard()` genera `<article class="card-bauxa artist-card">` i `renderEventCard()` genera `<article class="card-bauxa">`, tots ells semànticament correctes.

### Bootstrap 5.3.3
**Grid `col-md-6 col-lg-4`**: Bootstrap usa un sistema de **12 columnes**. Les classes s'interpreten:
- `col-md-6` → a mides **md** (≥768px, tablets): l'element ocupa 6 de 12 columnes = 2 per fila.
- `col-lg-4` → a mides **lg** (≥992px, desktop): l'element ocupa 4 de 12 columnes = 3 per fila.
- Sense classe (< 768px, mòbil): per defecte ocupa 12 de 12 = 1 per fila.

Resultat: la grid de targetes d'artistes passa automàticament de 1 columna (mòbil) → 2 columnes (tablet) → 3 columnes (desktop) **sense una línia de CSS propi**.

**`bootstrap.Modal.getInstance()`**: la instància és un objecte JavaScript que Bootstrap crea internament en obrir un modal. `getInstance()` permet recuperar-la per cridar `.hide()` programàticament.

### CSS propi
**Variables CSS natives (`--color-primary`)**: introduïdes a CSS3, permeten definir valors reutilitzables. Es declaren amb `--` i s'usen amb `var(--color-primary)`. Canviar el valor en un lloc actualitza tots els elements que l'usen.

**`animate-fade-in-up`**: classe CSS d'animació personalitzada. Usa `@keyframes` per animar `opacity` (de 0 a 1) i `transform: translateY` (de 10px cap amunt a 0px). S'aplica a cada targeta quan es renderitza.

**Skeleton loaders**: blocs `<div>` grisos amb dimensions fixes que apareixen mentre les dades carreguen. Preveuen el **CLS** (*Cumulative Layout Shift*, diapositiva 16).

### Mobile-First
L'estratègia de disseny de Bootstrap comença des del mòbil (les pantallas més petites) i afegeix complexitat amb *media queries* per a pantalles més grans. Avantatge: forçar pensar primer en l'essencial, el contingut prioritari.

---

## Diapositiva 7 — Schema.org JSON-LD: Estructura de Dades

### JSON-LD
**JSON** (*JavaScript Object Notation*): format lleuger d'intercanvi de dades, llegible per humans i per màquines. Exemple: `{"name": "Antonia Font"}`.

**LD** (*Linked Data*): extensió de JSON per connectar dades a vocabularis estàndard externs. **JSON-LD** és el format preferit per Google per a dades estructurades.

**Com funciona?** L'atribut `"@context": "https://schema.org"` declara que els noms dels camps (`name`, `genre`, `startDate`...) segueixen les definicions del vocabulari Schema.org. Google llegeix aquest context per entendre que `name` és el nom oficial de l'entitat, no un camp qualsevol.

### Schema.org
Vocabulari estàndard creat el 2011 per Google, Microsoft, Yahoo i Yandex. Defineix centenars de *tipus* (`MusicGroup`, `MusicEvent`, `Person`, `Question`...) i les seves *propietats* (`name`, `startDate`, `performer`...). Permet que els bots de cerca entenguin el contingut de qualsevol web del món independentment de la llengua o l'estructura.

**Relació amb el projecte**: tots els fitxers `frontend/data/*.json` segueixen Schema.org. `artists.json` és un `ItemList` de `MusicGroup`, `events.json` és un `ItemList` de `MusicEvent`.

### Tipus principals usats

**`ItemList`**: contenidor estàndard per a llistes d'elements. Té `itemListElement[]`, on cada element és un `ListItem` amb `position` (l'ordre) i `item` (l'objecte real). El backend usa `position` per mantenir l'ordre i generar IDs.

**`MusicGroup`**: grup musical. Propietats: `member[]` (llista de `Person`), `album[]` (llista de `MusicAlbum`), `genre[]`, `foundingDate`, `areaServed` (zona geogràfica).

**`MusicEvent`**: concert, festival o festa popular. Propietats: `startDate`/`endDate` (ISO 8601), `location` (un `Place` amb `GeoCoordinates`), `performer` (un `MusicGroup`), `offers` (un `Offer` amb preu i URL de compra).

**`Question` + `Answer`**: preguntes del joc. `suggestedAnswer[]` conté les opcions A/B/C/D. `acceptedAnswer` referencia per `@id` quina és la correcta.

### `additionalProperty` → `PropertyValue`
Schema.org és un vocabulari estàndard: no pot tenir una propietat per a *cada possible concepte* de cada projecte. Per afegir propietats personalitzades (`spotifyId`, `featured`, `archived`), s'usa l'array `additionalProperty[]` on cada element és un `PropertyValue` amb `name` i `value`.

**Hidratació a `extractItems()`**: en llegir els JSON, `dataLoader.js` itera `additionalProperty[]` i *eleva* cada `PropertyValue` al nivell base de l'objecte JS: `item.spotifyId = "503mwh..."`. D'aquesta manera, la resta del codi pot usar `artist.spotifyId` directament sense navegar l'estructura niada.

**Filtre `archived === true`**: si `additionalProperty` conté `{name:"archived", value:true}`, `extractItems()` retorna `false` al `.filter()` i l'element s'exclou del resultat visible al frontend.

---

## Diapositiva 8 — Integració de Dades Externes

### Format `@graph`
**JSON-LD** permet dos formats per a llistes:
1. **`ItemList`**: format propi del projecte Dona'm Bauxa, amb `position` i `ListItem` per a cada element.
2. **`@graph`**: llista plana de JSON-LD on cada element és un objecte independent amb el seu `@id` i `@type`. Format més comú en fonts externes.

`events_extern.json` usa `@graph` (format dels events d'altres grups del curs). `loadExternEvents()` el normalitza al vocabulari intern, afegint camps que falten (`zone`, `category`, `isExtern: true`).

### Spread operator (`...`) — fusió d'arrays
```javascript
allEvents = [...events, ...externEvents];
```
L'operador **spread** (`...`) de ES6 "desempaqueta" els elements d'un array. `[...A, ...B]` crea un nou array amb tots els elements d'A seguits de tots els de B. És equivalent a `A.concat(B)` però més llegible.

Resultat: `allEvents` és un únic array amb tots els events (interns + externs) que els filtres, el mapa i el calendari consumeixen sense distingir l'origen.

### `isExtern: true`
Flag booleà que `loadExternEvents()` afegeix a cada event extern. `renderer.js` el comprova per mostrar el badge:
```javascript
event.isExtern ? '<span class="badge-extern">Extern</span>' : ''
```

### `Map` de JavaScript (caché)
`Map` és una estructura de dades de JS (no el mapa geogràfic) que emmagatzema parelles clau-valor. A diferència d'un objecte `{}`, les claus poden ser qualsevol tipus. `dataLoader.js` usa `new Map()` com a caché: `cache.set('data/artists.json', data)` i `cache.get('data/artists.json')`. La primera crida fa `fetch()`, les posteriors retornen el valor cached directament.

### `admin:contentChanged` (Custom Event)
Quan l'admin crea, modifica o elimina un element, `admin.js` dispara:
```javascript
document.dispatchEvent(new CustomEvent('admin:contentChanged'))
```
`app.js` escolta aquest event i reseteja `dataLoaded = false` i buida `initializedViews`. La pròxima navegació de l'usuari força una nova càrrega de dades actualitzades.

---

## Diapositiva 9 — Arquitectura de Mòduls ES6

### ES6 Modules
Sistema de mòduls **natiu de JavaScript** (no cal Webpack ni bundler per a l'ús bàsic). Cada fitxer `.js` és un mòdul amb el seu propi *scope* (les variables no es filtren entre mòduls). S'exporten funcions/variables amb `export` i s'importen amb `import`.

**Diferència amb l'antiga manera** (`<script>` globals): amb scripts globals, totes les variables viuen al `window` i qualsevol fitxer pot sobreescriure qualsevol variable. Amb ES Modules, cada mòdul té el seu espai privat.

**Avantatge de Vanilla JS** vs frameworks: un bundle de React/Vue pesa 200-500KB mínims. Dona'm Bauxa no té cap framework al frontend → càrrega inicial molt més lleugera.

### `apiFetch` helper (config.js)
Totes les peticions autenticades al backend usen `apiFetch(url, options)` en lloc de `fetch()` directament. La funció:
1. Crida `supabase.auth.getSession()` per obtenir la sessió activa.
2. Extreu el `access_token` (el JWT) de la sessió.
3. Afegeix la capçalera `Authorization: Bearer {token}` a totes les peticions.

**`async/await`**: sintaxi de JavaScript per manejar operacions asíncrones (que triguen un temps: peticions de xarxa, lectures de fitxer...). `await` pausa l'execució de la funció fins que la promesa es resol, sense bloquejar el fil principal. Alternativa més llegible a les promeses encadenades amb `.then()`.

**`Authorization: Bearer {token}`**: format estàndard HTTP (RFC 6750) per enviar tokens d'accés. `Bearer` indica que el token és el propi portador d'autoritat, sense necessitat de cap secret addicional.

### RFC 5545
**RFC** (*Request for Comments*): documents tècnics de l'IETF (*Internet Engineering Task Force*, l'organisme que defineix els estàndards d'Internet). L'**RFC 5545** defineix el format **iCalendar** (fitxers `.ics`) que Apple Calendar, Google Calendar i Outlook entenen per importar events de calendari.

### Blob (Binary Large Object)
API del navegador que representa dades binàries en memòria (similar a un fitxer virtual). `new Blob([text], {type:'text/calendar'})` crea un fitxer `.ics` en memòria. `URL.createObjectURL(blob)` genera una URL temporal (`blob:https://...`) que el navegador pot "descarregar" com si fos un fitxer real al servidor.

---

## Diapositiva 10 — Filtres, DOM i Caché de Vistes

### DOM (Document Object Model)
Representació en memòria de l'estructura HTML d'una pàgina. El navegador llegeix l'HTML i el converteix en un arbre de nodes JavaScript accessibles i modificables. `document.getElementById('artistsGrid')` retorna el node del DOM corresponent a `<div id="artistsGrid">`.

**Generació d'HTML via strings de plantilla**: en lloc de modificar el DOM node per node (`el.appendChild(...)`, `el.textContent = ...`), `renderer.js` genera un string d'HTML complet i l'injecta amb `container.innerHTML = htmlString`. Molt més eficient per a llistes grans perquè el navegador processa tot en un sol reflow del DOM.

### `filterEvents()` — lògica de filtrat
La funció usa `Array.prototype.filter()`, un mètode natiu d'arrays que retorna **un nou array** (no modifica l'original) amb els elements que passen el test de la funció callback.

- **`?.some()`**: *optional chaining* (`?.`) + `Array.some()`. `?.` evita errors si el camp és `null` o `undefined`. `some()` retorna `true` si **almenys un** element del array compleix la condició.
- **`?.toLowerCase().includes(text)`**: normalitza a minúscules per fer la cerca *case-insensitive* (insensible a majúscules/minúscules).
- **Rang de dates**: `new Date(event.startDate)` crea un objecte `Date` de JavaScript des d'un string ISO 8601 (`"2026-03-07T21:00:00+01:00"`). Els objectes `Date` es comparen directament amb `<` i `>=`.

### `escapeHtml()` — protecció XSS
**XSS** (*Cross-Site Scripting*): atac on un atacant injecta codi JavaScript maliciós a una pàgina web que el mostra a altres usuaris. Exemple: si un artista té `name: "<script>alert('hackeado')</script>"` i el fem servir directament amb `container.innerHTML = artist.name`, el navegador executaria el script.

`escapeHtml()` usa `div.textContent = str` (el navegador escapa automàticament tots els caràcters especials) i llegeix `div.innerHTML` (que retorna el text ja escapat: `<` → `&lt;`, `>` → `&gt;`). Tota la generació d'HTML a `renderer.js` i `joc.js` passa per aquesta funció.

### `initializedViews` (Set) — prevenció de listeners duplicats
Problema concret: `initArtists()` afegeix `document.getElementById('searchArtists').addEventListener('input', renderArtistsGrid)`. Si l'usuari visita `#artists` 5 vegades i no hi ha guàrdia, s'acumulen 5 listeners i cada keystroke crida `renderArtistsGrid` 5 vegades.

Solució: `if (initializedViews.has('artists')) { renderArtistsGrid(); return; }`. La primera vegada passa, afegeix els listeners i marca 'artists' com inicialitzada. Les visites posteriors re-renderitzen (per actualitzar favorits) però no re-registren listeners.

---

## Diapositiva 11 — APIs HTML5: Web Storage, Calendar i Geolocalització

### Web Storage API — `localStorage`
**Web Storage** és una API del navegador (HTML5) per guardar dades de manera persistent al dispositiu de l'usuari, sense necessitat de servidor ni base de dades.

Té dos variants:
- **`localStorage`**: persistent, no expira quan es tanca el navegador. A Dona'm Bauxa s'usa per guardar favorits.
- **`sessionStorage`**: s'esborra en tancar la pestanya. No s'usa al projecte.

**`localStorage.setItem('clau', JSON.stringify(ids))`**: `setItem` només accepta strings, per això `JSON.stringify()` converteix l'array `["artist-1", "artist-3"]` al string `'["artist-1","artist-3"]'`. En llegir, `JSON.parse(localStorage.getItem('clau'))` el converteix de nou a array.

Claus usades: `bauxa_fav_artists` (IDs d'artistes favorits) i `bauxa_fav_events` (IDs d'events favorits).

### `CustomEvent('favoritesChanged')` — comunicació desacoblada
**Problema**: quan l'usuari marca un favorit, cal actualitzar: el botó de cor de la targeta, el badge del navbar amb el comptador, i la vista `#favorits`. Si `favorites.js` importés directament `ui.js` i `app.js` per actualitzar-los, crearíem **dependències circulars** (A importa B que importa A → error).

**Solució**: `favorites.js` dispara un `CustomEvent` global al `window`. Qualsevol mòdul que necessiti reaccionar-hi (com `ui.js` per al badge) s'hi subscriu amb `window.addEventListener('favoritesChanged', callback)`. `favorites.js` no sap ni li importa qui l'escolta.

### Calendar RFC 5545 — `.ics`
**RFC 5545** (2009, IETF): estàndard que defineix el format **iCalendar**. Els fitxers `.ics` que genera `calendar.js` contenen:
- `VCALENDAR`: contenidor del fitxer.
- `VEVENT`: un event específic amb `DTSTART`/`DTEND` (en format `YYYYMMDDTHHMMSSZ`), `SUMMARY` (nom), `LOCATION`, `UID` (identificador únic: `event-2@donamBauxa`).
- El separador de línies **ha de ser CRLF** (`\r\n`), no LF (`\n`). `calendar.js` usa `.join('\r\n')` per complir l'estàndard.

**Pattern Blob + `URL.createObjectURL`**: el fitxer `.ics` no existeix al servidor. Es genera en memòria al client, es crea una URL temporal i es simula un clic a un `<a download>` per iniciar la descàrrega. `URL.revokeObjectURL(url)` allibera la referència de memòria un cop fet el clic, evitant una **memory leak** (fuita de memòria: recursos reservats que no s'alliberen mai).

### Geolocalització Leaflet — `fitBounds`
Les coordenades geogràfiques (`geo.latitude`, `geo.longitude`) provenen directament del JSON Schema.org de cada event (`GeoCoordinates`). Leaflet usa aquests valors per posicionar els markers.

`map.fitBounds(bounds, { padding:[30,30], maxZoom:12 })`:
- `bounds`: el rectangle que engloba tots els markers visibles, calculat automàticament per `markerLayer.getBounds()`.
- `padding:[30,30]`: marge de 30px als costats per no tallar els markers de la vora.
- `maxZoom:12`: evita que el zoom sigui excessiu si tots els events estan al mateix barri de Palma.

---

## Diapositiva 12 — Tipus de Media Integrats i Optimització

### Pipeline AVIF → WebP → JPEG

**AVIF** (*AV1 Image File Format*): format d'imatge modern (2019) basat en el còdec de vídeo AV1. Ofereix fins a un **50% menys de mida** que JPEG amb la mateixa qualitat visual. Suportat per Chrome, Firefox i Edge (2021+). Encara no per Safari fins iOS 16.

**WebP**: format creat per Google (2010). Entre **25-35% menys de mida** que JPEG. Suportat per tots els navegadors moderns des de 2020. Fallback per als navegadors que no suporten AVIF.

**JPEG**: format d'imatge estàndard (1992). Universal, però el menys eficient dels tres. Fallback final per a navegadors antics.

L'etiqueta HTML5 `<picture>` amb `<source>` permet especificar múltiples formats: el navegador prova el primer (`image/avif`), si no el suporta prova el segon (`image/webp`), i finalment usa `<img src="artista.jpg">` com a fallback. **Un sol element HTML gestiona automàticament 3 formats** sense JavaScript.

**Implicació pràctica**: cada artista té 3 fitxers d'imatge a `frontend/assets/images/artists/` (`artista.avif`, `artista.webp`, `artista.jpg`). `renderer.js` a `generatePictureElement()` deriva les rutes AVIF i WebP eliminant l'extensió de la ruta JPEG i afegint les noves.

### `loading="lazy"` i `fetchpriority="high"`
- **`loading="lazy"`**: atribut HTML5 natiu que retarda la càrrega d'una imatge fins que entra al viewport (la part visible de la pantalla). Estalvia amplada de banda per a imatges que l'usuari potser mai veu.
- **`fetchpriority="high"`**: indica al navegador que prioritzi la descàrrega. S'aplica als events destacats de la portada (les primeres imatges que l'usuari veu). Important per al **LCP** (diapositiva 16).
- **`loading="eager"`** (oposat a `lazy`): carrega la imatge immediatament, sense esperar. S'usa per al joc (imatge de la pregunta, necessita estar disponible ara).

### SVG Inline — Logo i Placeholders
**SVG** (*Scalable Vector Graphics*): format de gràfics vectorials basat en XML. Escala sense pèrdua de qualitat a qualsevol resolució.

**SVG inline** = incrustat directament al HTML (no com `<img src="logo.svg">`). Avantatge clau: **no requereix cap petició HTTP addicional**. El navegador el processa mentre parseig el HTML. Per al logo del Hero de la portada, això significa que el **LCP es produeix a 0ms** de latència de xarxa.

**Placeholders SVG generats**: quan un artista no té imatge, `generatePlaceholderSVG()` crea un SVG inline amb les inicials de l'artista i un color de fons. El color s'obté amb `artist.name.length % 6` (mòdul 6 sobre l'array de 6 colors), garantint que el mateix artista sempre tingui el mateix color (determinista, no aleatori).

### Audio M4A i Video WebM/MP4
**M4A (AAC)**: fitxer amb l'extensió `.m4a` és un contenidor MPEG-4 amb el còdec d'àudio **AAC** (*Advanced Audio Coding*). Millor qualitat que MP3 a la mateixa mida. Suport universal als navegadors moderns.

**WebM** (Google, 2010): format de vídeo obert amb còdec VP8/VP9. Millor compressió que MP4. Suport a Chrome i Firefox.

**MP4**: contenidor MPEG-4 amb còdec H.264. Universal (incl. Safari, iOS). Fallback per a WebM.

**`playsinline muted`**: atributs crítics per a `autoplay` a mòbil:
- `muted`: Chrome i Safari bloquegen `autoplay` si el vídeo té so. `muted` desactiva el so i permet l'autoplay.
- `playsinline`: a iOS, per defecte els vídeos s'obren a pantalla completa nativa. `playsinline` els força a reproduir-se dins del seu contenidor a la pàgina.

---

## Diapositiva 13 — El Joc Musical: SVG Dinàmics i Plataformes Externes

### `gameState` — estat centralitzat
Patró de **gestió d'estat centralitzat**: en lloc d'escampar variables del joc per moltes funcions (`let score; let currentIndex; let phase...`), tot l'estat viu en un únic objecte `gameState`. Qualsevol funció que necessiti l'estat l'accedeix a través d'aquest objecte.

Avantages: és fàcil veure l'estat complet del joc en qualsevol moment (debug), les funcions de renderitzat sempre llegeixen del mateix lloc, i resetar el joc és tan simple com `gameState.score = 0; gameState.currentIndex = 0`.

**`phase: 'setup' | 'playing' | 'results'`**: el camp `phase` actua com una **màquina d'estats finita** (FSM). La funció `showPhase()` usa `phase` per decidir quin dels tres `<div>` del joc és visible (`jocSetup`, `jocPlaying`, `jocResults`).

### Barreja Fisher-Yates (Knuth)
L'algorisme ingenu de barreja (generar un índex aleatori per a cada element i ordenar per ell) **no genera una distribució uniforme**: algunes permutacions surten amb més probabilitat que altres. El problema és matemàticament conegut.

**Fisher-Yates** (1938, Knuth 1969) garanteix que **cada permutació possible és igualment probable**. Funciona iterant de l'últim element cap al primer, intercanviant cada element amb un element aleatori que ve **abans o en la mateixa posició**.

```javascript
for (let i = arr.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1)); // 0 ≤ j ≤ i
  [arr[i], arr[j]] = [arr[j], arr[i]];           // swap
}
```
`[arr[i], arr[j]] = [arr[j], arr[i]]` usa **destructuring assignment** de ES6 per fer l'intercanvi de dos valors en una sola línia, sense variable temporal.

### `normalizeQuestion()` — abstracció del Schema.org
Funciona com un **adaptador** (patró Adapter): converteix el format Schema.org (amb `associatedMedia`, `suggestedAnswer`, `acceptedAnswer`) al format intern simplificat que la lògica del joc usa.

La resposta correcta es guarda com l'**índex numèric** (0, 1, 2 o 3) de l'opció, no com el text. Si algun dia es canvia el text d'una opció, la resposta correcta segueix sent l'índex 0 → l'opció A.

### Spotify Embed i OpenStreetMap
**Spotify Embed**: iframe oficial de Spotify (`open.spotify.com/embed/artist/{spotifyId}?theme=0`). `loading="lazy"` al iframe evita que Spotify bloquegi el carregament del modal fins que l'usuari hi arriba.

**Tiles OpenStreetMap**: un mapa web es compon de *tiles*, imatges de 256×256 píxels que representen seccions del mapa a diferents nivells de zoom. Leaflet sol·licita les tiles necessàries a `tile.openstreetmap.org/{z}/{x}/{y}.png` on `z` és el zoom i `x`/`y` les coordenades de la tile.

**SVG markers per categoria**: en lloc dels markers predefinits de Leaflet (imatges PNG), el projecte usa `L.divIcon` amb un SVG inline generat per `createMarkerIcon(color)`. Permet canviar el color del marker per categoria (concert = terracota, festival = or, festa popular = verd) sense cap fitxer d'imatge addicional.

---

## Diapositiva 14 — Web Semàntica, JSON-LD i SEO

### Web Semàntica
Concepte de Tim Berners-Lee (creador del web) per a un web on les màquines puguin entendre el significat del contingut, no només la seva presentació visual. JSON-LD és el format pràctic que implementa aquest concepte per al SEO.

### SEO (Search Engine Optimization)
Tècniques per millorar la visibilitat d'una web als resultats de cerca orgànics (no pagats) de Google/Bing. El SEO *tècnic* (el rellevant aquí) inclou: estructura semàntica, velocitat de càrrega, URLs amigables, i dades estructurades.

**Rich snippets**: quan Google indexa una pàgina amb Schema.org `MusicEvent`, pot mostrar als resultats de cerca la data, ubicació i preu directament → millora el CTR (*Click-Through Rate*, percentatge de clics).

### URIs Schema.org com a estatus
A `routes/requests.js`, els estats de les sol·licituds es mapegen a URIs de Schema.org:
- `PotentialActionStatus` → sol·licitud pendent.
- `CompletedActionStatus` → sol·licitud aprovada.
- `FailedActionStatus` → sol·licitud rebutjada.

Usar URIs estàndards en lloc de strings propis (`"pending"`, `"approved"`) fa el sistema **interoperable** amb qualsevol altra aplicació que entengui Schema.org.

### Redirect 301 — domain authority
**Codi HTTP 301** (*Moved Permanently*): el servidor retorna la nova URL als clients i bots. Diferent del **302** (*Found*, temporal) que no transfereix l'autoritat.

**Domain authority**: mètrica que reflecteix la "reputació" d'un domini als buscadors, basada en el nombre i qualitat d'altres webs que hi apunten (*backlinks*). Si `donam-bauxa.vercel.app` i `donambauxa.online` serveixen el mateix contingut, els backlinks es divideixen entre els dos. El redirect 301 consolida tota l'autoritat a `donambauxa.online`.

---

## Diapositiva 15 — Accessibilitat (WCAG / ARIA)

### WCAG (Web Content Accessibility Guidelines)
Guies de l'W3C (*World Wide Web Consortium*, l'organisme que estandarditza el web) per fer el contingut web accessible a tothom, incloent persones amb discapacitats visuals, auditives, motores o cognitives.

Tres nivells de conformitat: **A** (mínim), **AA** (estàndard), **AAA** (màxim). La legislació europea (EN 301 549) exigeix el nivell AA per a webs del sector públic.

### ARIA (Accessible Rich Internet Applications)
Especificació del W3C que afegeix atributs HTML per a elements dinàmics que els lectors de pantalla no entenen per defecte. Principi fonamental: **"No ARIA is better than bad ARIA"** — afegir ARIA incorrectament és pitjor que no posar-ne.

**`aria-label`**: proporciona un text alternatiu per a elements sense text visible. Exemple crític: `<button class="btn-favorite"><i class="bi bi-heart"></i></button>` — un lector de pantalla diria "botó". Amb `aria-label="Afegir Antonia Font a favorits"` diu el contingut correcte.

**`aria-live="polite"`**: quan el contingut d'un element canvia dinàmicament (com la puntuació al joc), els lectors de pantalla normalment no ho anuncien. `aria-live="polite"` indica que l'ha d'anunciar quan l'usuari faci una pausa. "Polite" = espera; "assertive" = interromp immediatament (per a alertes crítiques).

**`role="progressbar"` + `aria-valuenow/min/max`**: la barra de progrés del joc és un `<div>` visual. `role="progressbar"` indica al lector de pantalla que és una barra de progrés. `aria-valuenow="3"`, `aria-valuemin="0"`, `aria-valuemax="20"` indiquen el valor actual.

**`role="group"`**: agrupa les opcions A/B/C/D del joc per als lectors de pantalla. Combinat amb `aria-label="Opcions de resposta"`, l'usuari sap que les 4 opcions formen un grup de selecció.

### Focus Management
En una SPA, el focus del teclat no es mou automàticament en canviar de vista (no hi ha recàrrega de pàgina que resetegi el focus). Després de respondre una pregunta al joc, `nextBtn.focus()` mou programàticament el focus al botó "Següent", permetent una navegació fluida per teclat sense interacció de ratolí.

### Media Session API
Quan `<audio controls>` o `<video controls>` reprodueix contingut, el sistema operatiu (iOS, Android, Windows, macOS) mostra automàticament els controls de reproducció a la pantalla de bloqueig i als controls del sistema, amb el títol, artista i portada. Accessibilitat de primer nivell sense cap codi addicional.

---

## Diapositiva 16 — Rendiment i Core Web Vitals

### Core Web Vitals
Mètriques definides per Google (2020) per mesurar l'**experiència d'usuari real** d'una pàgina web. Formen part del **ranking de Google** des de juny 2021. Mesurables amb Lighthouse o PageSpeed Insights.

### LCP (Largest Contentful Paint)
Temps fins que **l'element de contingut visual més gran** visible a la pantalla és completament renderitzat. Objectiu: < 2.5s. Indicador de "quan es veu el contingut principal".

**Solució a Dona'm Bauxa**: el logo SVG del Hero és **inline al HTML** (`<svg>` directament al `index.html`, no com `<img src="logo.svg">`). El navegador el renderitza mentre parseig l'HTML, sense cap petició de xarxa addicional. LCP ≈ 0ms de latència de xarxa.

### CLS (Cumulative Layout Shift)
Mesura **com de molt es mou el contingut** de la pàgina mentre carrega. Objectiu: < 0.1 (en una escala de 0 a infinit). CLS alt = contingut que "salta" mentre l'usuari intenta llegir o clicar.

**Causa típica**: una imatge sense dimensions definides que, en carregar, fa baixar tot el contingut inferior. **Solució a Dona'm Bauxa**: *skeleton loaders* amb `height` fix (ex: `style="height:380px"`). Reserven l'espai exacte que ocuparà la targeta quan carregui. El contingut no es mou.

### TTI (Time to Interactive)
Temps fins que la pàgina és **completament interactiva** (totes les peticions crítiques resoltes, CPU lliure). Objectiu: < 3.8s.

**`rel="modulepreload"`**: `<link rel="modulepreload" href="/js/app.js">` instrueix el navegador a descarregar i analitzar el mòdul JS amb alta prioritat, en paral·lel amb el parsing de l'HTML, sense bloquejar el renderitzat.

### Async CSS (`media="print"` → `media="all"`)
CSS amb `media="all"` (el per defecte) **bloqueja el renderitzat** del HTML fins que es descarrega. Bootstrap Icons (font d'icones) no és crític per al renderitzat inicial.

Truc: `<link rel="stylesheet" href="bootstrap-icons.css" media="print" onload="this.media='all'">`. El navegador descarrega CSS amb `media="print"` en **baixa prioritat** (no bloqueja). Quan acaba, `onload` canvia `media` a `"all"` aplicant els estils. Sense cap retard visible per a l'usuari.

### `rel="preconnect"`
Estableix la connexió TCP + TLS amb un domini extern de manera anticipada, **abans que el recurs sigui sol·licitat**. Quan finalment es fa la petició, la connexió ja està establerta, estalviant 100-500ms de latència. S'usa per a `cdn.supabase.co`, `cdn.jsdelivr.net`, `fonts.googleapis.com`.

---

## Diapositiva 17 — Proves Funcionals i Eines d'Avaluació

### Lighthouse
Eina d'auditoria automatitzada de Google, **integrada a Chrome DevTools** (F12 → Lighthouse). Genera un informe amb puntuacions de 0-100 per a:
- **Performance**: Core Web Vitals + altres mètriques.
- **Accessibility**: atributs ARIA, contrasts de color, etiquetes.
- **Best Practices**: HTTPS, errors de consola, SRI.
- **SEO**: meta tags, indexabilitat.

`report.json` al repositori és l'informe generat de l'app en producció.

### WAVE / Axe
- **WAVE** (*Web Accessibility Evaluation Tool*): extensió del navegador que superposa icones visuals sobre la pàgina indicant errors, avisos i elements d'accessibilitat. Accessible sense coneixements tècnics.
- **Axe** (*Deque Systems*): eina més tècnica, integrable amb Cypress i Jest. Genera una llista estructurada de violacions WCAG amb el codi i la solució recomanada.

### DevTools Network
Pestanya de les Developer Tools del navegador per monitoritzar totes les peticions HTTP:
- **0 peticions duplicades**: verificació que la caché de `dataLoader.js` funciona. Si l'usuari va de `#artists` a `#events` i torna a `#artists`, `artists.json` s'ha de carregar **una sola vegada** (la primera). Amb `cache: 'no-cache'` al fetch i la caché de `Map`, cada JSON es descarrega exactament una vegada per sessió (o fins que l'admin modifica contingut).

### `Promise.all([...])` — càrrega paral·lela
`Promise.all` executa múltiples promeses **en paral·lel** en lloc de seqüencialment. 

Comparació de temps:
- **Seqüencial**: `artists(200ms) → events(150ms) → news(100ms) → extern(80ms)` = **530ms**.
- **Paral·lel** amb `Promise.all`: totes les peticions s'envien alhora → espera la més lenta = **200ms**.

Estalvi: 330ms en el temps de càrrega inicial.

---

## Diapositiva 18 — Git, Vercel i Desplegament en Producció

### `vercel.json`
Fitxer de configuració que instrueix Vercel sobre com desplegar l'aplicació:
- `"src": "/(.*)"` → expressió regular que captura **totes les rutes** (el `(.*)` captura qualsevol text).
- `"dest": "/server.js"` → totes les peticions les gestiona `server.js`.

Sense això, Vercel serviria els fitxers estàtics directament i les rutes `/api/*` no funcionarien.

### Serverless Functions
Vercel executa `server.js` com una **funció serverless** (Lambda). Cada petició HTTP activa la funció, que s'executa i s'apaga. No hi ha un servidor Node.js sempre encès.

**Avantatge**: preu 0 sense tràfic, escalat automàtic.  
**Desavantatge**: el sistema de fitxers és **de lectura (read-only)**. A diferència d'un VPS, no es pot escriure a disc. Per això les modificacions de l'admin no persisteixen a Vercel.

### EROFS (Error: Read-Only File System)
Error del sistema operatiu Linux quan s'intenta escriure a un filesystem muntat com a read-only. A Vercel, el codi de l'app és immutable per disseny (el "filesystem" és l'imatge del deploy).

`helpers/json.js` captura l'error a `writeJSON()` amb un `try/catch` i logeja un warning sense fer crashejar el servidor. L'admin pot treballar localment (on sí s'escriu) però no en producció.

### Mock local de Supabase
Quan la variable d'entorn `SUPABASE_URL` no és definida (entorn local sense compte de Supabase), `helpers/supabase.js` retorna un objecte JavaScript que **simula** totes les operacions de Supabase (`.from()`, `.select()`, `.eq()`, `.insert()`...) retornant dades buides o nulls. Addicionalment, `middleware/auth.js` detecta l'absència de `SUPABASE_URL` i assigna `role: 'admin'` automàticament, permetent provar tot el panell d'admin sense configuració.

### `app.set('trust proxy', 1)`
Vercel actua com a **proxy invers**: les peticions dels usuaris passen primer per Vercel (que les redirigeix a la funció serverless). Des del punt de vista d'Express, la IP del client és la de Vercel, no la real. `trust proxy: 1` indica a Express que confiï en la capçalera `X-Forwarded-For` que Vercel afegeix, contenint la IP real del client.

---

## Diapositiva 19 — Seguretat: HTTPS, JWT, CORS i XSS

### HTTPS
**HTTP** (*HyperText Transfer Protocol*) + **S** (*Secure*). Afegeix una capa de xifrat **TLS** (*Transport Layer Security*) sobre HTTP. Tota la comunicació entre el navegador i el servidor és xifrada → un atacant *man-in-the-middle* no pot llegir ni modificar les dades.

A Vercel, el certificat TLS és gestionat automàticament (renovació inclosa). `app.set('trust proxy', 1)` permet que `req.secure` retorni `true` correctament.

### JWT Doble Verificació
**JWT** (*JSON Web Token*): token en format `base64(header).base64(payload).signature`. El `payload` conté informació de l'usuari (id, email). La `signature` és un HMAC-SHA256 del header+payload amb una clau secreta del servidor. Verifica que ningú ha modificat el token.

**Primera verificació** — `supabase.auth.getUser(token)`: Supabase verifica matemàticament la signatura del JWT i comprova que no hagi caducat (camp `exp` del payload).

**Per què una segona verificació?** Un JWT pot ser vàlid criptogràficament però el rol de l'usuari a la base de dades pot haver canviat mentre el token era vàlid. Si un admin és degradat a `lector` i el seu JWT no ha caducat, sense la segona verificació continuaria tenint accés.

**Segona verificació** — `SELECT * FROM users WHERE id = $1`: obté el rol *actual* de la base de dades. Si `user.role !== requiredRole` → `res.status(403).json({error: 'Forbidden'})`.

### `403 Forbidden` vs `401 Unauthorized`
- **`401 Unauthorized`**: l'usuari **no s'ha autenticat** (no ha enviat token o és invàlid). "Qui ets?"
- **`403 Forbidden`**: l'usuari s'ha autenticat però **no té permisos** per fer aquesta acció. "Et conec, però no pots fer això."

### CORS + Whitelist
**CORS** (*Cross-Origin Resource Sharing*): política de seguretat del navegador que bloqueja peticions JavaScript a dominis diferents del domini actual (*same-origin policy*). Un script a `donambauxa.online` no pot fer `fetch('https://altre-domini.com/api')` sense que l'altre servidor ho permeti explícitament.

**Preflight `OPTIONS`**: per a peticions *no simples* (PUT, DELETE, amb capçaleres personalitzades com `Authorization`), el navegador envia primer una petició `OPTIONS` per preguntar si ho permet. El servidor respon `204 No Content` amb les capçaleres CORS adequades.

### SRI (Subresource Integrity)
Quan es carrega Leaflet des d'un CDN (`<script src="https://unpkg.com/leaflet.js" integrity="sha256-...">`), existeix el risc que el CDN sigui compromès i serveixi codi maliciós. **SRI** verifica que el fitxer descarregat coincideix amb el hash `sha256` esperat. Si no coincideix, el navegador rebutja l'execució del script.

### Mutex Lock (Mutual Exclusion)
Node.js és **single-threaded** (un sol fil d'execució) però **asíncron** (l'event loop permet executar operacions I/O sense bloquejar). Dos administradors fent CRUD simultàniament poden arribar al punt de `readJSON` → `writeJSON` alhora.

Escenari sense mutex: Admin A llegeix `artists.json` (40 artistes) → Admin B llegeix `artists.json` (40 artistes) → Admin A afegeix l'artista 41 i escriu → Admin B afegeix l'artista 42 i escriu → Admin B **sobreescriu el fitxer sense l'artista 41**.

`withLock(filePath, fn)` implementa un **semàfor** basat en l'objecte `locks = {}`. Mentre un procés té el lock, els altres esperen en un `while(locks[path]) await sleep(50)` (*busy-wait*). `try/finally` garanteix que el lock sempre s'allibera, fins i tot si hi ha un error.

---

## Diapositiva 20 — Autoevaluació, Limitacions i Nota Proposada

### Objectius assolits — termes clau

**SPA amb 9 vistes**: en lloc de 9 fitxers HTML, un únic `index.html` amb routing JavaScript. Navegació sense recàrrega de pàgina.

**OAuth Google + JWT (0 cookies)**: l'autenticació usa tokens JWT guardats a `localStorage` per Supabase. No s'usen cookies de sessió. Avantatge: compatible amb arquitectures serverless (Vercel no té sessions persistents entre invocacions de la Lambda).

**Mutex concurrent**: garantia de consistència de dades en escriptures paral·leles al JSON, sense base de dades relacional.

**AVIF/WebP/JPEG pipeline**: reducció automàtica del pes de les imatges de fins al 50% sense sacrificar qualitat, amb fallbacks automàtics.

**ARIA complet**: accessibilitat per a usuaris amb discapacitats visuals (lectors de pantalla com NVDA, JAWS, VoiceOver).

**ICS exportació**: format estàndard RFC 5545, compatible universalment.

### Limitacions — per què existeixen

**Vercel EROFS**: és una limitació **inherent al model serverless**, no un error de disseny. La solució (migrar dades a Supabase Database) és planificada com a millora futura.

**Leaflet 50ms delay**: necessari per al **reflow del DOM**. Quan el router canvia `display:none` a `display:block`, el navegador no ha processat immediatament les noves dimensions del contenidor del mapa. Leaflet necessita dimensions reals per calcular el viewport. El `setTimeout(resolve, 50)` dóna temps al navegador per fer el reflow.

**Puntuacions no persistides**: el joc és completament local (sense peticions al servidor). Les puntuacions es calculen al client i no s'envien a cap base de dades. Millora planificada.

### Millores futures — termes clau

**PWA** (*Progressive Web App*): tecnologia que permet que una web funcioni com una app nativa. Requereix un **Service Worker** (script que s'executa en background i gestiona la caché per a ús offline) i un **manifest.json** (fitxer que declara el nom de l'app, icones, color del tema...).

**i18n** (*internationalization*): el número 18 representa les 18 lletres entre la `i` i la `n` de la paraula. Suport multi-idioma (català/mallorquí + castellà + anglès per a turistes).

**Supabase Database**: migrar de fitxers JSON locals a taules PostgreSQL a Supabase. Resoldria completament el problema EROFS i permetria consultes SQL complexes, historial de canvis, etc.

**Historial de partides**: guardar `gameState.answers` i `gameState.score` a Supabase per a cada usuari autenticat, permetent veure el progrés al llarg del temps.

### Nota 9.5 — justificació tècnica
El projecte supera els requisits bàsics de l'assignatura en **totes les categories** del document d'avaluació: funcionalitat i correcció tècnica, UX, optimització, multimèdia, semàntica, accessibilitat, seguretat. Incorpora funcionalitats **no exigides** explícitament: autenticació OAuth completa, sistema de rols de 3 nivells, mutex per a concurrència, SRI per a CDNs externs, pipeline AVIF, doble verificació JWT. La deducció de 0.5 és per la manca de persistència de puntuacions del joc, una funcionalitat esperada en un joc complet.
