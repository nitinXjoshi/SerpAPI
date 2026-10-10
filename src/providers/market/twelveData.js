import { normalizeQuote } from '../../market/normalize.js';
import { logger } from '../../logger.js';

const BASE = 'https://api.twelvedata.com';
const TIMEOUT_MS = 20000;

function isErrorObject(obj) {
  return obj && typeof obj === 'object' && (obj.status === 'error' || obj.code != null);
}

const DAILY_INTERVALS = new Set(['1day', '1week', '1month']);

/** Numbers only when a value is actually present, so `Number(null)` never turns into 0. */
function numOrNaN(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
}

/** Convert "YYYY-MM-DD HH:mm:ss" in an IANA timezone to a UTC epoch (seconds). */
function zonedToUnix(dateStr, timeZone) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
        .formatToParts(new Date(guess))
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day,
      parts.hour === '24' ? 0 : +parts.hour, +parts.minute, +parts.second,
    );
    return Math.floor((guess - (asUtc - guess)) / 1000);
  } catch {
    return Math.floor(guess / 1000);
  }
}

/**
 * Twelve Data market provider.
 * Free tier: 8 credits/min, 800/day. Credits = 1 per symbol (quote weight 1).
 * `symbol` accepts a comma-separated batch; one HTTP request covers the watchlist.
 */
