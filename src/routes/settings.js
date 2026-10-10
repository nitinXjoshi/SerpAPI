import { Router } from 'express';
import { getSettings, saveSettings, deepMerge } from '../db.js';
import { kickSchedulers } from '../scheduler.js';
import { validateSettingsPatch, assertThresholdOrder } from '../security/validate.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ settings: getSettings() });
});

router.put('/', (req, res) => {
  const raw = req.body?.settings ?? req.body ?? {};
  const clean = validateSettingsPatch(raw);

  // Validate the merged result *before* persisting so invalid combos are rejected.
  const merged = deepMerge(getSettings(), clean);
  assertThresholdOrder(merged);

  const before = getSettings();
  const settings = saveSettings(clean);
  if (!before.monitoring.enabled && settings.monitoring.enabled) {
    kickSchedulers();
  }
  res.json({ settings });
});

export default router;
