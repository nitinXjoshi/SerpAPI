import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getDb } from '../src/db.js';
import { putSecret, getSecretValue, getSecretMeta, listSecretMeta, deleteSecret, mask } from '../src/secrets.js';

// Sequential single test: the same secret row is mutated across assertions.
test('secrets are encrypted at rest, masked in metadata and never leaked', () => {
  initDb();

  putSecret('serpapi_api_key', 'abcdef1234567890SECRETVALUE');
  assert.equal(getSecretValue('serpapi_api_key'), 'abcdef1234567890SECRETVALUE');

  const row = getDb().prepare('SELECT ciphertext FROM secrets WHERE name = ?').get('serpapi_api_key');
  assert.ok(!row.ciphertext.includes('SECRET'), 'ciphertext must not contain the plaintext');

  const meta = getSecretMeta('serpapi_api_key');
  const metaBlob = JSON.stringify(meta);
  assert.ok(!metaBlob.includes('SECRETVALUE'), 'metadata must not expose the key');
  assert.ok(meta.masked.includes('•'));
  assert.equal(meta.last4, 'ALUE');

  const listBlob = JSON.stringify(listSecretMeta());
  assert.ok(!listBlob.includes('SECRETVALUE'));
  assert.ok(!listBlob.includes('abcdef1234567890'));

  assert.ok(mask('supersecretvalue1234').endsWith('1234'));
  assert.equal(mask(''), '');

  assert.throws(() => putSecret('not_a_real_secret', 'x'));

  deleteSecret('serpapi_api_key');
  assert.equal(getSecretValue('serpapi_api_key'), null);
});
