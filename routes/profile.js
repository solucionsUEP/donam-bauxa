import { Router } from 'express';
import { supabase, rowToProfile } from '../helpers/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ profile: req.userProfile });
});

router.put('/', requireAuth, async (req, res) => {
  const { displayName, description } = req.body;
  const googleId = req.userProfile['@id'];

  const updates = {};
  if (displayName !== undefined) updates.display_name = displayName;
  if (description !== undefined) updates.description = description;

  const { data: updated, error } = await supabase
    .from('users')
    .update(updates)
    .eq('google_id', googleId)
    .select()
    .single();

  if (error || !updated) return res.status(500).json({ error: 'Error actualitzant perfil' });
  res.json({ profile: rowToProfile(updated) });
});

export default router;
