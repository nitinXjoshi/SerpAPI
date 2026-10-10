import { Router } from 'express';
import { buildRadar } from '../market/radar.js';
import { triggerMarketPoll } from '../scheduler.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asyncHandler } from '../security/errors.js';
import { asBool, asSymbol, asString, asInt, asEnum } from '../security/validate.js';
import { getSettings } from '../db.js';
import { resolveMarketProvider, getTwelveDataKey } from '../providers/market/index.js';
import { withinLimits, recordUsage } from '../quota/usageStore.js';
import { listArticlesBySymbol } from '../news/store.js';

const router = Router();
const pollGuard = createConcurrencyGuard(1, 'A market poll is already running.');

const INTERVALS = ['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h', '1day', '1week', '1month'];

/** Traded ETFs used as market proxies (Twelve Data free tier does not include raw indices). */
const MARKET_PROXIES = [
  { symbol: 'SPY', label: 'S&P 500', kind: 'ETF proxy' },
  { symbol: 'QQQ', label: 'Nasdaq 100', kind: 'ETF proxy' },
  { symbol: 'DIA', label: 'Dow Jones', kind: 'ETF proxy' },
  { symbol: 'IWM', label: 'Russell 2000', kind: 'ETF proxy' },
];

const quoteCache = new Map();
const candleCache = new Map();
const searchCache = new Map();
const cacheGet = (map, key, ttl) => {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.data : null;
};
const cacheSet = (map, key, data) => map.set(key, { at: Date.now(), data });

function providerContext() {
  const settings = getSettings();
  const provider = resolveMarketProvider(settings);
  const synthetic = provider.id === 'fixture';
  return { settings, provider, synthetic, apiKey: synthetic ? null : getTwelveDataKey() };
}

function budget(cost) {
  const s = getSettings();
  return withinLimits(
    'twelvedata',
    cost,
    { perMinute: s.budget.twelvedataPerMinute, perDay: s.budget.twelvedataPerDay },
    new Date(),
  );
}
const noteUsage = (credits) => {
  if (credits > 0) recordUsage({ provider: 'twelvedata', credits, requests: 1, ts: new Date() });
};

/* ---------------- existing radar + manual poll ---------------- */

router.get('/radar', (_req, res) => {
  res.json(buildRadar());
});

router.post(
  '/poll',
  pollGuard,
  asyncHandler(async (req, res) => {
    const force = req.body?.force === undefined ? true : asBool(req.body.force, { field: 'force' });
    const result = await triggerMarketPoll({ force });
    res.json({ result, radar: buildRadar() });
  }),
);

/* ---------------- market overview (proxies) ---------------- */

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const { provider, synthetic, apiKey } = providerContext();
    const cached = cacheGet(quoteCache, 'overview', 60_000);
    if (cached) return res.json({ ...cached, cached: true });

    const symbols = MARKET_PROXIES.map((p) => p.symbol);
    if (!synthetic) {
      const chk = budget(symbols.length);
      if (!chk.ok) {
        return res.status(429).json({ error: 'Market-data budget reached for now.', reason: chk.reason });
      }
    }
    const out = await provider.fetchQuotes(symbols, { apiKey });
    noteUsage(out.creditsUsed || 0);
    const payload = {
      proxies: MARKET_PROXIES,
      quotes: (out.quotes || []).map((q) => ({ ...q, label: MARKET_PROXIES.find((p) => p.symbol === q.symbol)?.label })),
      failed: out.failed || [],
      error: out.error || null,
      source: provider.id,
      synthetic,
      fetchedAt: new Date().toISOString(),
    };
    if (!out.error) cacheSet(quoteCache, 'overview', payload);
    res.json(payload);
  }),
);

/* ---------------- batch quotes (bounded) ---------------- */

router.get(
  '/quotes',
  asyncHandler(async (req, res) => {
    const symbols = String(req.query.symbols || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25)
      .map((s) => asSymbol(s, { field: 'symbols' }));
    if (!symbols.length) return res.json({ quotes: [], source: null, synthetic: false });

    const { provider, synthetic, apiKey } = providerContext();
    const key = `qs:${symbols.join(',')}`;
    const cached = cacheGet(quoteCache, key, 30_000);
    if (cached) return res.json({ ...cached, cached: true });

    // Stay within the provider's per-minute credit cap: fetch what still fits and mark
    // the rest as truncated rather than failing the whole request.
    const s = getSettings();
    const perMinute = s.budget.twelvedataPerMinute;
    const usedThisMinute = withinLimits(
      'twelvedata', 0, { perMinute, perDay: s.budget.twelvedataPerDay }, new Date(),
    ).minute.credits;
    const requested = symbols.length;
    const fits = synthetic ? requested : Math.max(0, perMinute - usedThisMinute);
    if (!synthetic && fits <= 0) {
      return res.status(429).json({ error: 'Market-data budget reached for this minute. Try again shortly.' });
    }
    const list = symbols.slice(0, synthetic ? requested : Math.min(requested, fits));

    if (!synthetic) {
      const chk = budget(list.length);
      if (!chk.ok) return res.status(429).json({ error: 'Market-data budget reached for now.', reason: chk.reason });
    }
    const out = await provider.fetchQuotes(list, { apiKey });
    noteUsage(out.creditsUsed || 0);
    const payload = {
      quotes: out.quotes || [],
      failed: out.failed || [],
      error: out.error || null,
      source: provider.id,
      synthetic,
      requested,
      truncated: list.length < requested,
      fetchedAt: new Date().toISOString(),
    };
    if (!out.error) cacheSet(quoteCache, key, payload);
    res.json(payload);
  }),
);

