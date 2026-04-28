# Documentació Tècnica Detallada: Dona'm Bauxa

Aquesta documentació aprofundeix en l'arquitectura, implementació, mecanismes de prevenció d'errors i característiques tècniques de l'aplicació web **Dona'm Bauxa**, una plataforma interactiva dissenyada per descobrir l'escena musical, esdeveniments, concerts i festes populars de Mallorca.

---

## 1. Arquitectura i Patrons de Disseny

L'aplicació està concebuda com a **Monolítica Modular** utilitzant el patró **Single Page Application (SPA)** sense marcs de treball pesats (pur Vanilla JavaScript amb ES6 Modules). L'objectiu és oferir la interactivitat d'una App nativa amb els mínims recursos i el màxim control del rendiment.

### Stack Tècnic Complet
- **Frontend**: Vanilla JavaScript (ES6 Modules), HTML5 semàntic, CSS3 amb variables natives, i **Bootstrap 5.3.3** com a marc CSS (encara que molts components es manipulen directament via JS).
- **Backend**: Node.js i Express.js utilitzant rutes modulars.
- **Persistència Estàtica (Base de Dades)**: Els conjunts de dades formen una base de dades local de fitxers JSON que implementa l'estàndard estructurat **Schema.org** (com a `ItemList`, `Event`, `MusicGroup`, `Person`, etc.).
- **Gestió d'Identitat (Auth)**: **Supabase**, utilitzant protocols OAuth (Google) i validacions JWT.
- **Mapes i Geolocalització**: Leaflet (integració i destrucció de contenidors dinàmica).
- **Desplegament**: **Vercel** com a plataforma serverless, amb redirecció 301 automàtica del domini `.vercel.app` cap al domini oficial `donambauxa.online`.

### Dependències del Servidor (`package.json`)
```json
"@supabase/supabase-js": "^2.104.1"   // Client Supabase (auth + DB)
"cookie-session": "^2.1.0"             // Sessions HTTP
"dotenv": "^16.4.0"                    // Variables d'entorn
"express": "^4.21.0"                   // Servidor HTTP
"passport": "^0.7.0"                   // Framework d'autenticació
"passport-google-oauth20": "^2.0.0"   // Estratègia OAuth Google
```

El projecte utilitza `"type": "module"` al `package.json`, forçant tots els fitxers JS del servidor a usar la sintaxi `import/export` d'ES Modules natius de Node.js en comptes de `require()`.

### Grafs de Dependències dels Mòduls Frontend
```
app.js
├── dataLoader.js      (càrrega i normalització de dades)
├── renderer.js        (generació HTML de targes i modals)
│   ├── favorites.js   (estat localStorage)
│   └── calendar.js    (generació ICS)
├── filters.js         (lògica de filtratge multi-criteri)
├── ui.js              (utilitats globals d'interfície)
├── mapModule.js       (Leaflet, markers, popups)
├── router.js          (hash-based SPA routing)
├── admin.js           (panell admin + gestió auth)
├── profile.js         (edició de perfil d'usuari)
├── solicituds.js      (flux de sol·licituds promotor)
├── joc.js             (joc musical multi-format)
└── config.js          (client Supabase + apiFetch helper)
```

---

## 2. Gestió de Rutes i Estat al Frontend (Router SPA)

El fitxer `router.js` és el nucli que orquestra el canvi de vistes sense recarregar la pàgina, controlant l'estat i el cicle de vida del DOM.

### Hash-based Routing
Escolta els esdeveniments de `hashchange` a la URL (p. ex., `#artists`, `#map`). A partir d'aquest hash, crida un mètode de resolució (`resolveView`) que tanca totes les capes amb atributs `data-view="..."` excepte la demandada.

Les vistes vàlides reconegudes pel router són:
```javascript
const validViews = ['home', 'artists', 'events', 'map', 'favorits', 'profile', 'solicituds', 'admin', 'joc'];
```
Qualsevol hash no reconegut redirigeix silenciosament a `'home'`, evitant pantalles en blanc.

### Control de Modals i Navbar
Abans de realitzar un canvi de vista, el *router* interactua asíncronament amb l'API de Bootstrap (`bootstrap.Collapse.getInstance`, `bootstrap.Modal.getInstance`) per tancar forçosament qualsevol menú de navegació mòbil obert o finestra modal activa, garantint una transició completament neta.

```javascript
function switchView(view) {
  // Tanca el navbar mòbil obert
  const navCollapse = document.getElementById('mainNav');
  if (navCollapse && navCollapse.classList.contains('show')) {
    const bsCollapse = bootstrap.Collapse.getInstance(navCollapse);
    if (bsCollapse) bsCollapse.hide();
  }
  // Tanca tots els modals oberts
  document.querySelectorAll('.modal.show').forEach(modal => {
    const bsModal = bootstrap.Modal.getInstance(modal);
    if (bsModal) bsModal.hide();
  });
  // ...
}
```

