import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './src/config.js';
import { logger } from './src/logger.js';
import { initDb, closeDb } from './src/db.js';
import { callSerpApi, resolveSerpApiKey } from './src/serpapi.js';
import { listWatchlist, defaultWatchlist, upsertWatchlist } from './src/watchlist.js';
import { startScheduler, stopScheduler } from './src/scheduler.js';
import secretsRouter from './src/routes/secrets.js';
import settingsRouter from './src/routes/settings.js';
import watchlistRouter from './src/routes/watchlist.js';
import statusRouter from './src/routes/status.js';
import marketRouter from './src/routes/market.js';
import newsRouter from './src/routes/news.js';
import eventsRouter from './src/routes/events.js';
import ollamaRouter from './src/routes/ollama.js';
import replayRouter from './src/routes/replay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const VALID_WINDOWS = new Set(['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX']);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Explorer endpoints (existing behaviour preserved)                   */
/* ------------------------------------------------------------------ */

function pickExplorerKey(body) {
  return (typeof body?.apiKey === 'string' && body.apiKey.trim()) || resolveSerpApiKey();
}

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
  const fromItem = (s) =>
    add({ q: s.stock, symbol: s.stock, name: s.name, price: s.price, extracted_price: s.extracted_price, currency: s.currency, price_movement: s.price_movement });

  (data.suggestions || []).forEach(fromItem);
  (data.discover_more || []).forEach((g) => (g.items || []).forEach(fromItem));
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
  res.json({ hasServerKey: Boolean(resolveSerpApiKey()) });
});

app.post('/api/search', async (req, res) => {
  const body = req.body || {};
  const query = typeof body.q === 'string' ? body.q.trim() : '';
  const windowParam =
    typeof body.window === 'string' && VALID_WINDOWS.has(body.window) ? body.window : null;
  const apiKey = pickExplorerKey(body);

  if (!query) {
    return res.status(400).json({ error: 'Enter a stock name, ticker, or symbol (e.g. AAPL:NASDAQ).' });
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
  const apiKey = pickExplorerKey(body);
  if (query.length < 2) return res.json({ recommendations: [], cached: false });
  if (!apiKey) return res.status(400).json({ error: 'No SerpAPI key configured.' });

  const { status, data } = await callSerpApi('google_finance', query, { hl: 'en' }, apiKey);
  if (status === 401 || status === 403) return res.status(status).json(data);
  return res.json({ recommendations: normalizeSuggestions(data), cached: Boolean(data._cached) });
});

app.post('/api/news', async (req, res) => {
  const body = req.body || {};
  const query = typeof body.q === 'string' ? body.q.trim() : '';
  const apiKey = pickExplorerKey(body);
  if (!query) return res.json({ news_results: [] });
  if (!apiKey) return res.status(400).json({ error: 'No SerpAPI key configured.' });

  const { status, data } = await callSerpApi('google_news', query, { gl: 'us', hl: 'en', so: '1' }, apiKey);
  return res.status(status).json(data);
});

/* ------------------------------------------------------------------ */
/* Intelligence platform routes                                        */
/* ------------------------------------------------------------------ */

app.use('/api/secrets', secretsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/market', marketRouter);
app.use('/api/news', newsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/ollama', ollamaRouter);
app.use('/api/replay', replayRouter);
app.use('/api/status', statusRouter);

app.use((err, _req, res, _next) => {
  logger.error('http.unhandled', { error: err?.message });
  res.status(500).json({ error: 'Internal server error.' });
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  initDb();
  if (listWatchlist().length === 0) {
    for (const e of defaultWatchlist()) upsertWatchlist(e);
    logger.info('watchlist.seeded.defaults');
  }

  const server = app.listen(config.port, () => {
    logger.info('server.listening', { port: config.port });
    console.log(`\n  SerpAPI Intelligence  ->  http://localhost:${config.port}`);
    console.log(`  Explorer:   http://localhost:${config.port}/`);
    console.log(`  Dashboard:  http://localhost:${config.port}/dashboard.html\n`);
    console.log(
      resolveSerpApiKey()
        ? '  SerpAPI key: configured'
        : '  SerpAPI key: not configured (enter it in the dashboard Keys page)',
    );
    startScheduler();
  });

  const shutdown = () => {
    stopScheduler();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

boot();
