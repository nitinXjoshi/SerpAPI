import { Router } from 'express';
import { getSettings } from '../db.js';
import { config } from '../config.js';
import { listEvents, getEventArticles } from '../events/store.js';
import { latestObservations } from '../market/store.js';
import { analyzeWatchlist } from '../market/analyze.js';
import { listWatchlist } from '../watchlist.js';
import { lastCycle, recentCycles } from '../cycles.js';
import { schedulerState } from '../scheduler.js';
import { ollamaStatus } from '../ollama/client.js';
import { resolveNewsProvider } from '../providers/news/index.js';
import { asInt } from '../security/validate.js';
import { asyncHandler } from '../security/errors.js';

const router = Router();

const ATTENTION = new Set(['potential_opportunity', 'watch']);

function modelFor(event) {
  const m = event.model;
  if (!m) return null;
  return {
    sample: Boolean(m.sample),
    category: m.category || null,
    summary: m.summary || null,
    keyClaims: (m.key_claims || []).map((c) => ({ claim: c.claim, attribution: c.attribution || null, sourceUrl: c.source_url || null })),
    contradictions: m.contradictions || [],
    uncertainty: m.uncertainty_notes || [],
    impact: m.impact && typeof m.impact === 'object'
      ? { direction: m.impact.direction || null, magnitude: m.impact.magnitude || null, rationale: m.impact.rationale || null }
      : (typeof m.impact === 'string' ? { direction: null, magnitude: null, rationale: m.impact } : null),
    entities: (m.entities || []).map((x) => ({ symbol: x.symbol, name: x.name || null })),
    novelty: m.novelty || null,
    // The model's self-reported confidence is often 0 — the deterministic event-level
    // confidence is the meaningful signal, so only surface a positive model value here.
    modelConfidence: typeof m.confidence === 'number' && m.confidence > 0 ? m.confidence : null,
    followUp: m.follow_up_queries || [],
  };
}

/** Computed technical context for an event's primary symbol (never model-generated). */
function technicalFor(symbols, rowsBySymbol) {
  for (const s of symbols || []) {
    const r = rowsBySymbol[s];
    if (r && r.hasData) {
      return {
        symbol: r.symbol,
        price: r.price,
        changePct: r.changePct,
        divergence: r.divergence,
        benchmarkSymbol: r.benchmarkSymbol,
        benchmarkChangePct: r.benchmarkChangePct,
        peerDivergence: r.peerDivergence,
        marketTs: r.marketTs,
        stale: r.stale,
        source: r.source,
      };
    }
  }
  return null;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit === undefined ? 20 : asInt(req.query.limit, { field: 'limit', min: 1, max: 100 });
    const hours = req.query.hours === undefined ? 72 : asInt(req.query.hours, { field: 'hours', min: 1, max: 720 });
    const settings = getSettings();
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const watchlist = listWatchlist();
    const symbols = new Set();
    for (const w of watchlist) {
      symbols.add(w.symbol);
      if (w.benchmarkSymbol) symbols.add(String(w.benchmarkSymbol).toUpperCase());
      for (const p of w.peers || []) symbols.add(String(p).toUpperCase());
    }
    const rows = analyzeWatchlist({ watchlist, latestBySymbol: latestObservations([...symbols]), thresholds: settings.scoring });
    const rowsBySymbol = Object.fromEntries(rows.map((r) => [r.symbol, r]));

    const events = listEvents({ limit: 500 });
    const recent = events.filter((e) => e.lastUpdatedTs >= since);
    const pool = recent.length ? recent : events;

    const opportunities = pool.slice(0, limit).map((e) => {
      const articles = getEventArticles(e.id);
      const domains = new Set(articles.map((a) => a.sourceDomain).filter(Boolean));
      const contentHashes = new Set(articles.map((a) => a.contentHash).filter(Boolean));
      return {
        id: e.id,
        title: e.title,
        symbols: e.symbols || [],
        category: e.category || 'uncategorised',
        status: e.decision || 'pending',
        score: e.score,
        confidence: e.confidence,
        firstSeenTs: e.firstSeenTs,
        lastUpdatedTs: e.lastUpdatedTs,
        evidence: {
          articleCount: articles.length,
          independentReports: contentHashes.size,
          independentSources: domains.size,
          syndicated: Math.max(0, articles.length - contentHashes.size),
          sources: [...domains].slice(0, 8),
        },
        analysis: modelFor(e),
        technical: technicalFor(e.symbols || [], rowsBySymbol),
      };
    });

    // Rank: analysed events first, then recency.
    opportunities.sort((a, b) => {
      const ax = a.analysis ? 1 : 0;
      const bx = b.analysis ? 1 : 0;
      if (ax !== bx) return bx - ax;
      return Date.parse(b.lastUpdatedTs) - Date.parse(a.lastUpdatedTs);
    });

    const cycle = lastCycle('news');
    const sched = schedulerState();
    const ollamaStat = config.demoMode ? { available: false, configuredModel: null, models: [] } : await ollamaStatus();
    const intervalMs = Math.max(1, settings.monitoring.newsIntervalMinutes) * 60_000;
    const lastFinished = cycle?.finishedAt || cycle?.startedAt || null;
    const nextScanAt = settings.monitoring.enabled && lastFinished
      ? new Date(Date.parse(lastFinished) + intervalMs).toISOString()
      : null;

    const analysed = events.filter((e) => e.model).length;
    const needsAttention = events.filter((e) => ATTENTION.has(e.decision)).length;

    res.json({
      status: {
        monitoring: settings.monitoring.enabled,
        intervalMinutes: settings.monitoring.newsIntervalMinutes,
        lastScan: cycle
          ? {
              startedAt: cycle.startedAt,
              finishedAt: cycle.finishedAt,
              status: cycle.status,
              queriesUsed: cycle.queriesUsed,
              articlesNew: cycle.articlesNew,
              articlesSeen: cycle.articlesSeen ?? null,
              duplicatesRemoved: cycle.articlesDuplicate ?? null,
              eventsNew: cycle.eventsNew,
              errors: (cycle.errors || []).length,
            }
          : null,
        nextScanAt,
        schedulerLockHeld: Boolean(sched.lockHeld),
        newsProvider: (() => {
          const p = resolveNewsProvider(settings);
          return { id: p.id, configured: p.id !== 'fixture' };
        })(),
        ollama: (() => {
          const st = ollamaStat;
          return {
            available: Boolean(st.available),
            model: st.configuredModel || (st.models && st.models[0]) || null,
            contacted: !config.demoMode,
          };
        })(),
        counts: {
          newArticles: cycle?.articlesNew ?? 0,
          duplicatesRemoved: cycle?.articlesDuplicate ?? null,
          clustersAnalyzed: analysed,
          totalEvents: events.length,
          needsAttention,
        },
        coverage: {
          watchlistEnabled: watchlist.filter((w) => w.enabled).length,
          trackedUniverse: rows.length,
          recentCycles: recentCycles(5).map((c) => ({ at: c.finishedAt || c.startedAt, status: c.status })),
        },
      },
      opportunities,
    });
  }),
);

export default router;
