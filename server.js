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

import { securityHeaders } from './src/security/headers.js';
import { createRateLimiter } from './src/security/rateLimit.js';
import {
  asyncHandler,
  sanitizeUpstream,
  upstreamErrorMessage,
} from './src/security/errors.js';
import { initAuth, stopAuth, requireAuth, sameOriginGuard, authMode } from './src/security/auth.js';
import { asString, asEnum } from './src/security/validate.js';
import { seedDemoData } from './src/demo/seed.js';

import authRouter from './src/routes/auth.js';
import secretsRouter from './src/routes/secrets.js';
import settingsRouter from './src/routes/settings.js';
import watchlistRouter from './src/routes/watchlist.js';
import statusRouter from './src/routes/status.js';
import marketRouter from './src/routes/market.js';
import newsRouter from './src/routes/news.js';
import eventsRouter from './src/routes/events.js';
import opportunitiesRouter from './src/routes/opportunities.js';
import ollamaRouter from './src/routes/ollama.js';
import replayRouter from './src/routes/replay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const VALID_WINDOWS = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX'];

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(securityHeaders());
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

// Public auth endpoints (login must be reachable before a session exists).
app.use('/api/auth', authRouter);

// Baseline throttle for the whole API, then re-assert same-origin for state changes,
// then require an authenticated session for everything else under /api.
const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 300 });
const expensive = createRateLimiter({ windowMs: 60_000, max: 60, message: 'Too many requests for this operation.' });
const heavy = createRateLimiter({ windowMs: 60_000, max: 20, message: 'Too many requests for this operation.' });

app.use('/api', apiLimiter, sameOriginGuard, requireAuth);

/* ------------------------------------------------------------------ */
/* Explorer endpoints (server-side key only; no client-supplied keys)  */
/* ------------------------------------------------------------------ */

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
  res.json({
    hasServerKey: Boolean(resolveSerpApiKey()),
    demoMode: config.demoMode,
  });
});

app.post(
  '/api/search',
  expensive,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const query = asString(String(body.q ?? ''), { field: 'q', min: 1, max: 120 });
    const windowParam = body.window === undefined ? null : asEnum(body.window, VALID_WINDOWS, { field: 'window' });

    const apiKey = resolveSerpApiKey();
    if (!apiKey) {
      return res.status(503).json({ error: 'No SerpAPI key configured. Add one in the dashboard API Keys page.' });
    }
    const params = { hl: 'en' };
    if (windowParam) params.window = windowParam;
    const { status, data } = await callSerpApi('google_finance', query, params, apiKey);
    if (status !== 200 || data?.error) {
      return res.status(status === 200 ? 502 : status).json({ error: upstreamErrorMessage(status) });
    }
    res.json(sanitizeUpstream(data));
  }),
);

app.post(
  '/api/suggest',
  expensive,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const query = asString(String(body.q ?? ''), { field: 'q', min: 1, max: 120 });
    if (query.length < 2) return res.json({ recommendations: [], cached: false });

    const apiKey = resolveSerpApiKey();
    if (!apiKey) return res.status(503).json({ error: 'No SerpAPI key configured.' });

    const { status, data } = await callSerpApi('google_finance', query, { hl: 'en' }, apiKey);
    if (status === 401 || status === 403) return res.status(status).json({ error: upstreamErrorMessage(status) });
    if (status !== 200 || data?.error) return res.json({ recommendations: [], cached: false });
    res.json({ recommendations: normalizeSuggestions(data), cached: Boolean(data._cached) });
  }),
);

app.post(
  '/api/news',
  expensive,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const query = asString(String(body.q ?? ''), { field: 'q', min: 1, max: 120 });

    const apiKey = resolveSerpApiKey();
    if (!apiKey) return res.status(503).json({ error: 'No SerpAPI key configured.' });

    // google_news rejects `so` together with `q`; omit it for query-based lookups.
    const { status, data } = await callSerpApi('google_news', query, { gl: 'us', hl: 'en' }, apiKey);
    if (status !== 200 || data?.error) {
      return res.status(status === 200 ? 502 : status).json({ error: upstreamErrorMessage(status) });
    }
    res.json({ news_results: data.news_results || [] });
  }),
);