### Prevenció de Fuites de Memòria (Memory Leaks)
Disposa d'una funció d'unregistrament (`mapCleanup()`). En el moment en què l'usuari abandona la vista del mapa (i només aleshores), el *router* executa l'ordre `.remove()` de l'API de Leaflet per alliberar la instància i desvincular els esdeveniments del ratolí. Això evita un error recurrent de Leaflet (`Map container is already initialized`) quan s'intenta reconstruir el mapa múltiples vegades en un mateix cicle de navegació.

### Patró `initializedViews` (Idempotència de Vistes)
A `app.js`, un `Set<string>` anomenat `initializedViews` rastreja quines vistes ja han estat inicialitzades:

```javascript
const initializedViews = new Set();

async function initArtists() {
  if (initializedViews.has('artists')) {
    renderArtistsGrid(); // Només re-renderitza per actualitzar favorits
    return;
  }
  initializedViews.add('artists');
  // ... primer init complet (filtres, listeners, etc.)
}
```

Això garanteix que els listeners d'events dels filtres no es dupliquen en cada visita. L'excepció és la vista d'artistes i d'events que sempre re-renderitza el grid per reflectir canvis en els favorits. La vista del mapa és l'única que trenca el patró: es destrueix i recrea Leaflet en cada visita a causa del bug del contenidor ja inicialitzat.

### Invalidació de Caché per Canvis d'Admin
Quan l'administrador modifica contingut, un event personalitzat `admin:contentChanged` es dispara i força la recàrrega completa:

```javascript
document.addEventListener('admin:contentChanged', () => {
  dataLoaded = false;
  initializedViews.delete('home');
  initializedViews.delete('artists');
  initializedViews.delete('events');
  initializedViews.delete('map');
});
```

---

## 3. Gestió i Injecció de Dades (Data Loader i Mapeig)

La capa de dades frontend (`dataLoader.js`) s'encarrega de coordinar, descarregar i adaptar l'esquema d'entitats (Entity Normalization).

### Caché en Memòria RAM (`Map`)
Tota càrrega utilitza un objecte de classe genèrica `Map` d'ES6 que guarda els JSON sota clau. Això garanteix que navegar entre "Inici" i "Artistes" no multipliqui les sol·licituds HTTP:

```javascript
const cache = new Map();

export async function loadData(path) {
  if (cache.has(path)) return cache.get(path);
  // ... fetch i emmagatzema a la caché
}
```

La funció `clearDataCache()` buida explícitament la caché, cridada per l'admin quan modifica dades.

### Mecanisme de Preload (`window.__dataPreload`)
Per eliminar la latència de les peticions inicials, `dataLoader.js` suporta un mecanisme de preload on el servidor pot injectar promeses de dades directament a `window.__dataPreload` abans que el JS de l'aplicació s'executi. Si existeix, s'usa la promesa precarregada en comptes de fer un `fetch` nou, reduint la Time to Interactive (TTI):

```javascript
if (window.__dataPreload) {
  if (path === 'data/events.json') {
    preload = window.__dataPreload.events;
    window.__dataPreload.events = null; // Neteja per evitar reutilitzar dades obsoletes
  }
}
const data = preload ? await preload : await fetch(path, { cache: 'no-cache' }).then(...);
```

### Hidratació de Schema.org (`extractItems`)
Com que l'estructura estàndard d'Schema pot ser massa niada, el `dataLoader` aterra els elements. Específicament busca matrius `additionalProperty` i les hidrata elevant-les a variables base del mateix objecte JavaScript (per exemple: un valor de `archived` ocult al directori base es converteix directament en `item.archived`). Si `archived === true`, la funció elimina l'element del resultat i el frontend no arriba a processar-lo mai:

```javascript
export function extractItems(data) {
  return data.itemListElement
    .map(entry => {
      const item = { ...entry.item };
      if (Array.isArray(item.additionalProperty)) {
        for (const prop of item.additionalProperty) {
          item[prop.name] = prop.value; // Hidratació plana
        }
      }
      if (item.areaServed && !item.zone) item.zone = item.areaServed; // Mapeig semàntic
      return item;
    })
    .filter(item => item.archived !== true); // Filtre d'arxiu
}
```

### Fusió d'Esdeveniments Externs (`events_extern.json`)
Els events externs usen el format `@graph` de JSON-LD en comptes de l'`ItemList` estàndard. `loadExternEvents()` normalitza aquest format cap al vocabulari intern:

```javascript
export async function loadExternEvents() {
  const data = await loadData('data/events_extern.json');
  return data['@graph'].map(event => ({
    ...event,
    image, // Extret de ImageObject.contentUrl
    category: event.additionalType || event.category || 'festa',
    zone: event.zone || event.location?.address?.addressRegion || '',
    isExtern: true, // Marcat per mostrar badge "Extern" a la UI
  }));
}
```

A `app.js`, els dos conjunts es fusionen en una sola matriu:
```javascript
allEvents = [...events, ...externEvents];
```

---

## 4. Arquitectura de Dades Schema.org

Tots els fitxers JSON del directori `frontend/data/` segueixen els estàndards **JSON-LD** de Schema.org. Aquesta decisió proporciona SEO semàntic i una estructura validable contra vocabularis estàndard.

