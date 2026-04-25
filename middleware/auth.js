import { supabase, rowToProfile } from '../helpers/supabase.js';

export async function requireAuth(req, res, next) {
  const user = req.user || req.session?.user;
  if (!user) return res.status(401).json({ error: 'No autenticat' });
  req.user = user;

  const { data: userRow } = await supabase
    .from('users')
    .select('*')
    .eq('google_id', user.id)
    .single();

  if (!userRow) return res.status(401).json({ error: 'Usuari no trobat' });
  req.userProfile = rowToProfile(userRow);
  next();
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    const user = req.user || req.session?.user;
    if (!user) return res.status(401).json({ error: 'No autenticat' });
    req.user = user;

    const { data: userRow } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', user.id)
      .single();

    if (!userRow || !roles.includes(userRow.role)) {
      return res.status(403).json({ error: 'No autoritzat' });
    }
    req.userProfile = rowToProfile(userRow);
    next();
  };
}
