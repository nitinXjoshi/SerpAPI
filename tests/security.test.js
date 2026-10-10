import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders } from '../src/security/headers.js';
import { createRateLimiter, createConcurrencyGuard } from '../src/security/rateLimit.js';
import {
  asString,
  asInt,
  asNumber,
  asEnum,
  asBool,
  asSymbol,
  asStringArray,
  validateSettingsPatch,
  assertThresholdOrder,
} from '../src/security/validate.js';
import { ValidationError, sanitizeUpstream, upstreamErrorMessage } from '../src/security/errors.js';
import { getDefaultSettings } from '../src/config.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, _handlers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.set = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.append = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.on = (ev, fn) => ((res._handlers[ev] = fn), res);
  return res;
}
const mockReq = (over = {}) => ({ ip: '127.0.0.1', secure: false, headers: {}, ...over });

test('security headers are applied, with HSTS only over HTTPS', () => {
  const res = mockRes();
  securityHeaders()(mockReq(), res, () => {});
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.ok(res.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.ok(res.headers['content-security-policy'].includes("object-src 'none'"));
  assert.equal(res.headers['strict-transport-security'], undefined);

  const https = mockRes();
  securityHeaders()(mockReq({ secure: true }), https, () => {});
  assert.match(https.headers['strict-transport-security'], /max-age/);
});

test('rate limiter blocks after the configured maximum', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  const ok1 = mockRes();
  limiter(mockReq(), ok1, () => {});
  assert.equal(ok1.statusCode, 200);
  limiter(mockReq(), mockRes(), () => {});
  const blocked = mockRes();
  let next = false;
  limiter(mockReq(), blocked, () => (next = true));
  assert.equal(next, false);
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
});

test('concurrency guard rejects overlapping expensive operations', () => {
  const guard = createConcurrencyGuard(1);
  const r1 = mockRes();
  let n1 = false;
  guard(mockReq(), r1, () => (n1 = true));
  assert.equal(n1, true);

  const r2 = mockRes();
  let n2 = false;
  guard(mockReq(), r2, () => (n2 = true));
  assert.equal(n2, false);
  assert.equal(r2.statusCode, 429);

  r1._handlers.finish(); // release the first
  const r3 = mockRes();
  let n3 = false;
  guard(mockReq(), r3, () => (n3 = true));
  assert.equal(n3, true);
});

test('input validation rejects out-of-range and malformed values', () => {
  assert.equal(asString('  ok  ', { max: 10 }), 'ok');
  assert.throws(() => asString(123, { field: 'q' }), ValidationError);
  assert.throws(() => asString('', { min: 1 }), ValidationError);
  assert.throws(() => asString('x'.repeat(20), { max: 10 }), ValidationError);

  assert.equal(asInt('42', { min: 0, max: 100 }), 42);
  assert.throws(() => asInt(1.5, { min: 0 }), ValidationError);
  assert.throws(() => asInt(999, { max: 100 }), ValidationError);

  assert.equal(asNumber(0.5, { min: 0, max: 1 }), 0.5);
  assert.throws(() => asNumber(5, { max: 1 }), ValidationError);

  assert.equal(asEnum('a', ['a', 'b']), 'a');
  assert.throws(() => asEnum('c', ['a', 'b']), ValidationError);

  assert.equal(asBool(true), true);
  assert.throws(() => asBool('yes'), ValidationError);

  assert.equal(asSymbol('aapl'), 'AAPL');
  assert.throws(() => asSymbol('bad symbol!'), ValidationError);

  assert.deepEqual(asStringArray(['a', 'b'], { maxItems: 5, maxLen: 10 }), ['a', 'b']);
  assert.throws(() => asStringArray('nope'), ValidationError);
  assert.throws(() => asStringArray(['a', 'b', 'c'], { maxItems: 2 }), ValidationError);
});

test('settings validation rejects extreme values and strips unknown keys', () => {
  assert.throws(() => validateSettingsPatch({ monitoring: { newsIntervalMinutes: 0 } }), ValidationError);
  assert.throws(() => validateSettingsPatch({ monitoring: { newsIntervalMinutes: 99999 } }), ValidationError);
  assert.throws(() => validateSettingsPatch({ providers: { market: 'nonsense' } }), ValidationError);
  assert.throws(() => validateSettingsPatch({ scoring: { weights: { priceAnomaly: 5 } } }), ValidationError);
  assert.throws(() => validateSettingsPatch({ notifications: { minScore: -1 } }), ValidationError);
  assert.throws(() => validateSettingsPatch(null), ValidationError);
  assert.throws(() => validateSettingsPatch({ totallyUnknown: { evil: true } }), ValidationError);

  const clean = validateSettingsPatch({
    monitoring: { enabled: true, newsIntervalMinutes: 15 },
    unknownKey: 'ignored',
  });
  assert.deepEqual(clean, { monitoring: { enabled: true, newsIntervalMinutes: 15 } });
});

test('threshold ordering is enforced after merge', () => {
  const s = getDefaultSettings();
  s.scoring.thresholds = { opportunity: 30, watch: 70, insufficient: 10 };
  assert.throws(() => assertThresholdOrder(s), ValidationError);
  const ok = getDefaultSettings();
  assert.doesNotThrow(() => assertThresholdOrder(ok));
});

test('upstream errors are normalised and never echoed', () => {
  assert.deepEqual(sanitizeUpstream({ error: 'Invalid API key. See https://serpapi.com/...' }), {
    error: 'The upstream provider rejected the request.',
  });
  assert.equal(upstreamErrorMessage(401), 'Upstream provider rejected the credentials.');
  assert.equal(upstreamErrorMessage(429), 'Upstream provider rate limit reached. Try again later.');
  assert.equal(upstreamErrorMessage(503), 'Upstream provider error.');
});