### `artists.json` — `MusicGroup` dins `ItemList`
```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "numberOfItems": 46,
  "itemListElement": [{
    "@type": "ListItem",
    "position": 1,
    "item": {
      "@type": "MusicGroup",
      "@id": "artist-1",
      "name": "Antonia Font",
      "genre": ["Pop", "Rock", "Indie"],
      "foundingDate": "1997",
      "foundingLocation": { "@type": "Place", "name": "Palma" },
      "image": "assets/images/artists/antonia-font.jpg",
      "sameAs": ["https://open.spotify.com/...", "https://instagram.com/..."],
      "member": [{ "@type": "Person", "name": "Pau Debon" }],
      "album": [{ "@type": "MusicAlbum", "name": "Taxi", "datePublished": "2007" }],
      "areaServed": "Palma",
      "additionalProperty": [
        { "@type": "PropertyValue", "name": "spotifyId", "value": "503mwh1GWEiWy9bzzpiTFW" },
        { "@type": "PropertyValue", "name": "featured", "value": true },
        { "@type": "PropertyValue", "name": "archived", "value": false }
      ]
    }
  }]
}
```

### `events.json` — `MusicEvent` amb GeoCoordinates
```json
{
  "@type": "MusicEvent",
  "@id": "event-1",
  "startDate": "2026-03-07T21:00:00+01:00",
  "endDate": "2026-03-07T23:30:00+01:00",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "location": {
    "@type": "Place",
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 39.5756,
      "longitude": 2.6099
    }
  },
  "offers": {
    "@type": "Offer",
    "price": "35.00",
    "priceCurrency": "EUR",
    "availability": "https://schema.org/InStock"
  }
}
```

Els camps `geo.latitude` i `geo.longitude` de cada event són el que alimenta el mòdul de Leaflet per posicionar els marcadors al mapa.

### `questions.json` i `questionnaires.json` — `Quiz` amb `associatedMedia`
Les preguntes del joc usen el tipus `Question` de Schema.org amb `suggestedAnswer` (les opcions), `acceptedAnswer` (la correcta, referenciada per `@id`) i `associatedMedia` (el contingut multimèdia):

```json
{
  "@type": "Question",
  "@id": "question-1",
  "about": { "@type": "Thing", "name": "Artistes de Mallorca" },
  "associatedMedia": {
    "@type": "AudioObject",
    "contentUrl": "assets/audio/antonia-font.m4a",
    "encodingFormat": "audio/mp4"
  },
  "suggestedAnswer": [
    { "@type": "Answer", "@id": "ans-1a", "position": 1, "text": "Antonia Font" },
    { "@type": "Answer", "@id": "ans-1b", "position": 2, "text": "Anegats" }
  ],
  "acceptedAnswer": { "@id": "ans-1a" }
}
```

---

## 5. Backend: Gestió de Dependències, Concurrència i API

El backend (Node + Express) ha d'emular comportaments d'escriptura tradicionals amb persistència plana de JSON, requerint mecanismes severs de seguretat en operacions I/O.

### Configuració del Servidor (`server.js`)
El servidor gestiona diverses responsabilitats de producció:

**Redirecció de domini Vercel → Oficial:**
```javascript
if (isProduction) {
  app.use((req, res, next) => {
    if (req.hostname === 'donam-bauxa.vercel.app' && !req.path.startsWith('/api')) {
      return res.redirect(301, `https://donambauxa.online${req.path}`);
    }
    next();
  });
}
```

**CORS amb whitelist explícita:**
```javascript
const allowedOrigins = [
  'https://donambauxa.online',
  'https://www.donambauxa.online',
  `http://localhost:${PORT}`
];
```
Retorna `204 No Content` per a peticions `OPTIONS` (preflight CORS) sense processar-les.

**Trust Proxy per Vercel:**
```javascript
if (isProduction) app.set('trust proxy', 1);
```
Necessari perquè Express llegeixi correctament les IPs reals dels clients a través del proxy de Vercel.

### Seguretat d'Escriptura Concurrent (`helpers/json.js`)
Puntualment, el backend permet modificacions al JSON. A causa de la natura asíncrona no bloquejant de NodeJS (Event Loop), múltiples administradors podrien modificar un sol fitxer simultàniament, generant fitxers corruptes.

S'ha implementat un **mutex lock virtual** `locks = {}`:
```javascript
const locks = {};

async function withLock(filePath, fn) {
  while (locks[filePath]) await new Promise(r => setTimeout(r, 50));
  locks[filePath] = true;
  try {
    return await fn();
  } finally {
    locks[filePath] = false; // Allibera sempre, fins i tot en cas d'excepció
  }
}
```

La funció pública `writeJSONSafe(filePath, updateFn)` encapsula la lògica complet: adquireix el lock, llegeix l'estat actual, aplica la funció de transformació, escriu el resultat i allibera el lock.

Addicionalment, es captura l'excepció `EROFS` (Read-Only File System) pròpia de la publicació a Vercel, impedint que el fil crashegi si no hi ha permisos d'escriptura.

### Mockup de la Base de Dades Fallback (`helpers/supabase.js`)
L'aplicació incorpora una alta tolerància a fallades envers els proveïdors SaaS. Si les variables d'entorn `SUPABASE_URL` i `SUPABASE_SERVICE_KEY` no estan declarades, es retorna un objecte mock que intercepta qualsevol cadena de Supabase:

```javascript
export const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : (() => {
      const mock = {
        auth: { getUser: () => ({ data: { user: null }, error: null }) },
        from: () => mock, select: () => mock, eq: () => mock,
        single: () => ({ data: null }),
        then: (cb) => cb({ data: [], error: null }) // Await compatible
      };
      return mock;
    })();
