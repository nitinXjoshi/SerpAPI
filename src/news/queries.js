/**
 * Builds a prioritized list of SerpApi news queries for a cycle.
 * No unsupported batching is invented: each spec is one documented engine call.
 */

function whenFilter(backfillHours) {
  if (!backfillHours || backfillHours <= 0) return '';
  if (backfillHours <= 1) return ' when:1h';
  if (backfillHours <= 24) return ' when:1d';
  if (backfillHours <= 168) return ' when:7d';
  return '';
}

export function buildQueryPlan({ watchlist = [], settings, now = new Date() } = {}) {
  const enabled = watchlist.filter((w) => w.enabled !== false);
  const when = whenFilter(settings?.monitoring?.backfillHours ?? 0);
  const specs = [];
  const seen = new Set();

  const push = (spec) => {
    if (seen.has(spec.id)) return;
    seen.add(spec.id);
    specs.push({ gl: 'us', hl: 'en', so: '1', ...spec });
  };

  if (settings?.news?.companyQueries !== false) {
    for (const w of enabled) {
      if (w.sector === 'Benchmark') continue; // benchmarks are covered by sector/market queries
      const name = w.companyName || w.symbol;
      push({
        id: `company:${w.symbol}`,
        engine: 'google_news',
        q: `${name} stock${when}`,
        priority: 1 + (Number(w.importance) || 0.5),
        tags: ['company', w.symbol],
        symbols: [w.symbol],
      });
    }
  }

  if (settings?.news?.sectorQueries) {
    const sectors = [...new Set(enabled.map((w) => w.sector).filter((s) => s && s !== 'Benchmark'))];
    for (const sector of sectors) {
      push({
        id: `sector:${sector}`,
        engine: 'google_news',
        q: `${sector} sector stocks${when}`,
        priority: 0.6,
        tags: ['sector', sector],
        symbols: enabled.filter((w) => w.sector === sector).map((w) => w.symbol),
      });
    }
  }

  if (settings?.news?.marketQuery) {
    push({
      id: 'market:overview',
      engine: 'google_news',
      q: `stock market today${when}`,
      priority: 0.4,
      tags: ['market'],
      symbols: [],
    });
  }

  if (settings?.news?.categoryQueries) {
    for (const w of enabled) {
      for (const category of settings.news.categories || []) {
        push({
          id: `category:${w.symbol}:${category}`,
          engine: 'google_news',
          q: `${w.companyName || w.symbol} ${category}${when}`,
          priority: 0.3,
          tags: ['category', category, w.symbol],
          symbols: [w.symbol],
        });
      }
    }
  }

  specs.sort((a, b) => b.priority - a.priority);
  return specs;
}

/** Select the top `allowed` queries by priority; the remainder is deferred. */
export function selectQueries(specs, allowed) {
  return {
    selected: specs.slice(0, Math.max(0, allowed)),
    deferred: specs.slice(Math.max(0, allowed)),
  };
}
