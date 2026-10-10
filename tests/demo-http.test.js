import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boots the real judge-demo launcher (`npm run demo` → scripts/demo.js) and verifies the
 * frictionless, read-only boundary. No provider credentials are supplied.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4124;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ti-demo-'));
  child = spawn(process.execPath, ['scripts/demo.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
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
  throw new Error('demo server did not become ready');
});

after(() => child?.kill('SIGKILL'));

test('demo opens directly with an authenticated, read-only session (no login screen)', async () => {
  const res = await fetch(`${BASE}/api/auth/session`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.mode, 'demo');
  assert.equal(body.readOnly, true);
});

test('demo dashboard and read-only endpoints work without credentials and without Ollama', async () => {
  assert.equal((await fetch(`${BASE}/dashboard.html`)).status, 200);

  const status = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(status.demoMode, true);
  assert.equal(status.readOnly, true);
  assert.equal(status.providers.market, 'fixture');
  assert.equal(status.providers.news, 'fixture');
  assert.equal(status.ollama.available, false, 'demo must not contact Ollama');

  const radar = await (await fetch(`${BASE}/api/market/radar`)).json();
  assert.equal(radar.provider.id, 'fixture');
  assert.ok(radar.rows.length >= 4, 'radar should be populated from fixtures');

  const events = await (await fetch(`${BASE}/api/events?limit=50`)).json();
  assert.ok(events.events.length >= 4, 'event feed should be populated');
  assert.ok(events.events.some((e) => e.summary), 'at least one sample investigation should exist');

  assert.equal((await fetch(`${BASE}/api/replay/scenarios`)).status, 200);
  assert.equal((await fetch(`${BASE}/api/events/1`)).status, 200);
});

test('demo rejects every state-changing, secret, provider-triggering and Ollama route', async () => {
  const deny = async (method, path) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    return res.status;
  };
  for (const [method, path] of [
    ['POST', '/api/news/run'],
    ['POST', '/api/market/poll'],
    ['PUT', '/api/settings'],
    ['PUT', '/api/watchlist'],
    ['DELETE', '/api/watchlist/NVDA'],
    ['POST', '/api/watchlist/seed-defaults'],
    ['GET', '/api/secrets'],
    ['PUT', '/api/secrets/serpapi_api_key'],
    ['POST', '/api/secrets/serpapi_api_key/validate'],
    ['GET', '/api/ollama/status'],
    ['POST', '/api/ollama/investigate-pending'],
    ['POST', '/api/events/1/investigate'],
    ['POST', '/api/events/1/status'],
    ['POST', '/api/auth/login'],
  ]) {
    assert.equal(await deny(method, path), 403, `${method} ${path} must be blocked in demo mode`);
  }
});

test('demo replay runs read-only over fixtures with no look-ahead', async () => {
  const res = await fetch(`${BASE}/api/replay/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'nvda-export-restrictions' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.synthetic, true);
  assert.ok(['potential_opportunity', 'watch', 'insufficient_evidence', 'no_trade'].includes(body.summary.decision));
  const decision = Date.parse(body.decisionTime);
  for (const step of body.steps) {
    assert.ok(Date.parse(step.ts) <= decision, `step after decision time: ${step.ts}`);
  }
});