/* ------------------------------------------------------------------ */
/* Intelligence platform routes (authenticated)                        */
/* ------------------------------------------------------------------ */

app.use('/api/secrets', heavy, secretsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/market', heavy, marketRouter);
app.use('/api/news', heavy, newsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/ollama', heavy, ollamaRouter);
app.use('/api/replay', heavy, replayRouter);
app.use('/api/status', statusRouter);

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

app.use((err, _req, res, _next) => {
  // Body-parser errors can echo request fragments — never surface them.
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  if (err?.name === 'ValidationError') {
    return res.status(400).json({ error: err.message, ...(err.field ? { field: err.field } : {}) });
  }
  const status = Number.isInteger(err?.status) ? err.status : 500;
  if (status >= 500) {
    logger.error('http.unhandled', { error: err });
    return res.status(500).json({ error: 'Internal server error.' });
  }
  logger.warn('http.error', { status, error: err });
  res.status(status).json({ error: 'Request failed.' });
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

async function boot() {
  if (config.demoMode && config.hackathonMode) {
    console.error('\n  Refusing to start: DEMO_MODE and HACKATHON_MODE are mutually exclusive.');
    console.error('  Use one mode at a time.\n');
    process.exit(1);
  }

  // Both demo and hackathon modes are unauthenticated, so they must never be exposed
  // off-host: refuse any non-loopback bind before opening a socket.
  if ((config.demoMode || config.hackathonMode) && !LOOPBACK_HOSTS.has(config.host)) {
    const which = config.hackathonMode ? 'hackathon mode' : 'judge demo';
    console.error(`\n  Refusing to start: ${which} is loopback-only (HOST=${config.host}).`);
    console.error('  Unset HOST or use HOST=127.0.0.1.\n');
    process.exit(1);
  }

  // Demo runs on an ephemeral in-memory database so it can never touch, expose, or
  // mutate the operator's real data or stored provider keys. Hackathon mode uses the
  // normal persistent database (and the existing encryption key / stored credentials).
  initDb({ dbPath: config.demoMode ? ':memory:' : config.dbPath });

  if (listWatchlist().length === 0) {
    for (const e of defaultWatchlist()) upsertWatchlist(e);
    logger.info('watchlist.seeded.defaults');
  }

  if (config.demoMode) {
    const summary = await seedDemoData();
    logger.info('demo.ready', summary);
  } else if (!config.hackathonMode) {
    // Hackathon mode has no sessions or login, so no auth bootstrap is needed.
    initAuth();
  }

  const server = app.listen(config.port, config.host, () => {
    logger.info('server.listening', {
      host: config.host,
      port: config.port,
      mode: authMode(),
    });
    const base = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`\n  InfoMark  ->  ${base}`);
    console.log(`  Dashboard:  ${base}/dashboard.html`);
    console.log(`  Explorer:   ${base}/`);
    if (config.hackathonMode) {
      console.log('  Mode:       HACKATHON (no sign-in) — loopback only, real providers');
      console.log('  Security:   validation, rate limits, same-origin checks, headers and key masking stay active');
    } else if (config.demoMode) {
      console.log('  Mode:       DEMO (read-only) — fixture data, no provider or Ollama calls');
      console.log('  Login:      not required in demo mode');
    } else {
      console.log(
        `  Auth:       ${config.auth.disabled ? 'DISABLED (insecure local mode)' : 'required (log in with your admin credentials)'}`,
      );
    }
    if (!config.demoMode) {
      console.log(
        resolveSerpApiKey()
          ? '  SerpAPI key: configured'
          : '  SerpAPI key: not configured (add it in the dashboard API Keys page)',
      );
    }
    if (config.host === '0.0.0.0') {
      console.log('  ⚠  HOST=0.0.0.0 — the dashboard is reachable from other machines on your network.');
    }
    console.log('');
    if (!config.demoMode) startScheduler();
  });

  const shutdown = () => {
    stopScheduler();
    stopAuth();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await boot();
