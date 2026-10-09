import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import { logger } from './logger.js';

/** Provider keys this app knows about. Ollama host/model are NOT secrets (kept in settings). */
export const KNOWN_SECRETS = {
  serpapi_api_key: { label: 'SerpAPI private key', provider: 'serpapi' },
  twelvedata_api_key: { label: 'Twelve Data API key', provider: 'twelvedata' },
};

let cachedKey = null;

function encryptionKey() {
  if (cachedKey) return cachedKey;
  if (config.encryptionKey) {
    const raw = config.encryptionKey.trim();
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    cachedKey = buf.length === 32 ? buf : crypto.createHash('sha256').update(raw).digest();
    return cachedKey;
  }
  const keyPath = path.join(config.dataDir, 'encryption.key');
  if (fs.existsSync(keyPath)) {
    cachedKey = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
    return cachedKey;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  logger.info('secrets.keyfile.created', { path: keyPath });
  cachedKey = key;
  return cachedKey;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(row) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(row.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function mask(value) {
  const s = String(value || '');
  if (!s) return '';
  const last4 = s.slice(-4);
  return `${'•'.repeat(Math.max(4, Math.min(s.length - 4, 12)))}${last4}`;
}

/** Store (or replace) a provider key. Returns metadata only — never the value. */
export function putSecret(name, value) {
  if (!KNOWN_SECRETS[name]) throw new Error(`Unknown secret: ${name}`);
  const clean = String(value || '').trim();
  if (!clean) throw new Error('Secret value is required.');
  const { ciphertext, iv, tag } = encrypt(clean);
  const now = new Date().toISOString();
  const db = getDb();
  const existing = db.prepare('SELECT created_at FROM secrets WHERE name = ?').get(name);
  db.prepare(
    `INSERT INTO secrets (name, ciphertext, iv, tag, last4, created_at, updated_at, last_validated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unvalidated')
     ON CONFLICT(name) DO UPDATE SET
       ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
       last4 = excluded.last4, updated_at = excluded.updated_at,
       last_validated_at = NULL, status = 'unvalidated'`,
  ).run(name, ciphertext, iv, tag, clean.slice(-4), existing?.created_at || now, now);
  logger.info('secrets.stored', { name });
  return getSecretMeta(name);
}

export function deleteSecret(name) {
  getDb().prepare('DELETE FROM secrets WHERE name = ?').run(name);
  logger.info('secrets.deleted', { name });
}

/** Internal use only — decrypted plaintext stays on the server. */
export function getSecretValue(name) {
  const row = getDb()
    .prepare('SELECT ciphertext, iv, tag FROM secrets WHERE name = ?')
    .get(name);
  if (!row) return null;
  try {
    return decrypt(row);
  } catch (err) {
    logger.error('secrets.decrypt.failed', { name, error: err.message });
    return null;
  }
}

export function hasSecret(name) {
  return Boolean(getDb().prepare('SELECT 1 FROM secrets WHERE name = ?').get(name));
}

export function getSecretMeta(name) {
  const row = getDb()
    .prepare(
      'SELECT name, last4, created_at, updated_at, last_validated_at, status FROM secrets WHERE name = ?',
    )
    .get(name);
  if (!row) return { name, configured: false, masked: null, ...KNOWN_SECRETS[name] };
  return {
    name,
    label: KNOWN_SECRETS[name]?.label,
    provider: KNOWN_SECRETS[name]?.provider,
    configured: true,
    masked: `${'•'.repeat(8)}${row.last4 || ''}`,
    last4: row.last4,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastValidatedAt: row.last_validated_at,
    status: row.status,
  };
}

export function listSecretMeta() {
  return Object.keys(KNOWN_SECRETS).map(getSecretMeta);
}

function markValidated(name, status) {
  getDb()
    .prepare('UPDATE secrets SET last_validated_at = ?, status = ? WHERE name = ?')
    .run(new Date().toISOString(), status, name);
}

/**
 * Validate a key with the cheapest documented call. Never logs or returns the key.
 * serpapi: GET /account (free). twelvedata: GET /quote?symbol=AAPL (1 credit).
 */
export async function validateSecret(name, value) {
  const key = value ?? getSecretValue(name);
  if (!key) return { ok: false, status: 'missing', detail: 'No key stored.' };
  try {
    if (name === 'serpapi_api_key') {
      const res = await fetch(`https://serpapi.com/account?api_key=${encodeURIComponent(key)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.account_id) {
        markValidated(name, 'invalid');
        return { ok: false, status: 'invalid', detail: 'SerpAPI rejected the key.' };
      }
      markValidated(name, 'valid');
      return {
        ok: true,
        status: 'valid',
        detail: `${data.plan_searches_left ?? '?'} of ${data.searches_per_month ?? '?'} searches left this month.`,
        quota: {
          searchesPerMonth: data.searches_per_month,
          searchesLeft: data.plan_searches_left,
          thisMonthUsage: data.this_month_usage,
          rateLimitPerHour: data.account_rate_limit_per_hour,
        },
      };
    }
    if (name === 'twelvedata_api_key') {
      const url = new URL('https://api.twelvedata.com/quote');
      url.searchParams.set('symbol', 'AAPL');
      url.searchParams.set('apikey', key);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      const creditsLeft = Number(res.headers.get('api-credits-left'));
      if (data.code === 401 || data.status === 'error' || !res.ok) {
        markValidated(name, 'invalid');
        return { ok: false, status: 'invalid', detail: data.message || 'Twelve Data rejected the key.' };
      }
      markValidated(name, 'valid');
      return {
        ok: true,
        status: 'valid',
        detail: 'Key accepted (1 credit used for validation).',
        quota: Number.isFinite(creditsLeft) ? { creditsLeft } : undefined,
      };
    }
    return { ok: false, status: 'unknown', detail: `No validator for ${name}.` };
  } catch (err) {
    markValidated(name, 'error');
    return { ok: false, status: 'error', detail: `Validation failed: ${err.message}` };
  }
}

export { mask };
