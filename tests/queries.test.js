import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryPlan, selectQueries } from '../src/news/queries.js';
import { getDefaultSettings } from '../src/config.js';

const watchlist = [
  { symbol: 'NVDA', companyName: 'NVIDIA Corporation', sector: 'Semiconductors', importance: 0.9, enabled: true },
  { symbol: 'AAPL', companyName: 'Apple Inc', sector: 'Technology', importance: 0.8, enabled: true },
  { symbol: 'SPY', companyName: 'SPDR S&P 500 ETF', sector: 'Benchmark', importance: 0.5, enabled: true },
];

test('query plan is prioritized and includes company/sector/market queries', () => {
  const settings = getDefaultSettings();
  settings.monitoring.backfillHours = 6;
  const specs = buildQueryPlan({ watchlist, settings });
  const ids = specs.map((s) => s.id);
  assert.ok(ids.includes('company:NVDA'));
  assert.ok(ids.includes('company:AAPL'));
  assert.ok(!ids.includes('company:SPY'), 'benchmarks are not queried as companies');
  assert.ok(ids.some((i) => i.startsWith('sector:')));
  assert.ok(ids.includes('market:overview'));

  // sorted by priority descending
  for (let i = 1; i < specs.length; i++) assert.ok(specs[i - 1].priority >= specs[i].priority);
  assert.ok(specs[0].priority > specs[specs.length - 1].priority);
});

test('incremental retrieval uses a supported when: filter', () => {
  const settings = getDefaultSettings();
  settings.monitoring.backfillHours = 6;
  const specs = buildQueryPlan({ watchlist, settings });
  assert.ok(specs.find((s) => s.id === 'company:NVDA').q.includes('when:1d'));

  settings.monitoring.backfillHours = 1;
  const hourly = buildQueryPlan({ watchlist, settings });
  assert.ok(hourly.find((s) => s.id === 'company:NVDA').q.includes('when:1h'));

  settings.monitoring.backfillHours = 0;
  const none = buildQueryPlan({ watchlist, settings });
  assert.ok(!none.find((s) => s.id === 'company:NVDA').q.includes('when:'));
});

test('selectQueries respects the allowed budget', () => {
  const settings = getDefaultSettings();
  const specs = buildQueryPlan({ watchlist, settings });
  const { selected, deferred } = selectQueries(specs, 2);
  assert.equal(selected.length, 2);
  assert.equal(deferred.length, specs.length - 2);
  assert.equal(selectQueries(specs, 0).selected.length, 0);
});
