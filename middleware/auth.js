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

export async function requireAuth(req, res, next) {
  const userRow = await getUserRow(req);
  if (!userRow) return res.status(401).json({ error: 'No autenticat' });
  req.userProfile = rowToProfile(userRow);
  next();
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    // Dev bypass
    if (!process.env.SUPABASE_URL) {
      req.userProfile = { role: 'admin' };
      return next();
    }
    const userRow = await getUserRow(req);
    if (!userRow || !roles.includes(userRow.role)) {
      return res.status(403).json({ error: 'No autoritzat' });
    }
    req.userProfile = rowToProfile(userRow);
    next();
  };
}
