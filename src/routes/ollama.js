import { Router } from 'express';
import { ollamaStatus, discoverModel } from '../ollama/client.js';
import { investigatePendingEvents } from '../ollama/investigate.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asyncHandler } from '../security/errors.js';
import { asInt } from '../security/validate.js';

const router = Router();
const investigateGuard = createConcurrencyGuard(1, 'An investigation is already running.');

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = await ollamaStatus();
    let selectedModel = null;
    if (status.available) {
      try {
        selectedModel = await discoverModel();
      } catch {
        /* ignore */
      }
    }
    res.json({ ...status, selectedModel });
  }),
);

router.post(
  '/investigate-pending',
  investigateGuard,
  asyncHandler(async (req, res) => {
    const limit = req.body?.limit === undefined ? 5 : asInt(req.body.limit, { field: 'limit', min: 1, max: 20 });
    const result = await investigatePendingEvents({ limit });
    res.json(result);
  }),
);

export default router;
