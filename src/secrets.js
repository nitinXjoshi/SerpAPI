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

/**
 * Parse an encryption key from configuration.
 * Accepts 64 hex chars, base64 of exactly 32 bytes, or a passphrase of >= 32 chars
 * (hashed with SHA-256). Anything else is rejected — we never silently weaken the key.
 */
export function parseEncryptionKey(raw) {
  const val = String(raw ?? '').trim();
  if (!val) throw new Error('Encryption key is empty.');
  if (/^[0-9a-fA-F]{64}$/.test(val)) return { key: Buffer.from(val, 'hex'), derived: false };
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(val)) {
    let buf = null;
    try {
      buf = Buffer.from(val, 'base64');
    } catch {
      buf = null;
    }
    if (buf && buf.length === 32) return { key: buf, derived: false };
  }
  if (val.length >= 32) {
    return { key: crypto.createHash('sha256').update(val, 'utf8').digest(), derived: true };
  }
  throw new Error(
    'APP_ENCRYPTION_KEY is invalid: expected 64 hex characters, base64 of 32 bytes, ' +
      'or a passphrase of at least 32 characters.',
  );
}

function encryptionKey() {
  if (cachedKey) return cachedKey;
  if (config.encryptionKey) {
    const { key, derived } = parseEncryptionKey(config.encryptionKey);
    if (derived) {
      logger.warn('secrets.key.derived', {
        note: 'APP_ENCRYPTION_KEY was hashed with SHA-256. Prefer 64 hex chars or base64 of 32 bytes.',
      });
    }
    cachedKey = key;
    return cachedKey;
  }

  const keyPath = path.join(config.dataDir, 'encryption.key');
  if (fs.existsSync(keyPath)) {
    let raw;
    try {
      raw = fs.readFileSync(keyPath, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read encryption key file ${keyPath}: ${err.message}`, { cause: err });
    }
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      /* best effort on platforms without POSIX modes */
    }
    const hex = raw.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(`Encryption key file ${keyPath} is invalid (expected 64 hex characters).`);
    }
    cachedKey = Buffer.from(hex, 'hex');
    return cachedKey;
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    /* best effort */
  }
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
  if (clean.length > 512) throw new Error('Secret value is too long.');
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
  const row = getDb().prepare('SELECT ciphertext, iv, tag FROM secrets WHERE name = ?').get(name);
  if (!row) return null;
  try {
    return decrypt(row);
  } catch (err) {
    // Never include the ciphertext or key material in the log.
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
 * Upstream error text is never surfaced verbatim to callers.
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
        return { ok: false, status: 'invalid', detail: 'Twelve Data rejected the key.' };
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
    logger.warn('secrets.validate.failed', { name, error: err.message });
    return { ok: false, status: 'error', detail: 'Validation could not be completed.' };
  }
}

/** Test helper: forget the cached key so a new one is loaded. */
export function _resetKeyCacheForTests() {
  cachedKey = null;
}

export { mask };
