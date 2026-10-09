import { getSettings, getSetting } from '../db.js';
import { listWatchlist } from '../watchlist.js';
import { resolveNewsProvider } from '../providers/news/index.js';
import { resolveSerpApiKey, fetchSerpApiAccount } from '../serpapi.js';
import { newsBudgetPlan, commitNewsBudget } from '../quota/planner.js';
import { buildQueryPlan, selectQueries } from './queries.js';
import { normalizeArticle, flattenNewsItems } from './normalizeArticle.js';
import { insertArticleIfNew } from './store.js';
import { startCycle, finishCycle } from '../cycles.js';
import { recordUsage } from '../quota/usageStore.js';
import { clusterArticles, consolidateEvents } from './cluster.js';
import * as EventStore from '../events/store.js';
import { scoreEventById } from '../scoring/opportunity.js';
import { investigatePendingEvents } from '../ollama/investigate.js';
import { logger } from '../logger.js';

/**
 * One news-discovery cycle:
 *   plan queries within budget → retrieve → dedup by URL → store articles.
 * Event clustering / Ollama / scoring are applied by the caller (event pipeline).
 */
export async function runNewsCycle({ force = false, now = new Date() } = {}) {
  const settings = getSettings();
  const watchlist = listWatchlist();
  const provider = resolveNewsProvider(settings);
  const apiKey = provider.id === 'serpapi' ? resolveSerpApiKey() : null;
  const account = provider.id === 'serpapi' ? await fetchSerpApiAccount(apiKey) : null;

  const plan = newsBudgetPlan({ settings, account, now });
  const specs = buildQueryPlan({ watchlist, settings, now });

  const allowed = force ? Math.min(specs.length, settings.news.maxQueriesPerCycle) : plan.allowed;
  const { selected, deferred } = selectQueries(specs, allowed);

  const cycleId = startCycle({
    kind: 'news',
    startedTs: now.toISOString(),
    queriesPlanned: selected.length,
  });

  const errors = [];
  let queriesUsed = 0;
  let creditsUsed = 0;
  const insertedArticles = [];
  const nameBySymbol = Object.fromEntries(watchlist.map((w) => [w.symbol, w.companyName]));

  for (const spec of selected) {
    const fullSpec = {
      ...spec,
      companyName: spec.symbols?.length ? nameBySymbol[spec.symbols[0]] : null,
    };
    let res;
    try {
      res = await provider.search(fullSpec, { apiKey, now });
    } catch (err) {
      errors.push({ query: spec.id, error: err.message });
      continue;
    }
    queriesUsed++;
    recordUsage({ provider: provider.id, credits: res.creditsUsed || 0, requests: 1, ts: now });
    if (res.creditsUsed) creditsUsed += res.creditsUsed;
    if (res.error) errors.push({ query: spec.id, error: res.error });

    for (const raw of flattenNewsItems(res.items)) {
      const art = normalizeArticle(raw, { spec, watchlist, now });
      if (!art.url) continue;
      if (insertArticleIfNew(art)) insertedArticles.push(art);
    }
  }

  // Cluster the newly stored articles into (or onto) events, then merge duplicates.
  const clustered = clusterArticles(insertedArticles, { now });
  const consolidation = consolidateEvents({ now });
  const createdIds = [...new Set(clustered.filter((c) => c.created).map((c) => c.eventId))];
  const surviving = createdIds.filter((id) => EventStore.getEvent(id));
  for (const id of surviving) EventStore.notifyOnce({ eventId: id, dedupeKey: `event:${id}:new` });
  const eventsNew = surviving.length;

  // Score every event touched by this cycle (deterministic; no LLM).
  const touched = [...new Set(clustered.filter((c) => EventStore.getEvent(c.eventId)).map((c) => c.eventId))];
  for (const id of touched) {
    try {
      scoreEventById(id, { now });
    } catch (err) {
      errors.push({ query: `score:${id}`, error: err.message });
    }
  }

  finishCycle(cycleId, {
    status: errors.length && insertedArticles.length === 0 ? 'partial' : 'ok',
    queriesUsed,
    articlesNew: insertedArticles.length,
    eventsNew,
    errors,
    finishedTs: new Date().toISOString(),
  });

  if (!force) {
    const carryAfter = plan.carry + Math.max(0, allowed - selected.length);
    commitNewsBudget({ ...plan, carry: carryAfter });
  }

  // Optional: investigate a bounded number of pending events with Ollama.
  let investigated = 0;
  if (settings.monitoring.autoInvestigate) {
    try {
      const inv = await investigatePendingEvents({ limit: settings.monitoring.maxInvestigationsPerCycle ?? 1 });
      investigated = inv.processed;
      for (const r of inv.results) if (r.ok) scoreEventById(r.eventId, { now });
    } catch (err) {
      errors.push({ query: 'investigate', error: err.message });
    }
  }

  const summary = {
    provider: provider.id,
    queriesPlanned: specs.length,
    queriesRun: selected.length,
    queriesDeferred: Math.max(0, specs.length - selected.length),
    queriesUsed,
    creditsUsed,
    articlesNew: insertedArticles.length,
    eventsNew,
    eventsMerged: consolidation.merged,
    investigated,
    errors,
    budget: {
      allowed,
      perCycle: plan.perCycle,
      daily: plan.daily,
      remaining: plan.remaining,
      carry: getSetting('runtime', {})?.newsBudgetCarry ?? null,
    },
    account: account
      ? {
          searchesPerMonth: account.searches_per_month,
          searchesLeft: account.plan_searches_left,
          thisMonthUsage: account.this_month_usage,
        }
      : null,
    coverage: {
      watchlistEnabled: watchlist.filter((w) => w.enabled).length,
      symbolsCovered: new Set(selected.flatMap((s) => s.symbols || [])).size,
    },
    startedAt: now.toISOString(),
  };

  logger.info('news.cycle.complete', {
    provider: provider.id,
    queriesRun: selected.length,
    articlesNew: insertedArticles.length,
    creditsUsed,
  });

  return { summary, articles: insertedArticles, deferred, cycleId };
}
