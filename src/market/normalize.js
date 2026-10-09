const STALE_AFTER_MINUTES = 30;

export function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Parse a provider timestamp into an ISO string, or null. */
export function parseProviderTime(str, timestamp) {
  if (timestamp != null) {
    const n = Number(timestamp);
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
  }
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Normalize a raw provider quote into the common observation shape.
 * `market_ts` is the exchange time of the observation; `retrieved_ts` is when we fetched it.
 * A cached/old quote is never presented as a fresh movement — it is flagged `stale`.
 */
export function normalizeQuote(raw, {
  provider,
  symbol,
  retrievedTs = new Date().toISOString(),
  staleAfterMinutes = STALE_AFTER_MINUTES,
} = {}) {
  const marketTs = parseProviderTime(raw.datetime || raw.date || raw.time, raw.timestamp);
  const price = toNumber(raw.close ?? raw.price);
  const previousClose = toNumber(raw.previous_close);
  const change = toNumber(raw.change);
  let changePct = toNumber(raw.percent_change);
  if (changePct == null && change != null && previousClose) {
    changePct = (change / previousClose) * 100;
  }
  if (changePct == null && price != null && previousClose) {
    changePct = ((price - previousClose) / previousClose) * 100;
  }

  const ageMs = marketTs ? Date.now() - Date.parse(marketTs) : Infinity;
  const marketClosed = raw.is_market_open === false;
  const stale = !marketTs || ageMs > staleAfterMinutes * 60 * 1000 || marketClosed;

  return {
    symbol: String(symbol || raw.symbol || '').toUpperCase(),
    exchange: raw.exchange ?? null,
    price,
    previousClose,
    change,
    changePct,
    volume: toNumber(raw.volume ?? raw.average_volume),
    currency: raw.currency ?? null,
    marketTs,
    retrievedTs,
    source: provider,
    marketClosed,
    stale,
  };
}

export { STALE_AFTER_MINUTES };
