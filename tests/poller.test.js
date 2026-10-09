import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, saveSettings } from '../src/db.js';
import { marketStatus, pollMarket } from '../src/market/poller.js';
import { upsertWatchlist } from '../src/watchlist.js';

// Sequential single test: these cases share the DB and the global fetch mock.
test('market status, budget-safe chunking and provider failures', async () => {
  initDb();

  // --- market hours ---
  assert.equal(marketStatus(new Date('2025-05-22T14:00:00Z')).open, true); // Thu 10:00 ET
  assert.equal(marketStatus(new Date('2025-05-22T21:00:00Z')).open, false); // Thu 17:00 ET
  assert.equal(marketStatus(new Date('2025-05-24T14:00:00Z')).open, false); // Saturday
  assert.equal(marketStatus(new Date('2025-05-22T21:00:00Z')).reason, 'outside_hours');

  // --- per-minute credit cap defers instead of exceeding ---
  process.env.TWELVEDATA_API_KEY = 'test-key';
  for (const s of ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']) upsertWatchlist({ symbol: s });
  saveSettings({
    providers: { market: 'twelvedata' },
    budget: { twelvedataPerMinute: 2, twelvedataPerDay: 800 },
    monitoring: { marketHoursOnly: false },
  });

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      status: 200,
      headers: { get: (k) => (k === 'api-credits-used' ? '2' : k === 'api-credits-left' ? '798' : null) },
      json: async () => ({
        AAA: { symbol: 'AAA', close: '10', previous_close: '9', percent_change: '11', datetime: new Date().toISOString(), is_market_open: true },
        BBB: { symbol: 'BBB', close: '20', previous_close: '19', percent_change: '5', datetime: new Date().toISOString(), is_market_open: true },
      }),
    };
  };

  const r = await pollMarket({ force: false, allowWait: false });
  assert.equal(calls.length, 1, 'must not exceed the per-minute credit cap');
  assert.equal(r.quotes.length, 2);
  assert.ok(r.deferred.length >= 2, 'remaining symbols are deferred');
  assert.equal(r.reason, 'per_minute_limit');

  // --- a 429 from the provider is surfaced, not thrown ---
  saveSettings({ budget: { twelvedataPerMinute: 8 } });
  globalThis.fetch = async () => ({
    status: 429,
    headers: { get: () => null },
    json: async () => ({ code: 429, message: 'rate limit', status: 'error' }),
  });
  const rl = await pollMarket({ force: true });
  assert.equal(rl.quotes.length, 0);
  assert.equal(rl.rateLimited, true);

  delete process.env.TWELVEDATA_API_KEY;
});