```

El mock retorna `{ data: [], error: null }` per a totes les consultes, i el `middleware/auth.js` injecta automàticament permisos `role: 'admin'` quan `SUPABASE_URL` no està definit, permetent un entorn de desenvolupament completament funcional sense configuració.

### Serialització del Perfil d'Usuari (`rowToProfile`)
El helper `rowToProfile` converteix una fila de la taula `users` de Supabase en un objecte Schema.org `Person`:

```javascript
export function rowToProfile(row) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': row.id,
    name: row.name, email: row.email, image: row.image,
    jobTitle: row.role, // 'lector' | 'promotor' | 'admin'
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'displayName', value: row.display_name || row.name }
    ]
  };
}
```

---

## 6. API REST: Referència Completa d'Endpoints

Totes les rutes d'API estan protegides per JWT i verificades a `middleware/auth.js`.

### Autenticació (`server.js`)

| Mètode | Ruta | Auth | Descripció |
|--------|------|------|------------|
| `GET` | `/auth/me` | JWT opcional | Retorna el perfil de l'usuari autenticat. Si el token és vàlid i l'usuari no existeix a `users`, el crea automàticament amb rol `lector`. |

**Resposta d'exemple (`/auth/me`):**
```json
{
  "authenticated": true,
  "user": { "id": "uuid", "email": "user@gmail.com", "name": "Dylan" },
  "profile": { "@id": "uuid", "role": "admin", "displayName": "Dylan", "image": "..." }
}
```

### Contingut Admin (`routes/content.js`)
Rutes genèriques aplicades a: `artists`, `events`, `news`, `questionnaires`, `questions`.

| Mètode | Ruta | Rol | Descripció |
|--------|------|-----|------------|
| `GET` | `/api/admin/:entity` | `admin` | Llista tots (inclosos arxivats) |
| `POST` | `/api/admin/:entity` | `admin` | Crea un nou element (genera `@id` i `position` automàtics) |
| `PUT` | `/api/admin/:entity/:id` | `admin` | Actualitza parcialment (merge via `Object.assign`) |
| `DELETE` | `/api/admin/:entity/:id` | `admin` | Esborra permanentment i re-indexa posicions |
| `PUT` | `/api/admin/:entity/:id/archive` | `admin` | Activa/desactiva l'arxiu (via `additionalProperty`) |

### Gestió d'Usuaris (`routes/users.js`)

| Mètode | Ruta | Rol | Descripció |
|--------|------|-----|------------|
| `GET` | `/api/admin/users` | `admin` | Llista tots els usuaris (retorna `ItemList` Schema.org) |
| `PUT` | `/api/admin/users/:id/role` | `admin` | Canvia el rol d'un usuari (`lector`, `promotor`, `admin`) |
| `DELETE` | `/api/admin/users/:id` | `admin` | Elimina un usuari (amb guàrdia: no es pot auto-eliminar) |

### Perfil d'Usuari (`routes/profile.js`)

| Mètode | Ruta | Rol | Descripció |
|--------|------|-----|------------|
| `GET` | `/api/profile` | Qualsevol autenticat | Retorna el perfil propi |
| `PUT` | `/api/profile` | Qualsevol autenticat | Actualitza `displayName` i `description` |

### Sol·licituds (`routes/requests.js`)

| Mètode | Ruta | Rol | Descripció |
|--------|------|-----|------------|
| `POST` | `/api/requests` | `promotor`, `admin` | Crea sol·licitud `CreateAction` o `UpdateAction` |
| `GET` | `/api/requests` | `promotor`, `admin` | Llista (admins veuen totes, promotors veuen les seves) |
| `GET` | `/api/requests/:id` | `promotor`, `admin` | Detall d'una sol·licitud |
| `PUT` | `/api/admin/requests/:id/approve` | `admin` | Aprova la sol·licitud |
| `PUT` | `/api/admin/requests/:id/reject` | `admin` | Rebutja amb notes |

**Estatus mapejats a Schema.org:**
```javascript
const STATUS = {
  pending:  'https://schema.org/PotentialActionStatus',
  approved: 'https://schema.org/CompletedActionStatus',
  rejected: 'https://schema.org/FailedActionStatus'
};
```

---

## 7. Middleware de Protecció d'Estat (Autenticació)

Al `middleware/auth.js`, la gestió dels tokens garanteix la privacitat del panell d'administració.

### Doble Verificació JWT
El middleware implementa un **double-check**: primer verifica el JWT amb `supabase.auth.getUser()` (comprova que no estigui caducat, falsificat o corromput), i acte seguit fa una consulta `SELECT` a la taula d'usuaris per validar el rol actual. Si el token indicava `admin` però la taula ha estat modificada a `lector`, la petició és rebutjada amb `403`:

```javascript
export function requireRole(...roles) {
  return async (req, res, next) => {
    if (!process.env.SUPABASE_URL) {
      req.userProfile = { role: 'admin' };
      return next(); // Bypass de dev
    }
    const userRow = await getUserRow(req); // Verifica JWT + consulta DB
    if (!userRow || !roles.includes(userRow.role)) {
      return res.status(403).json({ error: 'No autoritzat' });
    }
    req.userProfile = rowToProfile(userRow);
    next();
  };
}
```

### `apiFetch` Helper al Frontend (`config.js`)
Totes les crides autenticades des del frontend utilitzen `apiFetch`, que extreu automàticament el JWT de la sessió activa de Supabase i l'injecta a la capçalera `Authorization`:

```javascript
export async function apiFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(BACKEND_URL + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconegut');
  return data;
}
```

---

## 8. Integració Supabase i Flux OAuth

### Configuració del Client Frontend (`config.js`)
El client de Supabase al frontend s'inicialitza amb la clau pública (`ANON_KEY`) a través del CDN del navegador (no s'inclou en el bundle del servidor):

```javascript
const { createClient } = window.supabase;
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

