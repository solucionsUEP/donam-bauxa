import 'dotenv/config';
import express from 'express';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// CORS
const allowedOrigins = [
  'https://donambauxa.online',
  'https://www.donambauxa.online',
  `http://localhost:${PORT}`
];
// Tailnet origins: allow any http://100.x.x.x:PORT and any *.ts.net:PORT host.
const tailnetOriginRe = new RegExp(`^http://(100\\.\\d+\\.\\d+\\.\\d+|[^/]+\\.ts\\.net):${PORT}$`);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || tailnetOriginRe.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'frontend')));

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
