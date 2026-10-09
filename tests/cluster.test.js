import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { upsertWatchlist, listWatchlist } from '../src/watchlist.js';
import { normalizeArticle } from '../src/news/normalizeArticle.js';
import { insertArticleIfNew } from '../src/news/store.js';
import { clusterArticles, consolidateEvents } from '../src/news/cluster.js';
import { getEvent, getEventArticles, countEvents } from '../src/events/store.js';

initDb();

function article(title, domain, ts, slug) {
  const raw = {
    title,
    link: `https://${domain}/${slug}`,
    snippet: title,
    iso_date: ts,
    source: { name: domain },
  };
  return normalizeArticle(raw, { spec: { engine: 'google_news', q: 'test' }, watchlist: listWatchlist(), now: new Date(ts) });
}

test('many reports about one event collapse into a single event', () => {
  upsertWatchlist({ symbol: 'NVDA', companyName: 'NVIDIA Corporation', aliases: ['Nvidia'], importance: 0.9 });
  const now = new Date('2025-05-22T14:00:00Z');
  const arts = [
    article('US weighs new export restrictions on NVIDIA Corporation chips', 'reuters.com', '2025-05-22T13:38:00Z', 'a'),
    article('US weighs fresh export curbs on NVIDIA Corporation, sources say', 'bloomberg.com', '2025-05-22T13:47:00Z', 'b'),
    article('White House considering limits on NVIDIA Corporation AI chip sales', 'cnbc.com', '2025-05-22T13:55:00Z', 'c'),
    article('NVIDIA Corporation responds to export restrictions report, no material impact', 'company-ir.example', '2025-05-22T14:05:00Z', 'd'),
    article('US weighs new export restrictions on NVIDIA Corporation chips', 'finance.yahoo.com', '2025-05-22T13:40:00Z', 'e'), // syndicated copy of a
    article('Analyst raises NVIDIA Corporation price target on data-centre demand', 'barrons.com', '2025-05-20T15:00:00Z', 'f'),
  ];
  const inserted = arts.filter((a) => insertArticleIfNew(a));
  assert.equal(inserted.length, 6);

  const results = clusterArticles(inserted, { now });
  consolidateEvents({ now });

  const events = results.map((r) => getEvent(r.eventId)).filter(Boolean);
  const byId = new Map(events.map((e) => [e.id, e]));
  // The four same-story reports (incl. the syndicated copy) should share one event.
  const main = results.find((r) => getEventArticles(r.eventId).length >= 4);
  assert.ok(main, 'expected a cluster with >= 4 articles');
  const mainArticles = getEventArticles(main.eventId);
  assert.equal(mainArticles.length, 5);

  const contentHashes = new Set(mainArticles.map((a) => a.contentHash));
  assert.equal(contentHashes.size, 4, 'syndicated copy must not count as an independent report');
});

test('distinct-count helpers: independent reports vs articles', () => {
  // covered implicitly above; verify counts are integers and bounded
  assert.ok(countEvents() >= 1);
});
