import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boots the real server in hackathon mode against an empty in-memory database.
 * No provider keys and monitoring off, so the opportunity panel must report
 * honest empty state rather than inventing opportunities.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4131;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ti-opps-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      HACKATHON_MODE: '1',
      DB_PATH: ':memory:',
      DATA_DIR: dir,
      LOG_LEVEL: 'error',
      SERPAPI_API_KEY: '',
      TWELVEDATA_API_KEY: '',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/status`); if (r.ok) return; } catch {}
    await sleep(150);
  }
  throw new Error('server did not start');
});

after(() => { child?.kill('SIGKILL'); });

test('opportunity panel reports real, computed state and invents nothing on an empty database', async () => {
  const res = await fetch(`${BASE}/api/opportunities?limit=10`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(body.opportunities));
  assert.equal(body.opportunities.length, 0, 'no events means no opportunity cards');

  const st = body.status;
  assert.equal(st.monitoring, false);
  assert.equal(st.intervalMinutes, 10, 'the news schedule is a 10-minute cadence');
  assert.equal(st.lastScan, null, 'no scan has run yet');
  assert.equal(st.nextScanAt, null, 'no next scan when the scheduler is off');
  assert.equal(st.counts.totalEvents, 0);
  assert.equal(st.counts.clustersAnalyzed, 0);
  assert.equal(st.counts.needsAttention, 0);
  assert.equal(st.counts.newArticles, 0);
  assert.ok(st.ollama && typeof st.ollama.available === 'boolean');
  assert.ok(st.newsProvider && typeof st.newsProvider.id === 'string');
});

test('the opportunity panel is read-only', async () => {
  const res = await fetch(`${BASE}/api/opportunities`, { method: 'POST' });
  assert.ok(res.status === 404 || res.status === 405, `unexpected status ${res.status}`);
});
