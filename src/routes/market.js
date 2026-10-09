import { Router } from 'express';
import { buildRadar } from '../market/radar.js';
import { triggerMarketPoll } from '../scheduler.js';

const router = Router();

router.get('/radar', (_req, res) => {
  res.json(buildRadar());
});

router.post('/poll', async (req, res) => {
  const force = req.body?.force !== false;
  try {
    const result = await triggerMarketPoll({ force });
    res.json({ result, radar: buildRadar() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
