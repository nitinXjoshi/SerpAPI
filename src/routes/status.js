import { Router } from 'express';
import { config } from '../config.js';
import { getSettings, getDb } from '../db.js';
import { listSecretMeta } from '../secrets.js';
import { listWatchlist, getSymbolSet } from '../watchlist.js';
import { usageOn } from '../quota/usageStore.js';
import { newsBudgetPlan, marketBudgetEstimate } from '../quota/planner.js';
import { schedulerState } from '../scheduler.js';
import { ollamaStatus } from '../ollama/client.js';
import { buildRadar } from '../market/radar.js';
import { resolveSerpApiKey, fetchSerpApiAccount } from '../serpapi.js';

const router = Router();

router.get('/', async (_req, res) => {
  const settings = getSettings();
  const db = getDb();
  const demo = config.demoMode;

  const lastObs = db
    .prepare('SELECT MAX(retrieved_ts) AS rts, MAX(market_ts) AS mts FROM observations')
    .get();
  const lastCycle = db.prepare('SELECT * FROM cycles ORDER BY id DESC LIMIT 1').get();
  const articleCount = Number(db.prepare('SELECT COUNT(*) AS c FROM articles').get().c);
  const eventCount = Number(db.prepare('SELECT COUNT(*) AS c FROM events').get().c);
  const uninvestigated = Number(
    db.prepare('SELECT COUNT(*) FROM events WHERE model_json IS NULL').get().c,
  );

  const symbolCount = getSymbolSet().length;

  // Demo mode must make zero outbound calls: never contact SerpApi or Ollama.
  const account = !demo && resolveSerpApiKey() ? await fetchSerpApiAccount(resolveSerpApiKey()) : null;
  const ollama = demo
    ? { available: false, demo: true, reason: 'Ollama is not contacted in demo mode.', models: [] }
    : await ollamaStatus();

  let radarCoverage = null;
  try {
    radarCoverage = buildRadar().coverage;
  } catch {
    /* ignore */
  }

  res.json({
    ok: true,
    now: new Date().toISOString(),
    demoMode: demo,
    readOnly: demo,
    authMode: demo ? 'demo' : 'required',
    node: process.version,
    ollama,
    providers: {
      market: demo ? 'fixture' : settings.providers.market,
      news: demo ? 'fixture' : settings.providers.news,
    },
    // Demo runs on an ephemeral DB, so this never exposes the operator's real keys.
    secrets: listSecretMeta().map((s) => ({
      name: s.name,
      configured: Boolean(s.configured),
      status: s.status || 'unconfigured',
      lastValidatedAt: s.lastValidatedAt || null,
      masked: s.masked || null,
    })),
    watchlistSize: listWatchlist().filter((w) => w.enabled).length,
    symbolSetSize: symbolCount,
    monitoring: demo ? { ...settings.monitoring, enabled: false } : settings.monitoring,
    scheduler: demo
      ? { lockHeld: false, monitoringEnabled: false, demo: true }
      : schedulerState(),
    usage: {
      twelvedataToday: usageOn('twelvedata'),
      serpapiToday: usageOn('serpapi'),
    },
    budget: {
      news: newsBudgetPlan({ settings, account }),
      market: marketBudgetEstimate({ settings, symbolCount }),
    },
    account: account
      ? {
          searchesPerMonth: account.searches_per_month,
          searchesLeft: account.plan_searches_left,
          thisMonthUsage: account.this_month_usage,
          rateLimitPerHour: account.account_rate_limit_per_hour,
        }
      : null,
    lastMarketUpdate: lastObs?.rts || null,
    lastMarketTimestamp: lastObs?.mts || null,
    lastCycle: lastCycle
      ? {
          kind: lastCycle.kind,
          startedAt: lastCycle.started_ts,
          finishedAt: lastCycle.finished_ts,
          status: lastCycle.status,
          queriesUsed: lastCycle.queries_used,
          articlesNew: lastCycle.articles_new,
          eventsNew: lastCycle.events_new,
        }
      : null,
    counts: { articles: articleCount, events: eventCount, uninvestigated },
    coverage: radarCoverage,
  });
});

export default router;
