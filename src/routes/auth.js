import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { createRateLimiter } from '../security/rateLimit.js';
import { asString } from '../security/validate.js';
import {
  authMode,
  createSession,
  destroySession,
  getSession,
  readCookie,
  setSessionCookie,
  clearSessionCookie,
  verifyCredentials,
} from '../security/auth.js';

const router = Router();

const loginLimiter = createRateLimiter({
  windowMs: config.auth.loginWindowMinutes * 60_000,
  max: config.auth.maxLoginAttempts,
  message: 'Too many login attempts. Please wait and try again.',
});

function authMethod() {
  if (config.auth.token) return 'token';
  if (config.auth.password) return 'password';
  return 'token'; // generated token
}

router.get('/session', (req, res) => {
  if (config.hackathonMode) {
    // No sign-in page: the dashboard opens directly. Full functionality (not read-only).
    return res.json({
      authenticated: true,
      mode: 'hackathon',
      user: 'hackathon-local',
      method: 'none',
      readOnly: false,
      demoMode: false,
      openAccess: true,
    });
  }
  if (config.demoMode) {
    return res.json({
      authenticated: true,
      mode: 'demo',
      user: 'demo',
      method: 'none',
      readOnly: true,
      demoMode: true,
    });
  }
  if (config.auth.disabled) {
    return res.json({ authenticated: true, mode: 'disabled', user: 'insecure-local', readOnly: false, demoMode: false });
  }
  const session = getSession(readCookie(req));
  res.json({
    authenticated: Boolean(session),
    mode: authMode(),
    user: session?.user || null,
    expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    method: authMethod(),
    readOnly: false,
    demoMode: false,
  });
});

router.post('/login', loginLimiter, (req, res) => {
  if (config.hackathonMode || config.demoMode || config.auth.disabled) {
    return res.status(403).json({ error: 'Authentication is not used in this mode.' });
  }
  const body = req.body || {};
  let username;
  let password;
  let token;
  try {
    if (body.username !== undefined) username = asString(body.username, { field: 'username', max: 128 });
    if (body.password !== undefined) password = asString(body.password, { field: 'password', max: 512 });
    if (body.token !== undefined) token = asString(body.token, { field: 'token', max: 512 });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!verifyCredentials({ username, password, token })) {
    // Never echo the submitted value; do not reveal which field was wrong.
    logger.warn('auth.login.failed', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const { sid, expiresAt } = createSession(config.auth.username);
  setSessionCookie(req, res, sid);
  logger.info('auth.login.succeeded', { user: config.auth.username });
  res.json({
    authenticated: true,
    user: config.auth.username,
    expiresAt: new Date(expiresAt).toISOString(),
    demoMode: config.demoMode,
  });
});

router.post('/logout', (req, res) => {
  destroySession(readCookie(req));
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

export default router;
