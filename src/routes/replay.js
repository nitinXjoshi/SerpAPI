import { Router } from 'express';
import { listScenarios, runReplay } from '../replay/engine.js';

const router = Router();

router.get('/scenarios', (_req, res) => {
  res.json({ scenarios: listScenarios() });
});

router.post('/run', (req, res) => {
  const scenarioId = String(req.body?.scenarioId || '').trim();
  if (!scenarioId) return res.status(400).json({ error: 'scenarioId is required.' });
  try {
    res.json(runReplay(scenarioId));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
