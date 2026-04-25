import { Router } from 'express';
import { supabase, rowToProfile } from '../helpers/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireRole('admin'), async (_req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Usuaris registrats',
    numberOfItems: users.length,
    itemListElement: users.map((u, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: rowToProfile(u)
    }))
  });
});

router.put('/:id/role', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const validRoles = ['lector', 'promotor', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Rol invàlid. Rols vàlids: ${validRoles.join(', ')}` });
  }

  const { data: updated, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', id)
    .select()
    .single();

  if (error || !updated) return res.status(404).json({ error: 'Usuari no trobat' });
  res.json({ success: true, user: rowToProfile(updated) });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;

  if (req.userProfile['@id'] === id) {
    return res.status(400).json({ error: 'No pots eliminar-te a tu mateix' });
  }

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id);

  if (error) return res.status(404).json({ error: 'Usuari no trobat' });
  res.json({ success: true });
});

export default router;
