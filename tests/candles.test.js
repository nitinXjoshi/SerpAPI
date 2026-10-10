import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twelveDataProvider } from '../src/providers/market/twelveData.js';

/** Minimal fetch double: records the requested URL and replays a canned payload. */
function stubFetch(payload, { status = 200, headers = {} } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      status,
      headers: new Headers(headers),
      json: async () => payload,
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('daily candles are sorted, de-duplicated, and use business-day labels', async () => {
  const { calls, restore } = stubFetch({
    meta: { symbol: 'AAPL', interval: '1day', exchange: 'NASDAQ', exchange_timezone: 'America/New_York' },
    values: [
      { datetime: '2026-10-09', open: '336.0', high: '338.0', low: '334.0', close: '336.64', volume: '41000000' },
      { datetime: '2026-10-02', open: '330.0', high: '332.0', low: '329.0', close: '331.19', volume: '39000000' },
      { datetime: '2026-10-09', open: '336.0', high: '339.9', low: '334.0', close: '337.10', volume: '42000000' },
      { datetime: '2026-10-08', open: '333.0', high: '337.0', low: '332.0', close: null, volume: '1000' },
    ],
  });
  try {
    const res = await twelveDataProvider.fetchCandles('aapl', { interval: '1day', outputsize: 365, apiKey: 'k' });
    assert.equal(res.error, undefined);
    assert.equal(res.bars.length, 2, 'duplicate and invalid rows are removed');
    assert.deepEqual(res.bars.map((b) => b.time), ['2026-10-02', '2026-10-09']);
    // The later duplicate wins (337.10), not the first one seen.
    assert.equal(res.bars[1].close, 337.1);
    assert.equal(typeof res.bars[0].time, 'string');
    assert.match(calls[0], /outputsize=365/);
  } finally {
    restore();
  }
});

test('intraday candles carry real UNIX-second timestamps', async () => {
  const { restore } = stubFetch({
    meta: { symbol: 'AAPL', interval: '5min', exchange_timezone: 'America/New_York' },
    values: [
      { datetime: '2026-10-09 09:40:00', open: '336.0', high: '337.0', low: '335.5', close: '336.5', volume: '100000' },
      { datetime: '2026-10-09 09:35:00', open: '335.0', high: '336.2', low: '334.8', close: '336.0', volume: '90000' },
    ],
  });
  try {
    const res = await twelveDataProvider.fetchCandles('AAPL', { interval: '5min', outputsize: 500, apiKey: 'k' });
    assert.equal(res.bars.length, 2);
    assert.equal(typeof res.bars[0].time, 'number');
    assert.ok(res.bars[0].time < res.bars[1].time, 'ascending');
  } finally {
    restore();
  }
});

test('missing key returns an honest error and makes no request', async () => {
  const { calls, restore } = stubFetch({});
  try {
    const res = await twelveDataProvider.fetchCandles('AAPL', { interval: '1day' });
    assert.deepEqual(res.bars, []);
    assert.match(res.error, /key is not configured/i);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('rate limiting is reported, never silently emptied', async () => {
  const { restore } = stubFetch({ code: 429, message: 'too many requests' }, { status: 429 });
  try {
    const res = await twelveDataProvider.fetchCandles('AAPL', { interval: '1day', apiKey: 'k' });
    assert.equal(res.rateLimited, true);
    assert.deepEqual(res.bars, []);
  } finally {
    restore();
  }
});

test('outputsize is clamped to the provider maximum', async () => {
  const { calls, restore } = stubFetch({ meta: {}, values: [] });
  try {
    await twelveDataProvider.fetchCandles('AAPL', { interval: '1day', outputsize: 99999, apiKey: 'k' });
    assert.match(calls[0], /outputsize=5000/);
  } finally {
    restore();
  }
});