La `BACKEND_URL` s'adapta dinàmicament: si s'executa a `localhost` o al domini de Vercel, les peticions van al mateix servidor (ruta relativa `''`); si s'executa des d'un altre origen, apunta explícitament a `https://donam-bauxa.vercel.app`.

### Flux d'Autenticació OAuth Google
```javascript
loginBtn?.addEventListener('click', async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
});
```
Supabase redirigeix l'usuari a Google, obté el codi d'autorització, intercanvia pels tokens JWT i redirigeix de tornada a l'aplicació. El token resultant es guarda automàticament a `localStorage` per Supabase.

### Listener d'Estat d'Autenticació
```javascript
supabase.auth.onAuthStateChange((event, session) => {
  checkAuth(); // Actualitza la navbar en temps real
});
```
`onAuthStateChange` s'activa en qualsevol canvi de sessió (login, logout, refresc automàtic de token), garantint que la UI reflecteix sempre l'estat real.

### Auto-creació d'Usuari al Backend
Quan `/auth/me` detecta un JWT vàlid d'un usuari nou (no present a la taula `users`), el crea automàticament amb rol `lector`:
```javascript
if (!userRow) {
  const { data: newUser } = await supabase.from('users').insert({
    id: user.id, name: user.user_metadata?.full_name,
    email: user.email, image: user.user_metadata?.avatar_url,
    role: 'lector'
  }).select().single();
}
```

### Sistema de Rols
| Rol | Accés |
|-----|-------|
| `lector` | Visualització pública. Sense accés a sol·licituds ni admin. |
| `promotor` | Pot crear i veure les seves pròpies sol·licituds (`CreateAction`, `UpdateAction`). |
| `admin` | Accés complet: CRUD de tot el contingut, gestió d'usuaris, aprovació/rebuig de sol·licituds. |

---

## 9. API REST Automàtica i Generació d'IDs (`routes/content.js`)

Cada instància del diccionari (artistes, notícies, preguntes, esdeveniments) passa pel factory router de rutes genèriques `contentRoutes(entityType)`.

### Generació d'IDs
El mètode `POST` genera IDs únics basats en la posició màxima existent:
```javascript
export function generateId(prefix, items) {
  const maxPos = items.reduce((max, el) => Math.max(max, el.position || 0), 0);
  return { id: `${prefix}-${maxPos + 1}`, position: maxPos + 1 };
}
```
Això garanteix IDs com `artist-47`, `event-16`, mai repetits ni reutilitzats.

### Actualització Parcial (PATCH virtual)
El mètode `PUT` implementa un "PATCH virtual" fusionant els camps enviats amb els existents via `Object.assign`, permetent actualitzar només els camps modificats:
```javascript
Object.assign(listItem.item, updates);
```

### Re-indexació de Posicions
En esborrar un element, totes les posicions restants es re-calculen per mantenir la seqüència:
```javascript
data.itemListElement.forEach((el, i) => { el.position = i + 1; });
```

### Arxivament (Soft Delete)
En lloc d'esborrar, el sistema permet arxivar elements via `additionalProperty`. El frontend filtra els arxivats automàticament a `extractItems()`. L'admin pot desarxivar-los en qualsevol moment.

---

## 10. Processament i Implementació de Multimèdia (El Joc Musical)

A la SPA (`joc.js`), el joc musical desglossa les propietats JSON vinculant l'esquema global `associatedMedia` amb objectes purs tipus Media.

### Estat Centralitzat del Joc
```javascript
export const gameState = {
  mode: null,           // 'random' | null
  questionnaire: null,  // objecte qüestionari actiu
  length: null,         // 5 | 20
  allQuestions: [],     // pool completa (cacheada)
  questions: [],        // subconjunt barrejat per la partida activa
  currentIndex: 0,
  score: 0,
  answers: [],          // historial complet de respostes
  phase: 'setup'        // 'setup' | 'playing' | 'results'
};
```

