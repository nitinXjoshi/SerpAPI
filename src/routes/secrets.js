import { Router } from 'express';
import {
  KNOWN_SECRETS,
  listSecretMeta,
  putSecret,
  deleteSecret,
  validateSecret,
  getSecretMeta,
} from '../secrets.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asyncHandler } from '../security/errors.js';
import { asString } from '../security/validate.js';

const router = Router();
// Validation performs an outbound call to the provider — serialise it.
const validateGuard = createConcurrencyGuard(1, 'A key validation is already running.');

function requireKnownSecret(req, res) {
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
router.put(
  '/:name',
  validateGuard,
  asyncHandler(async (req, res) => {
    const name = requireKnownSecret(req, res);
    if (!name) return;
    let value;
    try {
      value = asString(String(req.body?.value ?? ''), { field: 'value', min: 1, max: 512, trim: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    putSecret(name, value);
    const validation = await validateSecret(name);
    res.json({ secret: getSecretMeta(name), validation });
  }),
);

router.post(
  '/:name/validate',
  validateGuard,
  asyncHandler(async (req, res) => {
    const name = requireKnownSecret(req, res);
    if (!name) return;
    const validation = await validateSecret(name);
    res.json({ secret: getSecretMeta(name), validation });
  }),
);

router.delete('/:name', (req, res) => {
  const name = requireKnownSecret(req, res);
  if (!name) return;
  deleteSecret(name);
  res.json({ ok: true, secret: getSecretMeta(name) });
});

export default router;
