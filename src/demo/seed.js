import { saveSettings, getSettings } from '../db.js';
import { listWatchlist, defaultWatchlist, upsertWatchlist } from '../watchlist.js';
import { pollMarket } from '../market/poller.js';
import { runNewsCycle } from '../news/ingest.js';
import { listEvents, getEventArticles, setEventModel } from '../events/store.js';
import { scoreEventById } from '../scoring/opportunity.js';
import { buildSampleModel } from './fixtures.js';
import { logger } from '../logger.js';

/**
 * Populate an ephemeral demo database deterministically.
 *
 * Runs the REAL pipeline against the fixture providers, so the demo exercises the same
 * normalization / clustering / scoring code as live mode. Fixture providers make zero
 * outbound requests, and investigations are authored samples (no Ollama call).
 */
export async function seedDemoData({ now = new Date() } = {}) {
  // Deterministic, offline, read-only-ish settings for the demo session.
  saveSettings({
    monitoring: { enabled: false, autoInvestigate: false, marketHoursOnly: false, newsIntervalMinutes: 10 },
    providers: { market: 'fixture', news: 'fixture' },
  });

  if (listWatchlist().length === 0) {
    for (const e of defaultWatchlist()) upsertWatchlist(e);
  }

  // 1) Market observations (fixture provider → 0 credits).
  const market = await pollMarket({ force: true, now });

  // 2) News discovery + clustering + scoring (fixture provider → 0 credits, no Ollama).
  const news = await runNewsCycle({ force: true, now });

  // 3) Attach authored sample investigations to the strongest multi-article events.
  const events = listEvents({ limit: 30 });
  const covered = new Set();
  let investigated = 0;
  for (const ev of events) {
    const symbols = ev.symbols || [];
    if (!symbols.length) continue;
    if (symbols.some((s) => covered.has(s))) continue;
    const articles = getEventArticles(ev.id);
    if (articles.length < 4) continue; // only investigate substantive, corroborated events

    const model = buildSampleModel(ev, articles);
    setEventModel(ev.id, {
      summary: model.summary,
      model,
      uncertain: model.uncertainty_notes,
      confidence: model.confidence,
      category: model.category,
    });
    scoreEventById(ev.id, { now });
    symbols.forEach((s) => covered.add(s));
    investigated += 1;
  }

  const summary = {
    marketQuotes: market.quotes?.length || 0,
    marketProvider: market.provider,
    newsArticles: news.summary?.articlesNew ?? 0,
    events: events.length,
    investigated,
  };
  logger.info('demo.seeded', summary);
  return summary;
}

/** Reset is unnecessary: demo always runs on an ephemeral in-memory database. */
export function demoConfigured() {
  return getSettings().providers.market === 'fixture';
}
