import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE = LEVELS[config.logLevel] ?? LEVELS.info;

/** Field names whose values must never be logged. */
const SECRET_KEY_RE = /(api[_-]?key|apikey|token|secret|password|authorization|bearer|credential|cookie)/i;
/** Credential-shaped literals (tokens, hex keys, base64 blobs, JWTs). */
const SECRET_VALUE_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9._-]{10,}|[A-Za-z0-9+/]{32,}={0,2})\b/g;

/** Query-string / header parameters that carry credentials (in a URL or standalone). */
const SECRET_QUERY_RE =
  /([?&\s,;"'(]|^)((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|key)=)([^&\s,;"')]+)/gi;
const AUTH_HEADER_RE = /(authorization\s*[:=]\s*)([^\r\n]+)/gi;

/** Remove credentials embedded in URLs / query strings / headers. */
function scrubString(value) {
  return String(value)
    .replace(SECRET_QUERY_RE, '$1$2<redacted>')
    .replace(AUTH_HEADER_RE, '$1<redacted>')
    .replace(SECRET_VALUE_RE, '<redacted>');
}

function scrubError(err) {
  return {
    name: err.name,
    message: scrubString(err.message || ''),
    // Never emit stack traces — they leak internal paths.
    ...(err.code ? { code: err.code } : {}),
  };
}

/**
 * Deep-redact a value for logging. Handles strings (URLs, headers, tokens),
 * Errors (message only, no stack) and nested objects/arrays.
 */
export function redact(value, keyHint = '') {
  if (value == null) return value;
  if (value instanceof Error) return scrubError(value);
  if (typeof value === 'string') {
    if (SECRET_KEY_RE.test(keyHint)) return '<redacted>';
    return scrubString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, keyHint));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return String(value);
}

function emit(level, msg, meta) {
  if (LEVELS[level] < ACTIVE) return;
  const entry = { ts: new Date().toISOString(), level, msg: scrubString(msg) };
  if (meta !== undefined) entry.meta = redact(meta);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

export { scrubString };
