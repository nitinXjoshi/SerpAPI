import { Router } from 'express';
import { getSettings, saveSettings } from '../db.js';
import { kickSchedulers } from '../scheduler.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ settings: getSettings() });
});

router.put('/', (req, res) => {
  const patch = req.body?.settings ?? req.body ?? {};
  if (typeof patch !== 'object' || patch === null) {
    return res.status(400).json({ error: 'Expected an object of settings.' });
  }
  const before = getSettings();
  const settings = saveSettings(patch);
  if (!before.monitoring.enabled && settings.monitoring.enabled) {
    kickSchedulers();
  }
  res.json({ settings });
});

export default router;