### Normalitzadors Schema.org a Tipus Interns
El `normalizeQuestion()` converteix el format Schema.org a un objecte intern simplificat. Detecta el `@type` de `associatedMedia` i extreu les URLs de manera específica per a cada tipus:

- **`AudioObject`**: Extreu `contentUrl` i `encodingFormat` per a la font d'àudio.
- **`ImageObject`**: Itera sobre `encoding[]` buscant `image/webp` i `image/jpeg`.
- **`VideoObject`**: Itera sobre `encoding[]` buscant `video/webm` i `video/mp4`.

```javascript
const acceptedId = schemaQuestion.acceptedAnswer?.['@id'];
return {
  answer: answers.findIndex(a => a['@id'] === acceptedId), // Índex numèric (0-3)
  options: answers.map(a => a.text), // Ordre garantit per 'position'
};
```
La resposta correcta es desa com a índex numèric (0-3), no com a text, per ser resistent a canvis de text sense modificar la lògica.

### Renderització de Media
**Audio (`AudioObject`)**: Genera reproductors nadius (`<audio controls autoplay>`), delegant al sistema operatiu les funcions d'accessibilitat per a lectors de pantalles (Media Session API).

**Imatge (`ImageObject`)**: Utilitza `<picture>` amb `<source srcset>` per a WebP i `<img>` com a fallback JPEG, permetent als navegadors triar el format òptim.

**Vídeo (`VideoObject`)**: Amb configuracions `controls autoplay playsinline muted` garanteix que les reproduccions estiguin eximides dels bloquejos estrictes dels navegadors com Safari per a iOS o Chrome quant a la reproducció no sol·licitada. Les opcions `.mp4` actuen com a pla B en cas que `.webm` no estigui suportat.

```javascript
if (type === 'video') {
  return `<video class="joc-media-video" controls autoplay playsinline muted>
    ${src.webm ? `<source src="${escapeHtml(src.webm)}" type="video/webm">` : ''}
    ${src.mp4  ? `<source src="${escapeHtml(src.mp4)}"  type="video/mp4">` : ''}
  </video>`;
}
```

### Barreja Fisher-Yates
La funció `shuffle()` implementa l'algorisme de Fisher-Yates (Knuth) per garantir una distribució uniformement aleatòria:
```javascript
function shuffle(array) {
  const arr = [...array]; // No muta l'original
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

### Càrrega Concurrent de Dades del Joc
Les preguntes i els qüestionaris es carreguen en paral·lel amb `Promise.all`:
```javascript
const [qData, qdData] = await Promise.all([
  fetch('data/questions.json').then(r => r.json()),
  fetch('data/questionnaires.json').then(r => r.json())
]);
```

### Protecció XSS
Tot el text dinàmic que s'injecta al DOM usa `escapeHtml()` per evitar injeccions de codi maliciós:
```javascript
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML; // Escapa <, >, &, ", '
}
```
Aquesta tècnica usa el propi parseador del navegador per escapar els caràcters especials, sent més fiable que les substitucions manuals amb expressions regulars.

---

## 11. Mòdul de Mapes Leaflet (`mapModule.js`)

### Càrrega Lazy de Leaflet amb SRI
Leaflet (CSS + JS) es carrega dinàmicament la primera vegada que l'usuari visita la vista del mapa, no en el carregament inicial de la pàgina. Una promesa singleton evita càrregues dobles:

```javascript
let leafletLoadPromise = null;

function loadLeaflet() {
  if (leafletLoadPromise) return leafletLoadPromise; // Reutilitza si ja s'ha iniciat
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (window.L) { resolve(); return; } // Ja carregat
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.integrity = LEAFLET_JS_INTEGRITY; // SRI hash
    script.crossOrigin = '';
    script.onload = resolve; script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}
```

Els hashes d'integritat SRI (`sha256-...`) garanteixen que no s'executi codi modificat del CDN en un atac de supply chain.

### Marcadors SVG Personalitzats per Categoria
En lloc d'icones predefinides de Leaflet, s'usa un `L.divIcon` amb SVG inline per controlar el color per categoria:

```javascript
const CATEGORY_COLORS = {
  'concert': '#C45A3C',
  'festival': '#D4A843',
  'festa popular': '#6B8E4E'
};

