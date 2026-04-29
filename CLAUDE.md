# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start local Node.js dev server (node --watch server.js)
npm start      # Start Node.js server in production mode
```

No lint or test commands are configured.

## Architecture

**Dona'm Bauxa** is a music event discovery platform for Mallorca. It is a vanilla JS SPA frontend with two backends:

- **Production**: PHP backend on Apache traditional hosting (`api/`)
- **Local dev**: Node.js/Express backend (`server.js`, `routes/`)

### Stack

- **Production backend**: PHP 8+, cURL to Supabase REST API, Apache with `.htaccess` router
- **Local dev backend**: Express.js, Node.js ES modules, `@supabase/supabase-js`
- **Frontend**: Vanilla JS SPA (no framework), Bootstrap 5, Leaflet maps — served from `frontend/`
- **Database**: Supabase (PostgreSQL) for users and requests; JSON files in `frontend/data/` for content (artists, events, news)
- **Auth**: Supabase Google OAuth 2.0 + JWT Bearer tokens validated per-request

### Deployment

The site is hosted on Apache. `frontend/.htaccess` routes `/api/*` and `/auth/*` to `api/index.php`. The PHP credentials file `api/config.php` is **gitignored** and must be uploaded manually via FTP.

### Data flow

The frontend is a hash-based SPA (`#home`, `#artists`, `#events`, `#map`, `#favorits`, `#profile`, `#solicituds`, `#admin`). `BACKEND_URL = ''` so all API calls go to the same origin.

```
Frontend (SPA) → PHP API (api/index.php) → Supabase REST API (users/requests)
                                          → JSON files (frontend/data/)
```

### PHP API structure (`api/`)

| File | Purpose |
|------|---------|
| `api/index.php` | Router — matches URI and dispatches to route files |
| `api/config.php` | Constants: SUPABASE_URL, SUPABASE_SERVICE_KEY, DATA_DIR (**gitignored**) |
| `api/helpers/supabase.php` | cURL wrappers: `sbSelect`, `sbSelectOne`, `sbInsert`, `sbUpdate`, `sbDelete`, `rowToProfile` |
| `api/helpers/auth.php` | `requireRole(['admin'])` — validates Bearer token via Supabase `/auth/v1/user` |
| `api/helpers/json.php` | `readJSON`, `writeJSONSafe` (mutex), `generateId` |
| `api/routes/requests.php` | GET/POST `/api/requests`, PUT `/api/admin/requests/{id}/approve\|reject` |
| `api/routes/content.php` | CRUD `/api/admin/{artists\|events\|news}` |
| `api/routes/profile.php` | GET/PUT `/api/profile` |
| `api/routes/users.php` | `/api/admin/users` |
| `api/routes/auth.php` | GET `/auth/me` |

### Hybrid storage model

- **Supabase** holds `users` (profile, role) and `requests` (pending/approved/rejected content changes)
- **JSON files** (`frontend/data/`) hold content data — read by the SPA directly; written by admin API endpoints
- File writes use `writeJSONSafe` (flock mutex) to prevent concurrent write corruption
- `DATA_DIR` is defined in `config.php` as `dirname(__DIR__) . '/data'` — on the server this resolves to `frontend/data/`

### Role system

Three roles: `lector` (read-only), `promotor` (can submit change requests), `admin` (full CRUD).

- Promotors POST to `/api/requests` to propose artist/event/news changes (stored in DB as `pending`)
- Admins review and approve/reject; approved changes are applied to JSON files
- Auth: `requireRole(['promotor', 'admin'])` in `api/helpers/auth.php`

### Schema.org

Data objects use Schema.org types (`@type`, `@id`, `@context`) — e.g., `Person`, `MusicGroup`, `MusicEvent`. `rowToProfile()` in `api/helpers/supabase.php` converts DB rows into these objects.

### Favorites

Stored in `localStorage` only; no backend persistence.

### PHP config (`api/config.php` — gitignored)

```php
define('SUPABASE_URL',         'https://....supabase.co');
define('SUPABASE_SERVICE_KEY', '...');
define('SUPABASE_JWT_SECRET',  '...');
define('DATA_DIR', dirname(__DIR__) . '/data');
define('FRONTEND_URL', 'https://donambauxa.online');
```

### Node.js local dev (`.env`)

```
SUPABASE_URL, SUPABASE_SERVICE_KEY
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL
SESSION_SECRET, FRONTEND_URL, PORT, NODE_ENV
```
