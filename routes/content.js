import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJSON, writeJSONSafe, generateId } from '../helpers/json.js';
import { requireRole } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'frontend', 'data');

const PATHS = {
  artists: join(DATA_DIR, 'artists.json'),
  events: join(DATA_DIR, 'events.json'),
  news: join(DATA_DIR, 'news.json'),
  questionnaires: join(DATA_DIR, 'questionnaires.json'),
  questions: join(DATA_DIR, 'questions.json')
};

const ENTITY_PREFIXES = {
  artists: 'artist',
  events: 'event',
  news: 'news',
  questionnaires: 'quiz',
  questions: 'question'
};

const router = Router();

// --- Generic CRUD for all content types ---

function contentRoutes(entityType) {
  const filePath = PATHS[entityType];
  const prefix = ENTITY_PREFIXES[entityType];

  // GET /api/admin/:entityType — list all (including archived)
  router.get(`/${entityType}`, requireRole('admin'), (_req, res) => {
    const data = readJSON(filePath);
    res.json(data);
  });

  // POST /api/admin/:entityType — create new
  router.post(`/${entityType}`, requireRole('admin'), async (req, res) => {
    const item = req.body;

    if (!item.name && !item.headline) {
      return res.status(400).json({ error: 'Falta el camp obligatori: name o headline' });
    }

    let newItem;
    await writeJSONSafe(filePath, async (data) => {
      const { id, position } = generateId(prefix, data.itemListElement);
      item['@id'] = id;

      const listItem = {
        '@type': 'ListItem',
        position,
        item
      };

      data.itemListElement.push(listItem);
      data.numberOfItems = data.itemListElement.length;
      newItem = item;
    });

    res.status(201).json({ success: true, item: newItem });
  });

  // PUT /api/admin/:entityType/:id — update
  router.put(`/${entityType}/:id`, requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    let updatedItem;
    await writeJSONSafe(filePath, async (data) => {
      const listItem = data.itemListElement.find(el => el.item['@id'] === id);
      if (!listItem) return;

      // Merge updates into existing item
      Object.assign(listItem.item, updates);
      updatedItem = listItem.item;
    });

    if (!updatedItem) {
      return res.status(404).json({ error: 'Element no trobat' });
    }
    res.json({ success: true, item: updatedItem });
  });

  // DELETE /api/admin/:entityType/:id — delete permanently
  router.delete(`/${entityType}/:id`, requireRole('admin'), async (req, res) => {
    const { id } = req.params;

    let found = false;
    await writeJSONSafe(filePath, async (data) => {
      const index = data.itemListElement.findIndex(el => el.item['@id'] === id);
      if (index === -1) return;
      data.itemListElement.splice(index, 1);
      data.numberOfItems = data.itemListElement.length;
      // Reindex positions
      data.itemListElement.forEach((el, i) => { el.position = i + 1; });
      found = true;
    });

    if (!found) {
      return res.status(404).json({ error: 'Element no trobat' });
    }
    res.json({ success: true });
  });

  // PUT /api/admin/:entityType/:id/archive — toggle archive
  router.put(`/${entityType}/:id/archive`, requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    const { archived } = req.body; // true or false

    let updatedItem;
    await writeJSONSafe(filePath, async (data) => {
      const listItem = data.itemListElement.find(el => el.item['@id'] === id);
      if (!listItem) return;

      // Find or create the 'archived' additionalProperty
      if (!listItem.item.additionalProperty) {
        listItem.item.additionalProperty = [];
      }
      const archiveProp = listItem.item.additionalProperty.find(p => p.name === 'archived');
      if (archiveProp) {
        archiveProp.value = archived === true;
      } else {
        listItem.item.additionalProperty.push({
          '@type': 'PropertyValue',
          name: 'archived',
          value: archived === true
        });
      }
      updatedItem = listItem.item;
    });

    if (!updatedItem) {
      return res.status(404).json({ error: 'Element no trobat' });
    }
    res.json({ success: true, item: updatedItem });
  });
}

// Register routes for all content types
contentRoutes('artists');
contentRoutes('events');
contentRoutes('news');
contentRoutes('questionnaires');
contentRoutes('questions');

export default router;