export const twelveDataProvider = {
  id: 'twelvedata',
  label: 'Twelve Data',
  supportsBatch: true,

  creditCost(symbols) {
    return (symbols || []).length;
  },

  async fetchQuotes(symbols, { apiKey, timeoutMs = TIMEOUT_MS } = {}) {
    const list = (symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
    if (list.length === 0) return { quotes: [], creditsUsed: 0, failed: [] };
    if (!apiKey) {
      return { quotes: [], creditsUsed: 0, failed: [], error: 'Twelve Data API key is not configured.' };
    }

    // Real exchanges use ";" separated exchanges; our symbols are plain tickers.
    const url = new URL(`${BASE}/quote`);
    url.searchParams.set('symbol', list.join(','));
    url.searchParams.set('apikey', apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const creditsUsed = Number(res.headers.get('api-credits-used'));
      const creditsLeft = Number(res.headers.get('api-credits-left'));
      const json = await res.json().catch(() => null);

      if (res.status === 429 || json?.code === 429) {
        return {
          quotes: [],
          creditsUsed: Number.isFinite(creditsUsed) ? creditsUsed : 0,
          creditsLeft: Number.isFinite(creditsLeft) ? creditsLeft : undefined,
          failed: list.map((symbol) => ({ symbol, error: 'rate_limited' })),
          rateLimited: true,
          error: json?.message || 'Twelve Data rate limit reached (429).',
        };
      }
      if (json?.code === 401 || json?.code === 403) {
        return { quotes: [], creditsUsed: 0, failed: [], error: 'Twelve Data rejected the API key.' };
      }

      const retrievedTs = new Date().toISOString();
      const quotes = [];
      const failed = [];

      if (list.length === 1) {
        const sym = list[0];
        if (isErrorObject(json)) failed.push({ symbol: sym, error: json.message || `code ${json.code}` });
        else quotes.push(normalizeQuote(json, { provider: 'twelvedata', symbol: sym, retrievedTs }));
      } else {
        for (const sym of list) {
          const raw = json?.[sym];
          if (!raw || isErrorObject(raw)) {
            failed.push({ symbol: sym, error: raw?.message || 'no data' });
            continue;
          }
          quotes.push(normalizeQuote(raw, { provider: 'twelvedata', symbol: sym, retrievedTs }));
        }
      }

      return {
        quotes,
        failed,
        creditsUsed: Number.isFinite(creditsUsed) ? creditsUsed : list.length,
        creditsLeft: Number.isFinite(creditsLeft) ? creditsLeft : undefined,
      };
    } catch (err) {
      const aborted = err.name === 'AbortError';
      logger.warn('twelvedata.fetch.failed', { aborted, error: err.message });
      return {
        quotes: [],
        creditsUsed: 0,
        failed: list.map((symbol) => ({ symbol, error: aborted ? 'timeout' : err.message })),
        error: aborted ? 'Twelve Data request timed out.' : `Twelve Data request failed: ${err.message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  },

  /** Real OHLC candles. `bars` are ascending and use UTC seconds, or 'YYYY-MM-DD' for daily+. */
  async fetchCandles(symbol, { interval = '1day', outputsize = 180, apiKey, timeoutMs = TIMEOUT_MS } = {}) {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return { bars: [], error: 'A symbol is required.' };
    if (!apiKey) return { bars: [], error: 'Twelve Data API key is not configured.' };

    const url = new URL(`${BASE}/time_series`);
    url.searchParams.set('symbol', sym);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(Math.min(Math.max(Number(outputsize) || 180, 1), 5000)));
    url.searchParams.set('apikey', apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const creditsUsed = Number(res.headers.get('api-credits-used'));
      const creditsLeft = Number(res.headers.get('api-credits-left'));
      const json = await res.json().catch(() => null);

      if (res.status === 429 || json?.code === 429) {
        return { bars: [], rateLimited: true, error: 'Twelve Data rate limit reached. Try again shortly.' };
      }
      if (json?.code === 401 || json?.code === 403) {
        return { bars: [], error: 'Twelve Data rejected the API key.' };
      }
      if (isErrorObject(json) && !Array.isArray(json?.values)) {
        return { bars: [], error: json?.message || 'No candle data returned for this symbol.', code: json?.code };
      }

      const tz = json?.meta?.exchange_timezone || 'UTC';
      const values = Array.isArray(json?.values) ? json.values : [];
      const bars = values
        .map((v) => {
          const time = DAILY_INTERVALS.has(interval)
            ? String(v.datetime).slice(0, 10)
            : zonedToUnix(v.datetime, tz);
          return {
            time,
            open: numOrNaN(v.open),
            high: numOrNaN(v.high),
            low: numOrNaN(v.low),
            close: numOrNaN(v.close),
            volume: v.volume != null && v.volume !== '' ? Number(v.volume) : null,
          };
        })
        // A candle needs all four prices. `Number(null)` is 0, so a missing field must become
        // NaN (unavailable) rather than a $0.00 bar that would silently distort the chart.
        .filter((b) => b.time != null && Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close))
        .sort((a, b) => {
          const ta = typeof a.time === 'number' ? a.time : Date.parse(`${a.time}T00:00:00Z`) / 1000;
          const tb = typeof b.time === 'number' ? b.time : Date.parse(`${b.time}T00:00:00Z`) / 1000;
          return ta - tb;
        })
        // Providers occasionally repeat a bar for the same timestamp; keep the latest of each
        // so the chart gets strictly ascending, unique times (Lightweight Charts requires it).
        .filter((b, i, arr) => i === arr.length - 1 || b.time !== arr[i + 1].time);

      return {
        bars,
        meta: {
          symbol: json?.meta?.symbol || sym,
          interval: json?.meta?.interval || interval,
          exchange: json?.meta?.exchange || null,
          timezone: tz,
          currency: json?.meta?.currency || null,
        },
        creditsUsed: Number.isFinite(creditsUsed) ? creditsUsed : 1,
        creditsLeft: Number.isFinite(creditsLeft) ? creditsLeft : undefined,
      };
    } catch (err) {
      const aborted = err.name === 'AbortError';
      logger.warn('twelvedata.candles.failed', { aborted, error: err.message });
      return { bars: [], error: aborted ? 'Twelve Data request timed out.' : 'Twelve Data request failed.' };
    } finally {
      clearTimeout(timer);
    }
  },

  /** Symbol search across the provider's coverage (real instrument metadata). */
  async searchSymbols(query, { apiKey, outputsize = 25, timeoutMs = TIMEOUT_MS } = {}) {
    const q = String(query || '').trim();
    if (!q) return { results: [], creditsUsed: 0 };
    if (!apiKey) return { results: [], error: 'Twelve Data API key is not configured.' };

    const url = new URL(`${BASE}/symbol_search`);
    url.searchParams.set('symbol', q);
    url.searchParams.set('outputsize', String(Math.min(Math.max(Number(outputsize) || 25, 1), 50)));
    url.searchParams.set('apikey', apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const creditsUsed = Number(res.headers.get('api-credits-used'));
      const json = await res.json().catch(() => null);
      if (res.status === 429 || json?.code === 429) {
        return { results: [], rateLimited: true, error: 'Twelve Data rate limit reached.' };
      }
      if (json?.code === 401 || json?.code === 403) {
        return { results: [], error: 'Twelve Data rejected the API key.' };
      }
      const data = Array.isArray(json?.data) ? json.data : [];
      const results = data
        .map((d) => ({
          symbol: d.symbol,
          name: d.instrument_name,
          exchange: d.exchange,
          mic: d.mic_code,
          type: d.instrument_type,
          country: d.country,
          currency: d.currency,
        }))
        .filter((d) => d.symbol && d.name);
      return { results, creditsUsed: Number.isFinite(creditsUsed) ? creditsUsed : 1 };
    } catch (err) {
      const aborted = err.name === 'AbortError';
      logger.warn('twelvedata.search.failed', { aborted, error: err.message });
      return { results: [], error: aborted ? 'Twelve Data request timed out.' : 'Twelve Data request failed.' };
    } finally {
      clearTimeout(timer);
    }
  },
};
