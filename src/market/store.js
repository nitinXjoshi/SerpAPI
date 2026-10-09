import { getDb } from '../db.js';

export function insertObservation(q, retrievedTs = new Date().toISOString()) {
  getDb()
    .prepare(
      `INSERT INTO observations
        (symbol, provider, price, change, change_pct, volume, currency, market_ts, retrieved_ts, source, stale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      q.symbol,
      q.source || q.provider || null,
      q.price ?? null,
      q.change ?? null,
      q.changePct ?? null,
      q.volume ?? null,
      q.currency ?? null,
      q.marketTs ?? null,
      q.retrievedTs || retrievedTs,
      q.source || null,
      q.stale ? 1 : 0,
    );
}

export function insertObservations(quotes) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    for (const q of quotes) insertObservation(q);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function rowToObs(r) {
  if (!r) return null;
  return {
    symbol: r.symbol,
    provider: r.provider,
    price: r.price,
    change: r.change,
    changePct: r.change_pct,
    volume: r.volume,
    currency: r.currency,
    marketTs: r.market_ts,
    retrievedTs: r.retrieved_ts,
    source: r.source,
    stale: Boolean(r.stale),
  };
}

export function latestObservation(symbol) {
  const r = getDb()
    .prepare(
      'SELECT * FROM observations WHERE symbol = ? ORDER BY market_ts DESC, id DESC LIMIT 1',
    )
    .get(String(symbol).toUpperCase());
  return rowToObs(r);
}

/** Most recent observation per symbol (single query with a correlated sub-select). */
export function latestObservations(symbols) {
  const list = [...new Set((symbols || []).map((s) => String(s).toUpperCase()))];
  if (!list.length) return {};
  const placeholders = list.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT o.* FROM observations o
       WHERE o.symbol IN (${placeholders})
         AND o.id = (SELECT id FROM observations WHERE symbol = o.symbol ORDER BY market_ts DESC, id DESC LIMIT 1)`,
    )
    .all(...list);
  const out = {};
  for (const r of rows) out[r.symbol] = rowToObs(r);
  return out;
}

export function observationsBetween(symbol, fromIso, toIso) {
  return getDb()
    .prepare(
      `SELECT * FROM observations WHERE symbol = ? AND market_ts >= ? AND market_ts <= ?
       ORDER BY market_ts ASC`,
    )
    .all(String(symbol).toUpperCase(), fromIso, toIso)
    .map(rowToObs);
}

export function observationCount() {
  return Number(getDb().prepare('SELECT COUNT(*) AS c FROM observations').get().c);
}

export function pruneObservations(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  getDb().prepare('DELETE FROM observations WHERE retrieved_ts < ?').run(cutoff);
}
