import { Router } from 'express';
import {
  KNOWN_SECRETS,
  listSecretMeta,
  putSecret,
  deleteSecret,
  validateSecret,
  getSecretMeta,
} from '../secrets.js';

const router = Router();

function known(req, res) {
  const { name } = req.params;
  if (!KNOWN_SECRETS[name]) {
    res.status(400).json({ error: 'Unknown secret.' });
    return null;
  }
  return name;
}

router.get('/', (_req, res) => {
  res.json({ secrets: listSecretMeta() });
});

// Store + validate. The value is never echoed back.
router.put('/:name', async (req, res) => {
  const name = known(req, res);
  if (!name) return;
  try {
    putSecret(name, req.body?.value);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const validation = await validateSecret(name);
  res.json({ secret: getSecretMeta(name), validation });
});

router.post('/:name/validate', async (req, res) => {
  const name = known(req, res);
  if (!name) return;
  const validation = await validateSecret(name);
  res.json({ secret: getSecretMeta(name), validation });
});

router.delete('/:name', (req, res) => {
  const name = known(req, res);
  if (!name) return;
  deleteSecret(name);
  res.json({ ok: true, secret: getSecretMeta(name) });
});

export default router;