/* ---------------- single quote ---------------- */

router.get(
  '/quote/:symbol',
  asyncHandler(async (req, res) => {
    const symbol = asSymbol(req.params.symbol, { field: 'symbol' });
    const { provider, synthetic, apiKey } = providerContext();
    const key = `q:${symbol}`;
    const cached = cacheGet(quoteCache, key, 30_000);
    if (cached) return res.json({ ...cached, cached: true });

    if (!synthetic) {
      const chk = budget(1);
      if (!chk.ok) return res.status(429).json({ error: 'Market-data budget reached for now.', reason: chk.reason });
    }
    const out = await provider.fetchQuotes([symbol], { apiKey });
    noteUsage(out.creditsUsed || 0);
    const quote = (out.quotes || [])[0] || null;
    const payload = {
      quote,
      error: out.error || (quote ? null : 'No quote available for this symbol.'),
      source: provider.id,
      synthetic,
      fetchedAt: new Date().toISOString(),
    };
    if (quote) cacheSet(quoteCache, key, payload);
    res.json(payload);
  }),
);

/* ---------------- OHLC candles ---------------- */

router.get(
  '/candles/:symbol',
  asyncHandler(async (req, res) => {
    const symbol = asSymbol(req.params.symbol, { field: 'symbol' });
    const interval = req.query.interval === undefined ? '1day' : asEnum(req.query.interval, INTERVALS, { field: 'interval' });
    const outputsize = req.query.outputsize === undefined ? 180 : asInt(req.query.outputsize, { field: 'outputsize', min: 5, max: 1000 });

    const { provider, synthetic, apiKey } = providerContext();
    const key = `c:${symbol}:${interval}:${outputsize}`;
    const cached = cacheGet(candleCache, key, 5 * 60_000);
    if (cached) return res.json({ ...cached, cached: true });

    if (typeof provider.fetchCandles !== 'function') {
      return res.status(503).json({ error: 'Candle data is not supported by the configured provider.' });
    }
    if (!synthetic) {
      const chk = budget(1);
      if (!chk.ok) return res.status(429).json({ error: 'Market-data budget reached for now.', reason: chk.reason });
    }
    const out = await provider.fetchCandles(symbol, { interval, outputsize, apiKey });
    noteUsage(out.creditsUsed || 0);
    const payload = {
      bars: out.bars || [],
      meta: out.meta || null,
      error: out.error || null,
      source: provider.id,
      synthetic: Boolean(out.synthetic || synthetic),
      fetchedAt: new Date().toISOString(),
    };
    if (payload.bars.length) cacheSet(candleCache, key, payload);
    res.json(payload);
  }),
);

/* ---------------- symbol search ---------------- */

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = req.query.q === undefined ? '' : asString(String(req.query.q), { field: 'q', min: 1, max: 64 });
    if (!q) return res.json({ results: [], source: null, synthetic: false });

    const { provider, synthetic, apiKey } = providerContext();
    const key = `s:${q.toLowerCase()}`;
    const cached = cacheGet(searchCache, key, 10 * 60_000);
    if (cached) return res.json({ ...cached, cached: true });
    if (typeof provider.searchSymbols !== 'function') {
      return res.json({ results: [], error: 'Symbol search is not supported by the configured provider.', source: provider.id, synthetic });
    }
    if (!synthetic) {
      const chk = budget(1);
      if (!chk.ok) return res.status(429).json({ error: 'Market-data budget reached for now.', reason: chk.reason });
    }
    const out = await provider.searchSymbols(q, { apiKey });
    noteUsage(out.creditsUsed || 0);
    const payload = {
      results: out.results || [],
      error: out.error || null,
      source: provider.id,
      synthetic: Boolean(out.synthetic || synthetic),
      fetchedAt: new Date().toISOString(),
    };
    cacheSet(searchCache, key, payload);
    res.json(payload);
  }),
);

/* ---------------- related news for a symbol (from the ingest store) ---------------- */

router.get('/news/:symbol', (req, res) => {
  const symbol = asSymbol(req.params.symbol, { field: 'symbol' });
  const limit = req.query.limit === undefined ? 20 : asInt(req.query.limit, { field: 'limit', min: 1, max: 50 });
  const articles = listArticlesBySymbol(symbol, { limit });
  res.json({
    symbol,
    articles: articles.map((a) => ({
      headline: a.headline,
      excerpt: a.snippet,
      source: a.source,
      domain: a.sourceDomain,
      url: a.url,
      publishedTs: a.publishedTs,
      firstSeenTs: a.firstSeenTs,
    })),
  });
});

export default router;
