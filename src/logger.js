import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE = LEVELS[config.logLevel] ?? LEVELS.info;

const SECRET_KEY_RE = /(api[_-]?key|apikey|token|secret|password|authorization|bearer|credential)/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9]+|[A-Za-z0-9]{24,})\b/g;

function redactString(value) {
  return String(value)
    .replace(SECRET_VALUE_RE, (m) => (m.length >= 24 ? `${m.slice(0, 4)}…<redacted>` : m))
    .replace(/(key=)[^&\s]+/gi, '$1<redacted>');
}

function redact(value, keyHint = '') {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SECRET_KEY_RE.test(keyHint)) return '<redacted>';
    return redactString(value);
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, keyHint));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

function emit(level, msg, meta) {
  if (LEVELS[level] < ACTIVE) return;
  const entry = { ts: new Date().toISOString(), level, msg };
  if (meta !== undefined) entry.meta = redact(meta);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

export { redact };
