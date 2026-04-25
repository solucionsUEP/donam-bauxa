import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './helpers/supabase.js';

import profileRoutes from './routes/profile.js';
import contentRoutes from './routes/content.js';
import usersRoutes from './routes/users.js';
import requestsRoutes from './routes/requests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) app.set('trust proxy', 1);

// Redirigir visites a Vercel cap al domini oficial
if (isProduction) {
  app.use((req, res, next) => {
    const isVercelDomain = req.hostname === 'donam-bauxa.vercel.app';
    const isApi = req.path.startsWith('/api') || req.path.startsWith('/auth');
    if (isVercelDomain && !isApi) {
      return res.redirect(301, `https://donambauxa.online${req.path}`);
    }
    next();
  });
}

// CORS
const allowedOrigins = [
  'https://donambauxa.online',
  'https://www.donambauxa.online',
  `http://localhost:${PORT}`
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(join(__dirname, 'frontend')));

// Auth: retorna el perfil de l'usuari autenticat via Supabase JWT
app.get('/auth/me', async (req, res) => {
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
app.use('/api/requests', requestsRoutes);
app.use('/api/admin/requests', requestsRoutes);

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

export default app;
