import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { supabase } from '../helpers/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

function rowToApiKey(row) {
  return {
    id:           row.id,
    name:         row.name,
    agent_name:   row.agent_name,
    agent_email:  row.agent_email,
    created_at:   row.created_at,
    last_used_at: row.last_used_at,
    revoked:      row.revoked,
  };
}

// GET /api/admin/api-keys
router.get('/', requireRole('admin'), async (req, res) => {
  const { data: rows, error } = await supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(rows.map(rowToApiKey));
});

// POST /api/admin/api-keys
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, agent_name, agent_email } = req.body;
  if (!name || !agent_name) {
    return res.status(400).json({ error: 'Falten camps: name, agent_name' });
  }

  const rawKey = 'dbx_' + randomBytes(32).toString('hex');
  const hash   = createHash('sha256').update(rawKey).digest('hex');

  const { data: row, error } = await supabase
    .from('api_keys')
    .insert({ name, key_hash: hash, agent_name, agent_email })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ key: rawKey, api_key: rowToApiKey(row) });
});

// DELETE /api/admin/api-keys/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { data: row } = await supabase
    .from('api_keys')
    .select('id')
    .eq('id', req.params.id)
    .single();

  if (!row) return res.status(404).json({ error: 'Clau no trobada' });

  await supabase.from('api_keys').update({ revoked: true }).eq('id', req.params.id);
  res.json({ success: true });
});

export default router;