function createMarkerIcon(color) {
  return L.divIcon({
    html: `<svg width="28" height="40">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z"
            fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="6" fill="#fff" fill-opacity="0.9"/>
    </svg>`,
    iconAnchor: [14, 40], popupAnchor: [0, -42]
  });
}
```

### Delay de 50ms abans de la Inicialització
Quan la vista del mapa passa de `display:none` a `display:block`, el navegador no ha processat el reflow del layout. Leaflet necessita que el contenidor tingui dimensions reals per calcular el viewport:

```javascript
await new Promise(resolve => setTimeout(resolve, 50)); // Espera el reflow
leafletMap = await initMap('map');
```

### `fitBounds` Adaptatiu
Després d'afegir tots els markers, el mapa s'adapta automàticament al bounding box de tots els punts visibles, amb un padding de 30px i un zoom màxim de 12 per evitar zoom excessiu en events molt propers:

```javascript
map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
```

---

## 12. Mòdul de Renderització (`renderer.js`)

### Pipeline d'Imatges: AVIF → WebP → JPEG
La funció `generatePictureElement()` deriva automàticament les rutes AVIF i WebP a partir de la ruta JPEG base, construint un `<picture>` amb tres fonts:

```javascript
const basePath = imagePath.replace(/\.[^.]+$/, ''); // Treu extensió
const avifPath = basePath + '.avif'; // Millor compressió (Chrome, Firefox)
const webpPath = basePath + '.webp'; // Bon suport (tots els navegadors moderns)
// JPEG: fallback universal

return `<picture>
  <source srcset="${avifPath}" type="image/avif">
  <source srcset="${webpPath}" type="image/webp">
  <img src="${imagePath}" loading="${lazy ? 'lazy' : 'eager'}" fetchpriority="${highPriority ? 'high' : 'auto'}">
</picture>`;
```

Les imatges d'above-the-fold (com els events destacats de la portada) usen `loading="eager"` i `fetchpriority="high"` per millorar el LCP (Largest Contentful Paint).

### Placeholder SVG Inline per Artistes Sense Imatge
Quan un artista no té imatge, es genera un SVG inline amb les inicials i un color de fons determinista (basat en `name.length % bgColors.length`), garantint que el mateix artista sempre tingui el mateix color:

```javascript
const bgColors = ['#1B4965', '#C45A3C', '#6B8E4E', '#A3432A', '#2D6A8F', '#4F6B38'];
const colorIndex = artist.name.length % bgColors.length;
```

### Embed de Spotify
Si un artista té `spotifyId` vàlid (no buit ni d'exemple), es genera un iframe embed de Spotify amb `loading="lazy"` per no bloquejar el carregament del modal:
```html
<iframe src="https://open.spotify.com/embed/artist/{spotifyId}?theme=0"
        width="100%" height="152" allow="encrypted-media" loading="lazy">
</iframe>
```

---

## 13. Sistema de Filtres Multi-Criteri (`filters.js`)

### Filtres d'Artistes
`filterArtists()` implementa tres criteris aplicats en cascada:
1. **Cerca de text**: Coincidència parcial sobre `name`, `description` i tots els items de `genre[]`.
2. **Gènere**: Comparació case-insensitive entre el valor del filtre i cada element de `genre[]`.
3. **Zona**: Comparació exacta amb `artist.zone` (mapat des de `areaServed`).

### Filtres d'Esdeveniments
`filterEvents()` amplia amb tres criteris addicionals:
4. **Cerca de text**: Inclou `location.name` i `performer.name` a més de nom i descripció.
5. **Rang de dates**: `dateFrom` i `dateTo` comparen les dates de `startDate` amb els valors `YYYY-MM-DD`. La data final s'estén fins a les `23:59:59` per incloure events del dia sencer.
6. **Categoria**: Comparació exacta amb el camp `category` (`concert`, `festival`, `festa popular`).

### Helpers de Filtre Dinàmics
`getUniqueGenres()`, `getUniqueZones()` i `getUniqueCategories()` calculen els valors únics disponibles a les dades actuals per omplir dinàmicament els selectors `<select>` dels filtres.

### Algoritme d'Esdeveniments del Cap de Setmana
`getWeekendEvents()` calcula el proper cap de setmana (divendres-diumenge) des de la data actual, gestionant correctament el cas on "avui ja és cap de setmana":

```javascript
let fridayOffset = 5 - dayOfWeek;
if (fridayOffset < 0) fridayOffset += 7;
if (dayOfWeek >= 5 || dayOfWeek === 0)
  fridayOffset = dayOfWeek === 0 ? -2 : -(dayOfWeek - 5);
