import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boots the real server as a child process with DEMO_MODE=true and no provider keys,
 * so nothing external is called and the operator's stored keys are never touched
 * (the database is in-memory). Verifies the authentication boundary and headers.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}`;
const USERNAME = 'admin';
const PASSWORD = 'http-test-password';
let child;
let cookie = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ti-http-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: ':memory:',
      DATA_DIR: dir,
      ADMIN_USERNAME: USERNAME,
      ADMIN_PASSWORD: PASSWORD,
      AUTH_MAX_ATTEMPTS: '3',
      LOG_LEVEL: 'error',
      SERPAPI_API_KEY: '',
      TWELVEDATA_API_KEY: '',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/session`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('server did not become ready');
});

after(() => {
  child?.kill('SIGKILL');
});

test('sensitive GET endpoints require authentication', async () => {
  for (const p of ['/api/status', '/api/settings', '/api/watchlist', '/api/market/radar', '/api/events', '/api/secrets']) {
    const res = await fetch(`${BASE}${p}`);
    assert.equal(res.status, 401, `${p} should be 401 without a session`);
    const body = await res.json();
    assert.equal(body.code, 'unauthenticated');
  }
});

test('state-changing endpoints require authentication', async () => {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monitoring: { enabled: true } }),
  });
  assert.equal(res.status, 401);
});

test('security headers are present on responses', async () => {
  const res = await fetch(`${BASE}/dashboard.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});

test('login rejects bad credentials and accepts good ones', async () => {
  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: 'wrong-password' }),
  });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'Invalid credentials.');

  const good = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  assert.equal(good.status, 200);
  const setCookie = good.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(';')[0];
  assert.ok(cookie.startsWith('ti_session='));

  const body = await good.json();
  assert.equal(body.authenticated, true);
});

test('cross-site state-changing requests are rejected (CSRF)', async () => {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
    body: JSON.stringify({ monitoring: { enabled: true } }),
  });
  assert.equal(res.status, 403);
});

test('an authenticated session can read data, and without keys no paid calls are made', async () => {
  const status = await fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.demoMode, false, 'normal mode is not demo mode');
  assert.equal(body.authMode, 'required');

  // Without provider keys the poll must report "no provider" rather than inventing
  // fixture quotes into the live database.
  const poll = await fetch(`${BASE}/api/market/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE },
    body: JSON.stringify({ force: true }),
  });
  assert.equal(poll.status, 200);
  const pollBody = await poll.json();
  assert.equal(pollBody.result.skipped, true);
  assert.equal(pollBody.result.reason, 'provider_unavailable');
  assert.equal(pollBody.result.creditsUsed || 0, 0);
});

test('invalid input is rejected with 400', async () => {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE },
    body: JSON.stringify({ monitoring: { newsIntervalMinutes: 99999 } }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /between|must be/i);
});

test('login attempts are rate limited', async () => {
  // AUTH_MAX_ATTEMPTS=3 for this server; one attempt already succeeded above.
  let sawTooMany = false;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: 'nope' }),
    });
    if (res.status === 429) {
      sawTooMany = true;
      break;
    }
  }
  assert.equal(sawTooMany, true, 'repeated failed logins should eventually be throttled');
});

test('logout invalidates the session', async () => {
  const out = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: BASE },
  });
  assert.equal(out.status, 200);
  const res = await fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 401, 'the session must no longer be accepted');
});
