import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEncryptionKey } from '../src/secrets.js';

test('APP_ENCRYPTION_KEY: accepts 64 hex characters', () => {
  const { key, derived } = parseEncryptionKey('a'.repeat(64));
  assert.equal(key.length, 32);
  assert.equal(derived, false);
});

test('APP_ENCRYPTION_KEY: accepts base64 of exactly 32 bytes', () => {
  const { key, derived } = parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'));
  assert.equal(key.length, 32);
  assert.equal(derived, false);
});

test('APP_ENCRYPTION_KEY: derives from a long passphrase (and flags it)', () => {
  const { key, derived } = parseEncryptionKey('a reasonably long passphrase of 32+ chars');
  assert.equal(key.length, 32);
  assert.equal(derived, true);
});

test('APP_ENCRYPTION_KEY: rejects short or empty keys instead of weakening silently', () => {
  assert.throws(() => parseEncryptionKey('short'));
  assert.throws(() => parseEncryptionKey(''));
  assert.throws(() => parseEncryptionKey(null));
  assert.throws(() => parseEncryptionKey('1234567890abcdef')); // 16 chars, not hex-64, not base64-32
});
