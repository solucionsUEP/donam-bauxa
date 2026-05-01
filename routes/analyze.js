import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/', requireRole('admin'), async (req, res) => {
  const { imageBase64, imageMimeType, instagramUrl, caption, dryRun } = req.body;

  if (!imageBase64 && !instagramUrl) {
    return res.status(400).json({ error: 'Cal imageBase64 o instagramUrl' });
  }

  const payload = Object.fromEntries(
    Object.entries({ imageBase64, imageMimeType, instagramUrl, caption, dryRun })
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
  );

  try {
    const upstream = await fetch('https://post-to-json-api.vercel.app/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });

    const json = await upstream.json();
    res.status(upstream.status).json(json);
  } catch (err) {
    res.status(502).json({ error: 'No s\'ha pogut connectar amb l\'API d\'anàlisi' });
  }
});

export default router;
