import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Local-admin authentication.
 *
 * Secure by default:
 *  - Credentials come from ADMIN_PASSWORD or ADMIN_TOKEN.
 *  - If neither is set, a one-time random token is generated at startup and printed
 *    to the server console (never to the browser). Restarting rotates it.
 *  - AUTH_DISABLED=true is an explicit, documented, local-only bypass and is never
 *    enabled by default.
 *
 * Sessions live in memory (lost on restart) and are carried in an HttpOnly,
 * SameSite=Strict cookie (Secure when the request is over HTTPS).
 */

const sessions = new Map();
let generatedToken = null;
let bypassWarned = false;
let cleanupTimer = null;

export function authMode() {
  if (config.hackathonMode) return 'hackathon';
  if (config.demoMode) return 'demo';
  return config.auth.disabled ? 'disabled' : 'required';
}

/** True when the request arrived over the loopback interface. */
export function isLoopbackRequest(req) {
  const addr = req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  const a = String(addr);
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
}

/**
 * Explicit read-only allowlist for demo mode. Paths are relative to the `/api` mount.
 * Everything not listed here is rejected, so demo mode can never mutate state, spend
 * provider quota, contact Ollama, or read secret metadata.
 */
const DEMO_ALLOW = [
  ['GET', /^\/status$/],
  ['GET', /^\/config$/],
  ['GET', /^\/settings$/],
  ['GET', /^\/watchlist$/],
  ['GET', /^\/market\/radar$/],
  ['GET', /^\/market\/overview$/],
  ['GET', /^\/market\/quotes$/],
  ['GET', /^\/market\/quote\/[A-Za-z0-9.\-:]+$/],
  ['GET', /^\/market\/candles\/[A-Za-z0-9.\-:]+$/],
  ['GET', /^\/market\/search$/],
  ['GET', /^\/market\/news\/[A-Za-z0-9.\-:]+$/],
  ['GET', /^\/events$/],
  ['GET', /^\/opportunities$/],
  ['GET', /^\/events\/notifications$/],
  ['GET', /^\/events\/\d+$/],
  ['GET', /^\/news\/articles$/],
  ['GET', /^\/news\/plan$/],
  ['GET', /^\/replay\/scenarios$/],
  ['POST', /^\/replay\/run$/], // read-only computation over fixtures
];

export function isDemoAllowed(method, pathname) {
  return DEMO_ALLOW.some(([m, re]) => m === method && re.test(pathname));
}

export function initAuth() {
  if (config.auth.disabled) {
    logger.warn('auth.disabled', {
      note: 'AUTH_DISABLED=true — the API is UNAUTHENTICATED. Use only on a trusted local machine.',
    });
    return;
  }
  if (!config.auth.password && !config.auth.token) {
    generatedToken = crypto.randomBytes(24).toString('base64url');
    // Printed to the server console only — this is the local operator's credential.
    console.log('\n  ── Local admin credentials ───────────────────────────────');
    console.log('   No ADMIN_PASSWORD / ADMIN_TOKEN set, so a one-time token was generated:');
    console.log(`\n     ${generatedToken}\n`);
    console.log('   Set ADMIN_PASSWORD (with ADMIN_USERNAME) or ADMIN_TOKEN in .env to make');
    console.log('   this persistent across restarts.');
    console.log('  ─────────────────────────────────────────────────────────\n');
    logger.warn('auth.token.generated', {
      note: 'A one-time admin token was generated and printed to the console.',
    });
  }
  cleanupTimer = setInterval(pruneSessions, 5 * 60_000);
  cleanupTimer.unref?.();
}

export function stopAuth() {
  clearInterval(cleanupTimer);
  sessions.clear();
}

function pruneSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expiresAt <= now) sessions.delete(sid);
}

/** Constant-time comparison that does not short-circuit on length. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) {
    // Still perform a comparison to keep timing roughly uniform.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** Verify submitted credentials. Token takes precedence when configured. */
export function verifyCredentials({ username, password, token } = {}) {
  const secret = token != null && token !== '' ? token : password;
  if (config.auth.token) {
    if (secret != null && safeEqual(secret, config.auth.token)) return true;
  }
  if (config.auth.password) {
    if (safeEqual(username ?? '', config.auth.username) && safeEqual(password ?? '', config.auth.password)) {
      return true;
    }
  }
  if (generatedToken) {
    if (secret != null && safeEqual(secret, generatedToken)) return true;
  }
  return false;
}

export function createSession(user = config.auth.username) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + config.auth.sessionTtlMinutes * 60_000;
  sessions.set(sid, { user, createdAt: now, expiresAt });
  return { sid, expiresAt };
}

export function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

export function destroySession(sid) {
  if (sid) sessions.delete(sid);
}

export function readCookie(req, name = config.auth.cookieName) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieAttrs(req) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    attrs.push('Secure');
  }
  return attrs;
}

export function setSessionCookie(req, res, sid) {
  const maxAge = config.auth.sessionTtlMinutes * 60;
  res.append(
    'Set-Cookie',
    [`${config.auth.cookieName}=${sid}`, ...cookieAttrs(req), `Max-Age=${maxAge}`].join('; '),
  );
}

export function clearSessionCookie(req, res) {
  res.append('Set-Cookie', [`${config.auth.cookieName}=`, ...cookieAttrs(req), 'Max-Age=0'].join('; '));
}

/** Reject cross-site state-changing requests (complements SameSite=Strict cookies). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function sameOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });

  const origin = req.headers.origin;
  if (origin) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === req.headers.host;
    } catch {
      sameHost = false;
    }
    if (!sameHost) return res.status(403).json({ error: 'Cross-origin request rejected.' });
  }
  next();
}

/** Attach the authenticated user, or reject with 401. */
export function requireAuth(req, res, next) {
  if (config.hackathonMode) {
    // Hackathon mode removes the sign-in page but keeps every other protection.
    // Binding is loopback-only (enforced at boot); this is defence in depth so a
    // misconfigured bind can never expose an unauthenticated API to the network.
    if (!isLoopbackRequest(req)) {
      logger.warn('auth.hackathon.non_loopback_rejected', { ip: req.socket?.remoteAddress });
      return res.status(403).json({
        error: 'Hackathon mode only accepts loopback clients.',
        code: 'non_loopback',
      });
    }
    req.user = { name: 'hackathon-local', open: true };
    return next();
  }
  if (config.demoMode) {
    // Read-only demo: allow an explicit allowlist, reject everything else.
    if (!isDemoAllowed(req.method, req.path)) {
      return res.status(403).json({
        error: 'This action is disabled in read-only demo mode.',
        code: 'demo_read_only',
      });
    }
    req.user = { name: 'demo', demo: true };
    return next();
  }
  if (config.auth.disabled) {
    if (!bypassWarned) {
      logger.warn('auth.bypassed', { note: 'AUTH_DISABLED=true — requests are accepted without authentication.' });
      bypassWarned = true;
    }
    req.user = { name: 'insecure-local', insecure: true };
    return next();
  }
  const sid = readCookie(req);
  const session = getSession(sid);
  if (!session) return res.status(401).json({ error: 'Authentication required.', code: 'unauthenticated' });
  req.user = { name: session.user };
  req.sessionId = sid;
  next();
}

/** Test helpers. */
export function _clearSessionsForTests() {
  sessions.clear();
}
export function _setGeneratedTokenForTests(token) {
  generatedToken = token;
}
export function _addSessionForTests(sid, session) {
  sessions.set(sid, session);
}
export function _sessionCount() {
  return sessions.size;
}
