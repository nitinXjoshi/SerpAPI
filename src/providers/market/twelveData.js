import { normalizeQuote } from '../../market/normalize.js';
import { logger } from '../../logger.js';

const BASE = 'https://api.twelvedata.com';
const TIMEOUT_MS = 20000;

function isErrorObject(obj) {
  return obj && typeof obj === 'object' && (obj.status === 'error' || obj.code != null);
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
};
