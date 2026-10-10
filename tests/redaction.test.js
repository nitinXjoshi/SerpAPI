import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, logger } from '../src/logger.js';

test('secret-named fields are redacted regardless of value shape', () => {
  const out = redact({ apiKey: 'live-key-value-1234567890', password: 'hunter2', nested: { authorization: 'Bearer abc' } });
  assert.equal(out.apiKey, '<redacted>');
  assert.equal(out.password, '<redacted>');
  assert.equal(out.nested.authorization, '<redacted>');
});

test('credentials in URLs and query strings are scrubbed', () => {
  const out = redact({ url: 'https://serpapi.com/search?engine=google_finance&api_key=abcdef1234567890&q=x' });
  assert.ok(!out.url.includes('abcdef1234567890'), 'query-string key must be scrubbed');
  assert.ok(out.url.includes('api_key=<redacted>'));
  assert.ok(out.url.includes('engine=google_finance'), 'non-secret params are preserved');
});

test('Authorization header values are scrubbed', () => {
  const out = redact({ header: 'Authorization: Bearer supersecrettokenvalue123' });
  assert.ok(!out.header.includes('supersecrettokenvalue123'));
});

test('Error objects are reduced to name/message with no stack trace', () => {
  const err = new Error('request failed for https://api.example.com/quote?apikey=SECRETKEY123456');
  const out = redact(err);
  assert.equal(out.name, 'Error');
  assert.equal(out.stack, undefined, 'stack traces must never be logged');
  assert.ok(!JSON.stringify(out).includes('SECRETKEY123456'));
});

test('deeply nested error objects are scrubbed', () => {
  const out = redact({ upstream: { error: { message: 'bad key=abcdef1234567890' } } });
  assert.ok(!JSON.stringify(out).includes('abcdef1234567890'));
});

test('logger output never contains secrets', () => {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    logger.error('upstream failure', {
      apiKey: 'supersecretvalue1234567890',
      url: 'https://api.twelvedata.com/quote?symbol=AAPL&apikey=abcd1234efgh5678',
      headers: { authorization: 'Bearer tok_abcdefghijklmnop' },
      error: new Error('boom at /Users/someone/secret/path?token=xyz'),
    });
  } finally {
    process.stdout.write = original;
  }
  const out = writes.join('');
  assert.ok(out.length > 0, 'the log line should be emitted at error level');
  for (const secret of [
    'supersecretvalue1234567890',
    'abcd1234efgh5678',
    'tok_abcdefghijklmnop',
    'token=xyz',
  ]) {
    assert.ok(!out.includes(secret), `log leaked: ${secret}`);
  }
  assert.ok(out.includes('<redacted>'));
});
