import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuote, parseProviderTime, toNumber } from '../src/market/normalize.js';

test('toNumber handles strings, commas and junk', () => {
  assert.equal(toNumber('1,234.5'), 1234.5);
  assert.equal(toNumber('12%'), 12);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(null), null);
});

test('parseProviderTime handles datetime, epoch and invalid values', () => {
  assert.equal(parseProviderTime('2024-05-22 15:59:00'), '2024-05-22T15:59:00.000Z');
  assert.equal(parseProviderTime(null, 1716393540), '2024-05-22T15:59:00.000Z');
  assert.equal(parseProviderTime('not-a-date'), null);
  assert.equal(parseProviderTime(undefined, undefined), null);
});

test('normalizeQuote derives changePct and flags stale observations', () => {
  const q = normalizeQuote(
    {
      symbol: 'nvda',
      exchange: 'NASDAQ',
      currency: 'USD',
      datetime: '2024-05-22 15:59:00',
      close: '120.50',
      previous_close: '128.00',
      percent_change: '-5.86',
      volume: '250000000',
      is_market_open: true,
    },
    { provider: 'twelvedata' },
  );
  assert.equal(q.symbol, 'NVDA');
  assert.equal(q.price, 120.5);
  assert.equal(q.changePct, -5.86);
  assert.equal(q.marketTs, '2024-05-22T15:59:00.000Z');
  assert.equal(q.source, 'twelvedata');
  // 2024 timestamp is far in the past → stale
  assert.equal(q.stale, true);
});

test('normalizeQuote computes changePct when only prices are present', () => {
  const q = normalizeQuote({ close: 110, previous_close: 100, datetime: new Date().toISOString() }, { provider: 'x' });
  assert.ok(Math.abs(q.changePct - 10) < 1e-9);
});

test('normalizeQuote treats a closed market as stale', () => {
  const q = normalizeQuote(
    { close: 100, previous_close: 100, datetime: new Date().toISOString(), is_market_open: false },
    { provider: 'x' },
  );
  assert.equal(q.stale, true);
});

test('missing values are null, not fabricated', () => {
  const q = normalizeQuote({ symbol: 'ABC' }, { provider: 'x' });
  assert.equal(q.price, null);
  assert.equal(q.changePct, null);
  assert.equal(q.stale, true);
});
