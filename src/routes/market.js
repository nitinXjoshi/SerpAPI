import { Router } from 'express';
import { buildRadar } from '../market/radar.js';
import { triggerMarketPoll } from '../scheduler.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asyncHandler } from '../security/errors.js';
import { asBool } from '../security/validate.js';

const router = Router();
const pollGuard = createConcurrencyGuard(1, 'A market poll is already running.');

router.get('/radar', (_req, res) => {
  res.json(buildRadar());
});

router.post(
  '/poll',
  pollGuard,
  asyncHandler(async (req, res) => {
    const force = req.body?.force === undefined ? true : asBool(req.body.force, { field: 'force' });
    const result = await triggerMarketPoll({ force });
    res.json({ result, radar: buildRadar() });
  }),
);

export default router;
