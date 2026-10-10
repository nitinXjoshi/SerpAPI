import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Configure demo mode BEFORE any src module is loaded (everything below is a dynamic import).
process.env.DEMO_MODE = 'true';
process.env.DB_PATH = ':memory:';

const { initDb, getSettings } = await import('../src/db.js');
const { seedDemoData } = await import('../src/demo/seed.js');
const { listEvents } = await import('../src/events/store.js');
const { latestObservations } = await import('../src/market/store.js');
const { getSymbolSet } = await import('../src/watchlist.js');
const { isDemoAllowed, authMode } = await import('../src/security/auth.js');
const { resolveMarketProvider } = await import('../src/providers/market/index.js');
const { resolveNewsProvider } = await import('../src/providers/news/index.js');

test('demo mode forces fixture-only providers and a demo auth mode', () => {
  initDb({ dbPath: ':memory:' });
  const settings = getSettings();
  assert.equal(authMode(), 'demo');
  assert.equal(resolveMarketProvider(settings).id, 'fixture');
  assert.equal(resolveNewsProvider(settings).id, 'fixture');
});

test('demo seed makes ZERO outbound requests and yields consistent sample content', async () => {
  initDb({ dbPath: ':memory:' });

  // Any outbound call during seeding is a hard failure — this is the offline guarantee.
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => {
    calls.push(String(args[0]));
    throw new Error('outbound request attempted during demo seed');
  };
  try {
    await seedDemoData();
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, [], `demo seed performed outbound calls: ${calls.join(', ')}`);

  const events = listEvents({ limit: 50 });
  assert.ok(events.length >= 4, `expected clustered events, got ${events.length}`);

  const withModel = events.filter((e) => e.model && e.model.sample === true);
  assert.ok(withModel.length >= 1, 'expected at least one authored sample investigation');
  for (const ev of withModel) {
    assert.ok(ev.summary, 'sample investigation must carry a summary');
    for (const claim of ev.model.key_claims) {
      assert.match(claim.source_url, /^https?:\/\//, 'sample claims must cite a real fixture URL');
    }
  }

  const observations = latestObservations(getSymbolSet());
  assert.ok(Object.keys(observations).length >= 4, 'expected fixture market observations');

  // The demo must demonstrate the full decision spectrum, including a negative outcome.
  assert.ok(
    events.some((e) => e.decision === 'insufficient_evidence' || e.decision === 'no_trade'),
    'expected an inconclusive / no-opportunity outcome',
  );
});

test('demo allowlist permits reads but blocks writes, secrets, Ollama and provider triggers', () => {
  assert.equal(isDemoAllowed('GET', '/market/radar'), true);
  assert.equal(isDemoAllowed('GET', '/events'), true);
  assert.equal(isDemoAllowed('GET', '/events/3'), true);
  assert.equal(isDemoAllowed('GET', '/status'), true);
  assert.equal(isDemoAllowed('POST', '/replay/run'), true);

  assert.equal(isDemoAllowed('POST', '/market/poll'), false);
  assert.equal(isDemoAllowed('POST', '/news/run'), false);
  assert.equal(isDemoAllowed('PUT', '/settings'), false);
  assert.equal(isDemoAllowed('PUT', '/watchlist'), false);
  assert.equal(isDemoAllowed('DELETE', '/watchlist/NVDA'), false);
  assert.equal(isDemoAllowed('GET', '/secrets'), false);
  assert.equal(isDemoAllowed('POST', '/secrets/serpapi_api_key/validate'), false);
  assert.equal(isDemoAllowed('GET', '/ollama/status'), false);
  assert.equal(isDemoAllowed('POST', '/ollama/investigate-pending'), false);
  assert.equal(isDemoAllowed('POST', '/events/1/investigate'), false);
  assert.equal(isDemoAllowed('POST', '/events/1/status'), false);
});
