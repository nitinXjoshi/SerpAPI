import { Router } from 'express';
import { ollamaStatus, discoverModel } from '../ollama/client.js';
import { investigatePendingEvents } from '../ollama/investigate.js';

const router = Router();

router.get('/status', async (_req, res) => {
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
});

router.post('/investigate-pending', async (req, res) => {
  const limit = Math.min(Number(req.body?.limit) || 5, 20);
  const result = await investigatePendingEvents({ limit });
  res.json(result);
});

export default router;
