import { Router } from 'express';
import { listScenarios, runReplay } from '../replay/engine.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asString } from '../security/validate.js';

const router = Router();
const replayGuard = createConcurrencyGuard(1, 'A replay is already running.');

router.get('/scenarios', (_req, res) => {
  res.json({ scenarios: listScenarios() });
});

router.post('/run', replayGuard, (req, res) => {
  const scenarioId = asString(String(req.body?.scenarioId ?? ''), {
    field: 'scenarioId',
    min: 1,
    max: 64,
    pattern: /^[a-z0-9-]+$/i,
  });
  try {
    res.json(runReplay(scenarioId));
  } catch {
    // Do not echo filesystem paths from the loader.
    res.status(404).json({ error: 'Scenario not found.' });
  }
});

export default router;
