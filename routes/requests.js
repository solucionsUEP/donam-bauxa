import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJSON } from '../helpers/json.js';
import { supabase } from '../helpers/supabase.js';
import { requireRole } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'frontend', 'data');

const CONTENT_PATHS = {
  artist: join(DATA_DIR, 'artists.json'),
  event: join(DATA_DIR, 'events.json'),
  news: join(DATA_DIR, 'news.json')
};

const STATUS = {
  pending:  'https://schema.org/PotentialActionStatus',
  approved: 'https://schema.org/CompletedActionStatus',
  rejected: 'https://schema.org/FailedActionStatus'
};

function rowToRequest(row) {
  return {
    '@type': row.type,
    '@id': row.id,
    agent: {
      '@type': 'Person',
      '@id': row.agent_id,
      name: row.agent_name,
      email: row.agent_email
    },
    actionStatus: STATUS[row.status],
    object: row.current_data || { '@type': 'Thing' },
    result: row.proposed_data,
    description: row.description,
    startTime: row.created_at,
    endTime: row.resolved_at,
    instrument: {
      '@type': 'Thing',
      name: 'entityType',
      description: row.entity_type,
      ...(row.reviewer_notes ? {
        additionalProperty: [{ '@type': 'PropertyValue', name: 'reviewerNotes', value: row.reviewer_notes }]
      } : {})
    }
  };
}

const router = Router();

// POST /api/requests
router.post('/', requireRole('promotor', 'admin'), async (req, res) => {
  try {
    const { entityType, entityId, action, proposedData, description } = req.body;

    if (!['artist', 'event', 'news'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType invàlid (artist, event, news)' });
    }
    if (!['create', 'update'].includes(action)) {
      return res.status(400).json({ error: 'action invàlida (create, update)' });
    }
    if (!proposedData || !description) {
      return res.status(400).json({ error: 'Falten camps obligatoris: proposedData, description' });
    }

    let currentObject = null;
    if (action === 'update' && entityId) {
      const contentData = readJSON(CONTENT_PATHS[entityType]);
      const existing = contentData.itemListElement.find(el => el.item['@id'] === entityId);
      if (!existing) return res.status(404).json({ error: 'Entitat no trobada' });
      currentObject = existing.item;
    }

    const { data: newRow, error } = await supabase
      .from('requests')
      .insert({
        type: action === 'create' ? 'CreateAction' : 'UpdateAction',
        agent_id: req.userProfile['@id'],
        agent_name: req.userProfile.name,
        agent_email: req.userProfile.email,
        entity_type: entityType,
        entity_id: entityId || null,
        current_data: currentObject,
        proposed_data: proposedData,
        description
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, request: rowToRequest(newRow) });
  } catch (err) {
    console.error('[requests] POST error:', err);
    res.status(500).json({ error: err.message || 'Error intern del servidor' });
  }
});

// GET /api/requests (només les del usuari actual)
router.get('/', requireRole('promotor', 'admin'), async (req, res) => {
  const { status } = req.query;
  const isAdminList = req.baseUrl === '/api/admin/requests';

  if (isAdminList && req.userProfile.jobTitle !== 'admin') {
    return res.status(403).json({ error: 'No autoritzat' });
  }

  let query = supabase.from('requests').select('*').order('created_at', { ascending: false });

  if (!isAdminList) query = query.eq('agent_id', req.userProfile['@id']);
  if (status && STATUS[status]) query = query.eq('status', status);

  const { data: rows, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const items = rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, item: rowToRequest(r) }));
  res.json({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items
  });
});

// GET /api/requests/:id
router.get('/:id', requireRole('promotor', 'admin'), async (req, res) => {
  const { data: row, error } = await supabase
    .from('requests')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !row) return res.status(404).json({ error: 'Solicitud no trobada' });

  if (req.userProfile.jobTitle === 'promotor' && row.agent_id !== req.userProfile['@id']) {
    return res.status(403).json({ error: 'No autoritzat' });
  }

  res.json({ request: rowToRequest(row) });
});

// PUT /api/admin/requests/:id/approve
router.put('/:id/approve', requireRole('admin'), async (req, res) => {
  const { data: row, error: fetchErr } = await supabase
    .from('requests')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !row) return res.status(404).json({ error: 'Solicitud no trobada' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Aquesta solicitud ja ha estat processada' });

  await supabase
    .from('requests')
    .update({ status: 'approved', resolved_at: new Date().toISOString() })
    .eq('id', req.params.id);

  res.json({ success: true, message: 'Solicitud aprovada' });
});

// PUT /api/admin/requests/:id/reject
router.put('/:id/reject', requireRole('admin'), async (req, res) => {
  const { notes } = req.body;

  const { data: row } = await supabase
    .from('requests')
    .select('status')
    .eq('id', req.params.id)
    .single();

  if (!row) return res.status(404).json({ error: 'Solicitud no trobada' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Ja processada' });

  await supabase
    .from('requests')
    .update({ status: 'rejected', reviewer_notes: notes || null, resolved_at: new Date().toISOString() })
    .eq('id', req.params.id);

  res.json({ success: true, message: 'Solicitud rebutjada' });
});

export default router;
