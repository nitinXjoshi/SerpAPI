import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Enable hackathon mode BEFORE any src module is evaluated (dynamic imports below).
process.env.HACKATHON_MODE = 'true';
process.env.DB_PATH = ':memory:';

const { authMode, isLoopbackRequest, requireAuth, isDemoAllowed } = await import('../src/security/auth.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4125;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.set = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.append = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.on = () => res;
  return res;
}

test('hackathon mode is a distinct auth mode (not required, not demo)', () => {
  assert.equal(authMode(), 'hackathon');
  // demo allowlist is unchanged and still read-only
  assert.equal(isDemoAllowed('POST', '/news/run'), false);
  assert.equal(isDemoAllowed('GET', '/events'), true);
});

test('loopback detection accepts loopback and rejects other addresses', () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '10.0.0.5' } }), false);
  assert.equal(isLoopbackRequest({ socket: {} }), false);
});

test('requireAuth allows loopback clients and rejects non-loopback clients', () => {
  const ok = mockRes();
  let allowed = false;
  const req = { method: 'GET', path: '/status', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  requireAuth(req, ok, () => (allowed = true));
  assert.equal(allowed, true);
  assert.equal(req.user.open, true);

  const denied = mockRes();
  let deniedNext = false;
  requireAuth(
    { method: 'GET', path: '/status', headers: {}, socket: { remoteAddress: '192.168.0.9' } },
    denied,
    () => (deniedNext = true),
  );
  assert.equal(deniedNext, false);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'non_loopback');
});

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ti-hack-'));
  child = spawn(process.execPath, ['scripts/hackathon.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: ':memory:',
      DATA_DIR: dir,
      LOG_LEVEL: 'error',
      SERPAPI_API_KEY: '',
      TWELVEDATA_API_KEY: '',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/session`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('hackathon server did not become ready');
});

after(() => child?.kill('SIGKILL'));

test('dashboard opens without authentication or a sign-in redirect', async () => {
  const session = await (await fetch(`${BASE}/api/auth/session`)).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.mode, 'hackathon');
  assert.equal(session.readOnly, false, 'hackathon mode is fully functional, not read-only');
  assert.equal(session.demoMode, false);

  const page = await fetch(`${BASE}/dashboard.html`);
  assert.equal(page.status, 200);
});

test('judge-facing APIs work with no credentials, and providers are not forced to fixtures', async () => {
  const events = await fetch(`${BASE}/api/events`);
  assert.equal(events.status, 200);
  assert.ok(Array.isArray((await events.json()).events));

  const status = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(status.demoMode, false);
  assert.equal(status.readOnly, false);
  assert.equal(status.authMode, 'hackathon');
  // providers stay 'auto' (resolved against real config), NOT forced to fixture
  assert.equal(status.providers.market, 'auto');
  assert.equal(status.providers.news, 'auto');

  assert.equal((await fetch(`${BASE}/api/market/radar`)).status, 200);
  assert.equal((await fetch(`${BASE}/api/settings`)).status, 200);
});

test('API keys are only ever returned masked', async () => {
  const res = await fetch(`${BASE}/api/secrets`);
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const s of body.secrets) {
    assert.ok(!('value' in s && s.value), 'no plaintext value field may be present');
    assert.ok(!('plaintext' in s), 'no plaintext field may be present');
    if (s.configured) assert.ok(String(s.masked).includes('•'), 'configured keys must be masked');
  }
});

test('same-origin, validation and authentication controls remain enforced', async () => {
  // cross-origin state change is still rejected
  const cross = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ monitoring: { enabled: true } }),
  });
  assert.equal(cross.status, 403);

  // validation still rejects extreme values on a same-origin request
  const invalid = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ monitoring: { newsIntervalMinutes: 99999 } }),
  });
  assert.equal(invalid.status, 400);

  // there is no login endpoint in hackathon mode
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'x' }),
  });
  assert.equal(login.status, 403);
});

test('hackathon mode refuses to bind to a non-loopback interface', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ti-hack-bind-'));
  const bad = spawn(process.execPath, ['scripts/hackathon.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT + 1), HOST: '0.0.0.0', DB_PATH: ':memory:', DATA_DIR: dir, LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => {
      bad.kill('SIGKILL');
      resolve('timeout');
    }, 8000);
    bad.on('exit', (c) => {
      clearTimeout(t);
      resolve(c);
    });
  });
  assert.notEqual(code, 0, 'a public bind must be refused (non-zero exit)');
  assert.notEqual(code, 'timeout', 'the process should exit immediately, not start listening');
});
