import { Router } from 'express';

const router = Router();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e2b';

const SYSTEM_INSTRUCTION = `Ets l'assistent virtual de Dona'm Bauxa, una plataforma de descoberta musical i d'esdeveniments a Mallorca. Respons en catala per defecte (canvia a castella o angles si l'usuari ho fa). Mante un to amistos, breu i concret.

Tens tres especialitats:

1. PLANIFICADOR DE CAP DE SETMANA
   Si l'usuari demana un pla i menciona un dia concret (dissabte / diumenge / divendres vespre), respon amb un itinerari estructurat en franges horaries (mati, migdia, tarda, vespre, nit). Cada franja: 1 activitat + 1 frase de context. Si menciona Mallorca, dona suggeriments locals plausibles (cala, mercat, ruta, concert). Si no especifica dia, demana-li quin dia vol planificar.

2. RECOMANADOR MUSICAL
   Si l'usuari nomena un artista, canco o genere, suggereix 3-5 artistes o temes similars amb una frase curta explicant la connexio (estil, escena, epoca). Si nomes diu "recomana'm musica", pregunta quin estil li agrada.

3. AJUDANT GENERAL
   Per a qualsevol altra pregunta (saludar, dubtes sobre la plataforma, preguntes curioses), respon de manera educada i concisa (1-3 frases).

DADES DE LA PLATAFORMA: Quan rebis un bloc "CONTEXT (dades reals…)" abans del missatge de l'usuari, basa la teva resposta NOMES en aquestes dades. Cita els esdeveniments i artistes pel nom exacte i, si esmentes una data o lloc, fes-ho amb les dades del context. No inventis esdeveniments, dates ni recintes que no apareguin al context. Si el context esta buit o no inclou cap element rellevant, digues que no trobes res a l'agenda i suggereix que l'usuari ajusti la cerca.

Format: usa llistes Markdown quan ajudin a la lectura. Evita disclaimers innecessaris.`;

router.get('/health', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return res.status(502).json({ ok: false, error: `Ollama HTTP ${r.status}` });
    const data = await r.json();
    res.json({ ok: true, model: OLLAMA_MODEL, models: (data.models || []).map(m => m.name) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }

  const payload = {
    model: model || OLLAMA_MODEL,
    stream: true,
    messages: [{ role: 'system', content: SYSTEM_INSTRUCTION }, ...messages],
    options: { temperature: 0.7, num_ctx: 8192 },
  };

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return res.status(502).json({ error: `Cannot reach Ollama: ${err.message}` });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return res.status(502).json({ error: `Ollama ${upstream.status}: ${text}` });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  req.on('close', () => {
    try { upstream.body.cancel(); } catch {}
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    if (!res.writableEnded) res.write(JSON.stringify({ error: err.message }) + '\n');
  } finally {
    res.end();
  }
});

export default router;
