import { getDb } from './db.js';

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapRow(r) {
  return {
    symbol: r.symbol,
    exchange: r.exchange,
    companyName: r.company_name,
    aliases: parseJson(r.aliases_json, []),
    sector: r.sector,
    benchmarkSymbol: r.benchmark_symbol,
    peers: parseJson(r.peers_json, []),
    importance: r.importance ?? 0.5,
    enabled: Boolean(r.enabled),
    addedAt: r.added_at,
  };
}

export function listWatchlist() {
  return getDb()
    .prepare('SELECT * FROM watchlist ORDER BY importance DESC, symbol ASC')
    .all()
    .map(mapRow);
}

export function getWatchEntry(symbol) {
  const row = getDb()
    .prepare('SELECT * FROM watchlist WHERE symbol = ?')
    .get(String(symbol).toUpperCase());
  return row ? mapRow(row) : null;
}

function normalizeSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-:]{1,16}$/.test(s)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
  return s;
}

export function upsertWatchlist(entry) {
  const symbol = normalizeSymbol(entry.symbol);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO watchlist (symbol, exchange, company_name, aliases_json, sector, benchmark_symbol, peers_json, importance, enabled, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         exchange = excluded.exchange,
         company_name = excluded.company_name,
         aliases_json = excluded.aliases_json,
         sector = excluded.sector,
         benchmark_symbol = excluded.benchmark_symbol,
         peers_json = excluded.peers_json,
         importance = excluded.importance,
         enabled = excluded.enabled`,
    )
    .run(
      symbol,
      entry.exchange ?? null,
      entry.companyName ?? null,
      JSON.stringify(entry.aliases ?? []),
      entry.sector ?? null,
      entry.benchmarkSymbol ?? null,
      JSON.stringify(entry.peers ?? []),
      Number.isFinite(Number(entry.importance)) ? Number(entry.importance) : 0.5,
      entry.enabled === false ? 0 : 1,
      now,
    );
  return getWatchEntry(symbol);
}

export function removeWatchlist(symbol) {
  getDb().prepare('DELETE FROM watchlist WHERE symbol = ?').run(String(symbol).toUpperCase());
}

/**
 * All symbols the market poller must fetch: enabled watchlist symbols plus their
 * benchmark and peer symbols (deduplicated).
 */
export function getSymbolSet() {
  const db = getDb();
  const enabled = db.prepare('SELECT * FROM watchlist WHERE enabled = 1').all().map(mapRow);
  const set = new Set();
  for (const e of enabled) {
    set.add(e.symbol);
    if (e.benchmarkSymbol) set.add(e.benchmarkSymbol.toUpperCase());
    for (const p of e.peers || []) set.add(String(p).toUpperCase());
  }
  return Array.from(set);
}

export function defaultWatchlist() {
  return [
    { symbol: 'NVDA', exchange: 'NASDAQ', companyName: 'NVIDIA Corporation', sector: 'Semiconductors', benchmarkSymbol: 'SOXX', peers: ['AMD', 'TSM'], importance: 0.9, aliases: ['Nvidia'] },
    { symbol: 'AMD', exchange: 'NASDAQ', companyName: 'Advanced Micro Devices', sector: 'Semiconductors', benchmarkSymbol: 'SOXX', peers: ['NVDA', 'INTC'], importance: 0.7, aliases: ['Advanced Micro Devices'] },
    { symbol: 'AAPL', exchange: 'NASDAQ', companyName: 'Apple Inc', sector: 'Technology', benchmarkSymbol: 'QQQ', peers: ['MSFT', 'GOOGL'], importance: 0.8, aliases: ['Apple'] },
    { symbol: 'MSFT', exchange: 'NASDAQ', companyName: 'Microsoft Corporation', sector: 'Technology', benchmarkSymbol: 'QQQ', peers: ['AAPL', 'GOOGL'], importance: 0.7, aliases: ['Microsoft'] },
    { symbol: 'SOXX', exchange: 'NASDAQ', companyName: 'iShares Semiconductor ETF', sector: 'Benchmark', benchmarkSymbol: 'SPY', peers: [], importance: 0.5, aliases: [] },
    { symbol: 'SPY', exchange: 'NYSEARCA', companyName: 'SPDR S&P 500 ETF Trust', sector: 'Benchmark', benchmarkSymbol: null, peers: [], importance: 0.5, aliases: [] },
  ];
}
