import fs from 'node:fs';
import path from 'node:path';
import { config, getDefaultSettings } from './config.js';
import { logger } from './logger.js';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE secrets (
        name TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        last4 TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_validated_at TEXT,
        status TEXT
      );
      CREATE TABLE watchlist (
        symbol TEXT PRIMARY KEY,
        exchange TEXT,
        company_name TEXT,
        aliases_json TEXT,
        sector TEXT,
        benchmark_symbol TEXT,
        peers_json TEXT,
        importance REAL DEFAULT 0.5,
        enabled INTEGER DEFAULT 1,
        added_at TEXT NOT NULL
      );
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        provider TEXT,
        price REAL,
        change REAL,
        change_pct REAL,
        volume REAL,
        currency TEXT,
        market_ts TEXT,
        retrieved_ts TEXT NOT NULL,
        source TEXT,
        stale INTEGER DEFAULT 0
      );
      CREATE INDEX idx_obs_symbol_ts ON observations(symbol, market_ts);
      CREATE TABLE provider_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        day TEXT NOT NULL,
        minute_bucket TEXT,
        credits REAL DEFAULT 0,
        requests INTEGER DEFAULT 0,
        ts TEXT NOT NULL
      );
      CREATE INDEX idx_usage_provider_day ON provider_usage(provider, day);
      CREATE TABLE articles (
        url_hash TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        headline TEXT,
        snippet TEXT,
        source TEXT,
        source_domain TEXT,
        published_ts TEXT,
        first_seen_ts TEXT NOT NULL,
        retrieved_ts TEXT NOT NULL,
        content_hash TEXT,
        engine TEXT,
        query TEXT,
        raw_json TEXT
      );
      CREATE INDEX idx_articles_first_seen ON articles(first_seen_ts);
      CREATE TABLE article_entities (
        url_hash TEXT NOT NULL,
        symbol TEXT NOT NULL,
        PRIMARY KEY (url_hash, symbol)
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cluster_key TEXT UNIQUE NOT NULL,
        title TEXT,
        category TEXT,
        first_seen_ts TEXT NOT NULL,
        last_updated_ts TEXT NOT NULL,
        status TEXT DEFAULT 'new',
        decision TEXT,
        score REAL,
        confidence REAL,
        summary_json TEXT,
        model_json TEXT,
        evidence_json TEXT,
        uncertain_json TEXT,
        symbols_json TEXT,
        last_notified_ts TEXT
      );
      CREATE TABLE event_articles (
        event_id INTEGER NOT NULL,
        url_hash TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0,
        added_ts TEXT NOT NULL,
        PRIMARY KEY (event_id, url_hash)
      );
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        dedupe_key TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        state TEXT DEFAULT 'unread'
      );
      CREATE TABLE cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        started_ts TEXT NOT NULL,
        finished_ts TEXT,
        status TEXT,
        queries_planned INTEGER,
        queries_used INTEGER,
        articles_new INTEGER,
        events_new INTEGER,
        errors_json TEXT
      );
      CREATE TABLE scheduler_locks (
        name TEXT PRIMARY KEY,
        owner TEXT,
        heartbeat_ts TEXT
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE cycles ADD COLUMN articles_seen INTEGER;
      ALTER TABLE cycles ADD COLUMN articles_duplicate INTEGER;
    `,
  },
];

let db = null;

export function isSqliteAvailable() {
  return Boolean(DatabaseSync);
}

export function initDb({ dbPath = config.dbPath } = {}) {
  if (!DatabaseSync) {
    throw new Error(
      'node:sqlite is unavailable. Node.js 22.5+ is required (this project is developed on Node 24).',
    );
  }
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      /* WAL optional */
    }
  }
  db.exec('PRAGMA foreign_keys = ON;');
  migrate();
  seedSettings();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function migrate() {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
  );
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => Number(r.version)),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      logger.info('db.migration.applied', { version: m.version });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function seedSettings() {
  const existing = getSetting('__initialised__', null);
  if (existing) return;
  setSetting('app', getDefaultSettings());
  setSetting('__initialised__', true);
}

/* ---------------- small typed helpers ---------------- */

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now);
  return value;
}

/** Deep-merge stored settings over the defaults so new keys appear automatically. */
export function getSettings() {
  const base = getDefaultSettings();
  const stored = getSetting('app', {}) || {};
  return deepMerge(base, stored);
}

export function saveSettings(patch) {
  const merged = deepMerge(getSettings(), patch || {});
  setSetting('app', merged);
  return merged;
}

export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== 'object' || base === null) return override ?? base;
  if (typeof override !== 'object' || override === null) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}
