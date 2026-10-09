import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SERPAPI_ENDPOINT = 'https://serpapi.com/search';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const VALID_WINDOWS = new Set(['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX']);

const cache = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Single SerpAPI call (any engine) with a shared 10-minute cache. */
async function callSerpApi(engine, query, params, apiKey) {
  const paramKey = Object.entries(params || {})
    .filter(([, v]) => v != null)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const cacheKey = `${engine}::${(query || '').toLowerCase()}::${paramKey}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
    return { status: 200, data: { ...hit.data, _cached: true } };
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

    if (upstream.ok && !data.error && data.search_metadata?.status !== 'Error') {
      cache.set(cacheKey, { time: Date.now(), data });
    }

    return { status: upstream.ok ? 200 : upstream.status, data };
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return {
      status: aborted ? 504 : 502,
      data: {
        error: aborted
          ? 'The request to SerpAPI timed out. Please try again.'
          : `Could not reach SerpAPI: ${err.message}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function pickKey(body) {
  return (typeof body?.apiKey === 'string' && body.apiKey.trim()) || process.env.SERPAPI_API_KEY;
}

/** Turn any SerpAPI response into a flat list of instrument recommendations. */
function normalizeSuggestions(data) {
  const out = [];
  const seen = new Set();

  const add = (item) => {
    const q = item.q || item.stock || '';
    if (!q || seen.has(q)) return;
    seen.add(q);
    out.push({
      q,
      symbol: item.symbol || item.stock || q,
      name: item.name || '',
      price: item.price,
      extracted_price: item.extracted_price,
      currency: item.currency,
      price_movement: item.price_movement,
    });
  };

  const fromMarketItem = (s) =>
    add({ q: s.stock, symbol: s.stock, name: s.name, price: s.price, extracted_price: s.extracted_price, currency: s.currency, price_movement: s.price_movement });

  (data.suggestions || []).forEach(fromMarketItem);
  (data.discover_more || []).forEach((group) => (group.items || []).forEach(fromMarketItem));

  if (data.summary?.stock) {
    add({
      q: `${data.summary.stock}${data.summary.exchange ? `:${data.summary.exchange}` : ''}`,
      symbol: data.summary.stock,
      name: data.summary.title,
      price: data.summary.price,
      extracted_price: data.summary.extracted_price,
      currency: data.summary.currency,
      price_movement: data.summary.price_movement,
    });
  }

  return out.slice(0, 10);
}

app.get('/api/config', (_req, res) => {
  res.json({ hasServerKey: Boolean(process.env.SERPAPI_API_KEY) });
});

app.post('/api/search', async (req, res) => {
  const body = req.body || {};
  const query = typeof body.q === 'string' ? body.q.trim() : '';
  const windowParam =
    typeof body.window === 'string' && VALID_WINDOWS.has(body.window) ? body.window : null;
  const apiKey = pickKey(body);

  if (!query) {
    return res
      .status(400)
      .json({ error: 'Enter a stock name, ticker, or symbol (e.g. AAPL:NASDAQ).' });
  }
  if (!apiKey) {
    return res.status(400).json({
      error:
        'No SerpAPI key found. Add SERPAPI_API_KEY to your .env file or paste a key in the Settings panel.',
    });
  }

  const params = { hl: 'en' };
  if (windowParam) params.window = windowParam;

  const { status, data } = await callSerpApi('google_finance', query, params, apiKey);
  return res.status(status).json(data);
});

app.post('/api/suggest', async (req, res) => {
  const body = req.body || {};
  const query = typeof body.q === 'string' ? body.q.trim() : '';
  const apiKey = pickKey(body);

  if (query.length < 2) return res.json({ recommendations: [], cached: false });
  if (!apiKey) return res.status(400).json({ error: 'No SerpAPI key configured.' });

  const { status, data } = await callSerpApi('google_finance', query, { hl: 'en' }, apiKey);
  // Surface auth problems, but stay quiet for empty/no-match queries while typing.
  if (status === 401 || status === 403) return res.status(status).json(data);

  return res.json({
    recommendations: normalizeSuggestions(data),
    cached: Boolean(data._cached),
  });
});

app.post('/api/news', async (req, res) => {
  const body = req.body || {};
  const query = typeof body.q === 'string' ? body.q.trim() : '';
  const apiKey = pickKey(body);

  if (!query) return res.json({ news_results: [] });
  if (!apiKey) return res.status(400).json({ error: 'No SerpAPI key configured.' });

  const { status, data } = await callSerpApi(
    'google_news',
    query,
    { gl: 'us', hl: 'en', so: '1' },
    apiKey,
  );
  return res.status(status).json(data);
});

app.listen(PORT, () => {
  console.log(`\n  Google Finance Viewer  ->  http://localhost:${PORT}\n`);
  console.log(
    process.env.SERPAPI_API_KEY
      ? '  Using SERPAPI_API_KEY from environment.'
      : '  No SERPAPI_API_KEY set - add one to .env or paste a key in the UI.',
  );
});
