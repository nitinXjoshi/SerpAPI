import { getSecretValue } from './secrets.js';
import { logger } from './logger.js';

const SERPAPI_ENDPOINT = 'https://serpapi.com/search';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

const cache = new Map();

/** Server-side key resolution: stored secret first, then environment. */
export function resolveSerpApiKey() {
  return getSecretValue('serpapi_api_key') || process.env.SERPAPI_API_KEY || null;
}

export function clearSerpApiCache() {
  cache.clear();
}

/** Single SerpAPI call (any engine) with a shared cache. Returns {status, data, creditsUsed}. */
export async function callSerpApi(engine, query, params, apiKey) {
  if (!apiKey) {
    return { status: 400, data: { error: 'No SerpAPI key configured.' } };
  }
  const paramKey = Object.entries(params || {})
    .filter(([, v]) => v != null)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const cacheKey = `${engine}::${(query || '').toLowerCase()}::${paramKey}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
    return { status: 200, data: { ...hit.data, _cached: true }, creditsUsed: 0, cached: true };
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set('engine', engine);
  if (query) url.searchParams.set('q', query);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('api_key', apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: `Unexpected response from SerpAPI: ${text.slice(0, 200)}` };
    }

    const ok = upstream.ok && !data.error && data.search_metadata?.status !== 'Error';
    if (ok) cache.set(cacheKey, { time: Date.now(), data });

    return {
      status: upstream.ok ? 200 : upstream.status,
      data,
      creditsUsed: ok ? 1 : 0,
      cached: false,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const aborted = err.name === 'AbortError';
    logger.warn('serpapi.request.failed', { engine, aborted, error: err.message });
    return {
      status: aborted ? 504 : 502,
      data: {
        error: aborted
          ? 'The request to SerpAPI timed out. Please try again.'
          : `Could not reach SerpAPI: ${err.message}`,
      },
      creditsUsed: 0,
      cached: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

let accountCache = { at: 0, data: null };

/** GET /account.json — free of charge, used for quota planning. */
export async function fetchSerpApiAccount(apiKey, { maxAgeMs = 5 * 60 * 1000 } = {}) {
  if (!apiKey) return null;
  if (accountCache.data && Date.now() - accountCache.at < maxAgeMs) return accountCache.data;
  try {
    const res = await fetch(
      `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: 'application/json' } },
    );
    const data = await res.json().catch(() => null);
    if (res.ok && data && !data.error) {
      accountCache = { at: Date.now(), data };
      return data;
    }
    return null;
  } catch (err) {
    logger.warn('serpapi.account.failed', { error: err.message });
    return null;
  }
}
