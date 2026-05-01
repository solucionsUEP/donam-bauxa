import { createHash } from 'crypto';
import { supabase, rowToProfile } from '../helpers/supabase.js';

async function getUserRow(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  return userRow || null;
}

async function getApiKeyRow(req) {
  const key = req.headers['x-api-key'];
  if (!key) return null;

  const hash = createHash('sha256').update(key).digest('hex');

  const { data: row } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', hash)
    .eq('revoked', false)
    .single();

  if (!row) return null;

  supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);

  return {
    id:    row.id,
    name:  row.agent_name,
    email: row.agent_email,
    role:  'promotor',
  };
}

async function getAuthRow(req) {
  const userRow = await getUserRow(req);
  if (userRow) return userRow;
  return getApiKeyRow(req);
}

export async function requireAuth(req, res, next) {
  const userRow = await getAuthRow(req);
  if (!userRow) return res.status(401).json({ error: 'No autenticat' });
  req.userProfile = rowToProfile(userRow);
  next();
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    if (!process.env.SUPABASE_URL) {
      req.userProfile = { '@id': 'dev', name: 'Dev', email: 'dev@dev', jobTitle: 'admin' };
      return next();
    }
    const userRow = await getAuthRow(req);
    if (!userRow || !roles.includes(userRow.role)) {
      return res.status(403).json({ error: 'No autoritzat' });
    }
    req.userProfile = rowToProfile(userRow);
    next();
  };
}
