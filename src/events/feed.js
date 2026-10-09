import { listEvents, getEvent, getEventArticles, eventArticlesByEventIds } from './store.js';
import { latestObservations, observationsBetween } from '../market/store.js';

export function buildEventFeed({ limit = 50, status = null } = {}) {
  const events = listEvents({ limit, status });
  const ids = events.map((e) => e.id);
  const articlesByEvent = eventArticlesByEventIds(ids);
  const symbols = [...new Set(events.flatMap((e) => e.symbols || []))];
  const latest = latestObservations(symbols);

  return events.map((e) => {
    const rows = articlesByEvent.get(e.id) || [];
    const domains = new Set(rows.map((r) => r.source_domain).filter(Boolean));
    const contentGroups = new Set(rows.map((r) => r.content_hash).filter(Boolean));
    const reactions = (e.symbols || []).map((s) => {
      const o = latest[s];
      return {
        symbol: s,
        price: o?.price ?? null,
        changePct: o?.changePct ?? null,
        marketTs: o?.marketTs ?? null,
        stale: o ? Boolean(o.stale) : true,
      };
    });
    return {
      id: e.id,
      title: e.title,
      category: e.category,
      decision: e.decision,
      score: e.score,
      confidence: e.confidence,
      firstSeenTs: e.firstSeenTs,
      lastUpdatedTs: e.lastUpdatedTs,
      status: e.status,
      symbols: e.symbols || [],
      summary: e.summary,
      uncertain: e.uncertain || [],
      evidence: {
        articleCount: rows.length,
        independentReports: contentGroups.size,
        independentSources: domains.size,
        syndicated: Math.max(0, rows.length - contentGroups.size),
        sources: [...domains].slice(0, 8),
      },
      reactions,
      scoreBreakdown: e.evidence?.components || null,
    };
  });
}

export function buildEventDetail(id) {
  const event = getEvent(id);
  if (!event) return null;

  const articles = getEventArticles(id);
  const domains = new Set(articles.map((a) => a.sourceDomain).filter(Boolean));
  const contentGroups = new Set(articles.map((a) => a.contentHash).filter(Boolean));
  const symbols = event.symbols || [];
  const latest = latestObservations(symbols);
  const detected = Date.parse(event.firstSeenTs);

  const context = symbols.map((s) => {
    const o = latest[s] || null;
    const before = observationsBetween(s, new Date(detected - 6 * 3600000).toISOString(), event.firstSeenTs);
    const after = observationsBetween(s, event.firstSeenTs, new Date(detected + 6 * 3600000).toISOString());
    return {
      symbol: s,
      current: o
        ? { price: o.price, changePct: o.changePct, marketTs: o.marketTs, stale: o.stale, source: o.source }
        : null,
      before: before.length ? { ts: before[0].marketTs, price: before[0].price } : null,
      after: after.length ? { ts: after[after.length - 1].marketTs, price: after[after.length - 1].price } : null,
    };
  });

  return {
    event,
    articles,
    evidence: {
      articleCount: articles.length,
      independentReports: contentGroups.size,
      independentSources: domains.size,
      syndicated: Math.max(0, articles.length - contentGroups.size),
      sources: [...domains],
    },
    context,
    timeline: buildTimeline(event, articles, context),
  };
}

/** Deterministic causal-ish timeline (event → coverage → observed move). */
function buildTimeline(event, articles, context) {
  const items = [];
  items.push({ ts: event.firstSeenTs, kind: 'detected', label: 'Event first detected by the monitor' });

  const published = articles
    .filter((a) => a.publishedTs)
    .sort((a, b) => Date.parse(a.publishedTs) - Date.parse(b.publishedTs));
  if (published.length) {
    items.push({
      ts: published[0].publishedTs,
      kind: 'first_report',
      label: `First report: ${published[0].source || published[0].sourceDomain}`,
      url: published[0].url,
    });
  }
  for (const a of published.slice(1, 6)) {
    items.push({
      ts: a.publishedTs,
      kind: 'coverage',
      label: `Coverage: ${a.source || a.sourceDomain}`,
      url: a.url,
    });
  }
  for (const c of context) {
    const after = c.after || c.current;
    if (after?.ts || after?.marketTs) {
      items.push({
        ts: after.ts || after.marketTs,
        kind: 'price',
        label: `${c.symbol} observed at ${after.price}`,
      });
    }
  }

  return items
    .filter((i) => i.ts)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}
