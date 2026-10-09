import { getSettings } from '../db.js';
import { listWatchlist } from '../watchlist.js';
import { latestObservations } from './store.js';
import { analyzeWatchlist } from './analyze.js';
import { marketStatus } from './poller.js';
import { usageOn } from '../quota/usageStore.js';
import { resolveMarketProvider } from '../providers/market/index.js';
import { getDb } from '../db.js';

export function buildRadar() {
  const settings = getSettings();
  const watchlist = listWatchlist();

  const symbols = new Set();
  for (const w of watchlist) {
    symbols.add(w.symbol);
    if (w.benchmarkSymbol) symbols.add(String(w.benchmarkSymbol).toUpperCase());
    for (const p of w.peers || []) symbols.add(String(p).toUpperCase());
  }

  const latest = latestObservations([...symbols]);
  const rows = analyzeWatchlist({ watchlist, latestBySymbol: latest, thresholds: settings.scoring });
  const provider = resolveMarketProvider(settings);
  const usage = usageOn('twelvedata');

  const lastRow = getDb()
    .prepare('SELECT MAX(retrieved_ts) AS rts, MAX(market_ts) AS mts FROM observations')
    .get();

  return {
    rows,
    provider: {
      id: provider.id,
      label: provider.label || provider.id,
      mode: settings.providers.market,
      isFallback: provider.id === 'fixture',
    },
    marketStatus: marketStatus(),
    usage: {
      twelvedata: {
        creditsToday: usage.credits,
        requestsToday: usage.requests,
        perDay: settings.budget.twelvedataPerDay,
        perMinute: settings.budget.twelvedataPerMinute,
      },
    },
    lastMarketUpdate: lastRow?.rts || null,
    lastMarketTimestamp: lastRow?.mts || null,
    monitoring: settings.monitoring,
    coverage: {
      watchlistEnabled: watchlist.filter((w) => w.enabled).length,
      withData: rows.filter((r) => r.hasData).length,
    },
  };
}