```

---

## 14. Sistema de Favorits (`favorites.js`)

### Persistència a `localStorage`
Els favorits es guarden directament al navegador sota claus fixes:
```javascript
const STORAGE_KEY_ARTISTS = 'bauxa_fav_artists';
const STORAGE_KEY_EVENTS  = 'bauxa_fav_events';
```

### Event Personalitzat `favoritesChanged`
Quan es modifica un favorit, `toggleFavorite()` dispara un `CustomEvent` global que la UI pot escoltar per actualitzar badges i estils sense acoblament directe:

```javascript
window.dispatchEvent(new CustomEvent('favoritesChanged', {
  detail: { type, id, isFavorite: index === -1 }
}));
```

Exemple d'ús a `ui.js` per actualitzar el badge del navbar:
```javascript
window.addEventListener('favoritesChanged', updateFavoriteBadge);
```

---

## 15. Exportació ICS de Calendari (`calendar.js`)

### Generació RFC 5545
`generateICS()` crea un fitxer `.ics` vàlid per a Apple Calendar, Google Calendar i Outlook:

```javascript
return [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Dona\'m Bauxa//CA',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  `DTSTART:${start}`,         // Format: 20260307T210000Z
  `UID:${event['@id']}@donamBauxa`, // UID únic per event
  `SUMMARY:${event.name}`,
  `LOCATION:${location}`,     // Adreça completa concatenada
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n'); // RFC 5545 exigeix CRLF (\r\n)
```

### Descàrrega via Blob URL
`downloadICS()` crea un `Blob` temporal, genera una URL d'objecte, simula un clic i allibera la URL per evitar fuites de memòria:

```javascript
const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url; link.download = `${eventName}.ics`;
document.body.appendChild(link); link.click(); document.body.removeChild(link);
URL.revokeObjectURL(url); // Allibera la referència de memòria
```

---

## 16. Optimització Web Completa (Core Web Vitals)

Per certificar velocitat en dispositius de gamma d'entrada, els conceptes següents estan implementats directament a nivell de l'HTML (`index.html`):

### Anti-CLS (Cumulative Layout Shift)
Per a tots els dissenys en quadrícula on les imatges o llistats tarden més de 300ms a resoldre's, s'utilitzen estils en línia com `<div class="skeleton-block" style="height:380px;"></div>`. Les mides calculades preserven l'espai i destrueixen el CLS en carregar les targetes de DOM completades.

### Fonts Crítiques (`font-synthesis: none`)
Evita que els navegadors forcin tipografies itàliques/negretes falses durant el procés de resolució, estabilitzant les proporcions tipogràfiques de text (Font Fallback).

### Module Preload & Async Print (`<link rel="modulepreload">`)
S'ha deslligat el bloqueig natural del codi i CSS asíncron emulant el clàssic hack de `media="print"` perquè les fonts icòniques (Bootstrap Icons) i de Google es llegeixin en paral·lel en fils secundaris i es modifiquin a `media="all"` just en acabar.

### DNS Tunnelling
Utilitzant etiquetes `<link rel="preconnect" ...>` la petició als certificats TLS globals cap als CDNs i resolució IP avança substancialment l'accés en paral·lel als dominis.

### DOM SVG Inline LCP
Les gràfiques inicials com el logo SVG del Hero actuen a la línia HTML inicial i no com arxiu annex. Això converteix aquesta imatge en la LCP (Largest Contentful Paint) carregada en qüestió de zero latències en ser parsejat el codi de la capçalera (Header).

### `fetchpriority="high"` per Events Destacats
Els primers events destacats de la portada usen `fetchpriority="high"` per indicar al navegador que aquestes imatges son prioritàries per al LCP, a diferència dels elements sota el fold que usen `loading="lazy"`.

---

## 17. Desplegament i Configuració de Producció

### Vercel (`vercel.json`)
```json
{
  "version": 2,
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/server.js" }]
}
```
Totes les rutes (incloent els fitxers estàtics) passen per `server.js`, que serveix la carpeta `frontend/` via `express.static`. Vercel executa el servidor en mode serverless (funció Lambda), però Express gestiona internament el routing.

### Limitació del Sistema de Fitxers de Vercel (EROFS)
En producció a Vercel, el sistema de fitxers és de només lectura. Les operacions d'escriptura (`writeJSON`) capturen el error `EROFS` sense fer crashejar el servidor, però les modificacions no es persisten. En producció real, es requeriria migrar a una base de dades real (p.ex. Supabase Database en lloc de fitxers JSON locals).

### Variables d'Entorn Requerides
```
SUPABASE_URL            # URL del projecte Supabase
SUPABASE_SERVICE_KEY    # Clau de servei (server-side, no pública)
NODE_ENV=production     # Activa redirects i trust proxy
PORT                    # Port del servidor (default: 3000)
```

### Actiu d'Àudio: Format M4A
Tots els fitxers d'àudio del joc (`frontend/assets/audio/*.m4a`) estan en format M4A (AAC), que ofereix un bon balanç entre qualitat i mida de fitxer, amb suport universal als navegadors moderns via el contenidor `audio/mp4`.

---

## 18. Accessibilitat (a11y)

L'aplicació incorpora múltiples pràctiques d'accessibilitat:

- **`aria-label`** en tots els botons d'icona (favorits, calendari, mapes) que no tenen text visible.
- **`aria-live="polite"`** en el HUD de puntuació del joc per anunciar canvis als lectors de pantalla.
- **`role="progressbar"`** amb `aria-valuenow`, `aria-valuemin`, `aria-valuemax` a la barra de progrés del joc.
- **`role="group"`** i **`aria-label`** als grups de botons d'opcions del joc.
- **`aria-disabled="true"`** en els botons desactivats per compatibilitat amb tecnologies assistives.
- **Focus management**: Quan l'usuari respon una pregunta, el botó "Següent" rep el focus automàticament (`nextBtn.focus()`).
- **Textos alternatius** en totes les imatges, incloent el SVG placeholder dels artistes.
- **Estructura semàntica**: Ús de `<article>`, `<section>`, `<h2>`, `<h3>` correctament jerarquitzats per a una navegació accessible.
