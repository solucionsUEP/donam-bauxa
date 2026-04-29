# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start server with auto-reload (node --watch server.js)
npm start      # Start server in production (node server.js)
```

No lint or test commands are configured.

## Architecture

**Dona'm Bauxa** is a music event discovery platform for Mallorca. It is a Node.js/Express backend serving a vanilla JS SPA frontend, deployed on Vercel.

### Stack

- **Backend**: Express.js, Node.js ES modules
- **Frontend**: Vanilla JS SPA (no framework), Bootstrap 5, Leaflet maps
- **Database**: Supabase (PostgreSQL) for users and requests; JSON files in `frontend/data/` for content (artists, events, news)
- **Auth**: Supabase Google OAuth 2.0 + JWT Bearer tokens; `cookie-session` for session management

### Data flow

The frontend is a hash-based SPA (`#home`, `#artists`, `#events`, `#map`, `#favorits`, `#profile`, `#solicituds`, `#admin`). Content (artists, events, news) is loaded from static JSON files. User data and change requests go through the Express API.

```
Frontend (SPA) → Express API → Supabase (users/requests)
                             → JSON files (artists/events/news)
```

### Hybrid storage model

- **Supabase** holds `users` (profile, role) and `requests` (pending/approved/rejected content changes)
- **JSON files** (`frontend/data/`) hold content data — read by the SPA directly; written by admin API endpoints
- File writes use a mutex pattern (`helpers/json.js`) to prevent concurrent write corruption
- On Vercel the filesystem is read-only, so `writeJSON` catches errors gracefully

### Role system

Three roles: `lector` (read-only), `promotor` (can submit change requests), `admin` (full CRUD).

- Promotors POST to `/api/requests` to propose artist/event/news changes (stored in DB as `pending`)
- Admins review and approve/reject via the same endpoint; approved changes are applied to JSON files
- Middleware: `requireAuth()`, `requireRole('admin')`, etc. in `middleware/auth.js`

### API structure

| Prefix | Purpose |
|--------|---------|
| `/auth/me` | Returns/creates authenticated user profile |
| `/api/profile` | Read/update own profile |
| `/api/admin/*` | CRUD for artists, events, news (admin only) |
| `/api/admin/users` | User management (admin only) |
| `/api/requests` | Submit and manage content change requests |

### Schema.org

Data objects use Schema.org types (`@type`, `@id`, `@context`) — e.g., `Person`, `MusicEvent`. `rowToProfile()` in `helpers/supabase.js` converts DB rows into these objects.

### Favorites

Stored in `localStorage` only; no backend persistence.

### Environment variables

```
SUPABASE_URL, SUPABASE_SERVICE_KEY   # Backend DB access
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL  # OAuth
SESSION_SECRET, FRONTEND_URL, PORT, NODE_ENV, VERCEL
```
