import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './helpers/supabase.js';

import profileRoutes from './routes/profile.js';
import contentRoutes from './routes/content.js';
import usersRoutes from './routes/users.js';
import requestsRoutes from './routes/requests.js';
import apiKeysRoutes from './routes/apiKeys.js';
import analyzeRoutes from './routes/analyze.js';
import chatRoutes from './routes/chat.js';
import versionRoutes from './routes/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// CORS — production (Dondominio) frontend calls this Vercel backend cross-origin.
// Allow-list:
//   • Production Dondominio domain (and www subdomain)
//   • Vercel preview deploys (*.vercel.app)
//   • Local dev (any port via localhost / 127.0.0.1)
//   • Tailnet (100.x.x.x and *.ts.net) for personal-network dev
const PROD_ORIGINS = [
  'https://donambauxa.online',
  'https://www.donambauxa.online',
];
const localhostRe   = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const vercelRe      = /^https:\/\/[^/]+\.vercel\.app$/;
const tailnetRe     = /^http:\/\/(100\.\d+\.\d+\.\d+|[^/]+\.ts\.net)(:\d+)?$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (PROD_ORIGINS.includes(origin)) return true;
  return localhostRe.test(origin) || vercelRe.test(origin) || tailnetRe.test(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

// PWA freshness check — must be mounted BEFORE static so the file (if it ever
// exists in /frontend) can't shadow the dynamic endpoint, and must never be
// cached by any layer.
app.use('/version.json', versionRoutes);

// Service worker must be served from the root scope with no caching so updates
// propagate immediately. (The static handler below sets default caching.)
app.get('/sw.js', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Service-Worker-Allowed', '/');
  next();
});

// Static assets — mirror production Apache (.htaccess) caching so local
// Lighthouse runs reflect real cache/compression behavior.
app.use(express.static(join(__dirname, 'frontend'), {
  setHeaders(res, path) {
    if (/\.(js|mjs|css|avif|webp|jpg|jpeg|png|svg|ico|woff2)$/.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Auth: retorna el perfil de l'usuari autenticat via Supabase JWT
app.get('/auth/me', async (req, res) => {
  // Mock auth for local development without Supabase
  if (!process.env.SUPABASE_URL) {
    return res.json({
      authenticated: true,
      user: { id: 'dev-user', email: 'dev@local', name: 'Developer' },
      profile: {
        '@id': 'dev-user',
        role: 'admin',
        displayName: 'Local Admin (Dev Mode)',
        image: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
      }
    });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ authenticated: false });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.json({ authenticated: false });

  // Crea l'usuari a la taula users si no existeix
  let { data: userRow } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!userRow) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({
        id: user.id,
        name: user.user_metadata?.full_name || user.email,
        email: user.email,
        image: user.user_metadata?.avatar_url || '',
        role: 'lector',
        display_name: user.user_metadata?.full_name || user.email
      })
      .select()
      .single();
    userRow = newUser;
  }

  res.json({
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.user_metadata?.full_name },
    profile: {
      '@id': userRow.id,
      role: userRow.role,
      displayName: userRow.display_name || userRow.name,
      image: userRow.image,
      description: userRow.description
    }
  });
});

// API routes
app.use('/api/profile', profileRoutes);
app.use('/api/admin', contentRoutes);
app.use('/api/admin/users', usersRoutes);
app.use('/api/admin/api-keys', apiKeysRoutes);
app.use('/api/analyze-instagram', analyzeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/admin/requests', requestsRoutes);

app.listen(PORT, HOST, () => console.log(`Server running at http://${HOST}:${PORT}`));

export default app;
