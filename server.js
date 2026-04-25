import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJSON, writeJSON, writeJSONSafe, generateId } from './helpers/json.js';

// Route modules
import profileRoutes from './routes/profile.js';
import contentRoutes from './routes/content.js';
import usersRoutes from './routes/users.js';
import requestsRoutes from './routes/requests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;

const USERS_PATH = join(__dirname, 'server-data', 'users.json');

// --- Passport setup ---

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${process.env.PORT || 3000}/auth/google/callback`
}, async (_accessToken, _refreshToken, profile, done) => {
  const email = profile.emails?.[0]?.value?.toLowerCase() || '';
  const user = {
    id: profile.id,
    name: profile.displayName,
    email,
    image: profile.photos?.[0]?.value || ''
  };

  // Find or create user in users.json
  await findOrCreateUser(user);

  done(null, user);
}));

async function findOrCreateUser(googleUser) {
  const data = readJSON(USERS_PATH);
  const existing = data.itemListElement.find(
    el => el.item.identifier === googleUser.id
  );

  if (existing) {
    // Update name/email/image from Google in case they changed
    existing.item.name = googleUser.name;
    existing.item.email = googleUser.email;
    existing.item.image = googleUser.image;
    writeJSON(USERS_PATH, data);
    return existing.item;
  }

  // Create new user with role 'lector'
  await writeJSONSafe(USERS_PATH, async (data) => {
    const { id, position } = generateId('user', data.itemListElement);

    data.itemListElement.push({
      '@type': 'ListItem',
      position,
      item: {
        '@context': 'https://schema.org',
        '@type': 'Person',
        '@id': id,
        identifier: googleUser.id,
        name: googleUser.name,
        email: googleUser.email,
        image: googleUser.image,
        jobTitle: 'lector',
        description: '',
        additionalProperty: [
          { '@type': 'PropertyValue', name: 'displayName', value: googleUser.name }
        ],
        dateCreated: new Date().toISOString()
      }
    });
    data.numberOfItems = data.itemListElement.length;
  });
}

// --- Middleware ---

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.set('trust proxy', 1);
}

// Redirigir visites a Vercel cap al domini oficial
if (isProduction) {
  app.use((req, res, next) => {
    const isVercelDomain = req.hostname === 'donam-bauxa.vercel.app';
    const isApiOrAuth = req.path.startsWith('/api') || req.path.startsWith('/auth');
    if (isVercelDomain && !isApiOrAuth) {
      return res.redirect(301, `https://donambauxa.online${req.path}`);
    }
    next();
  });
}

// CORS per permetre peticions des del frontend a DonDominio
const allowedOrigins = [
  'https://donambauxa.online',
  'https://www.donambauxa.online',
  `http://localhost:${PORT}`
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(cookieSession({
  name: 'donam-bauxa-session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-canvia-en-produccio'],
  maxAge: 24 * 60 * 60 * 1000, // 24h
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax'
}));

// Passport compatibility shim: cookie-session no implementa regenerate/save
app.use((req, _res, next) => {
  if (req.session && !req.session.regenerate) {
    req.session.regenerate = (cb) => { cb(); };
  }
  if (req.session && !req.session.save) {
    req.session.save = (cb) => { cb(); };
  }
  next();
});

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

// Serve static frontend
app.use(express.static(join(__dirname, 'frontend')));

// --- Auth routes ---

app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}/#home` }),
  (req, res) => {
    if (req.user) req.session.user = req.user;
    res.redirect(`${FRONTEND_URL}/#home`);
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.user = null;
    res.redirect(`${FRONTEND_URL}/#home`);
  });
});

app.get('/auth/me', (req, res) => {
  const user = req.user || req.session?.user;
  if (!user) return res.json({ authenticated: false });
  req.user = user;

  const users = readJSON(USERS_PATH);
  const userItem = users.itemListElement.find(
    el => el.item.identifier === req.user.id
  );

  if (!userItem) {
    return res.json({
      authenticated: true,
      user: req.user,
      profile: {
        '@id': null,
        role: 'lector',
        displayName: req.user.name,
        image: req.user.image,
        description: ''
      }
    });
  }

  res.json({
    authenticated: true,
    user: req.user,
    profile: {
      '@id': userItem.item['@id'],
      role: userItem.item.jobTitle,
      displayName: userItem.item.additionalProperty?.find(p => p.name === 'displayName')?.value || userItem.item.name,
      image: userItem.item.image,
      description: userItem.item.description
    }
  });
});

// --- API routes ---

app.use('/api/profile', profileRoutes);
app.use('/api/admin', contentRoutes);
app.use('/api/admin/users', usersRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/admin/requests', requestsRoutes);

// --- Start (only in local dev; Vercel uses the exported app) ---

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

export default app;
