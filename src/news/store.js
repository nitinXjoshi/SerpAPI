import { getDb } from '../db.js';

export function insertArticleIfNew(art) {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO articles
        (url_hash, url, headline, snippet, source, source_domain, published_ts, first_seen_ts, retrieved_ts, content_hash, engine, query, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      art.urlHash,
      art.url,
      art.headline,
      art.snippet,
      art.source,
      art.sourceDomain,
      art.publishedTs,
      art.firstSeenTs,
      art.retrievedTs,
      art.contentHash,
      art.engine,
      art.query,
      JSON.stringify(art.raw ?? {}),
    );
  const inserted = Number(res.changes) > 0;
  if (inserted) {
    for (const sym of art.symbols || []) {
      db.prepare('INSERT OR IGNORE INTO article_entities (url_hash, symbol) VALUES (?, ?)').run(
        art.urlHash,
        sym,
      );
    }
  }
  return inserted;
}

function rowToArticle(r) {
  if (!r) return null;
  return {
    urlHash: r.url_hash,
    url: r.url,
    headline: r.headline,
    snippet: r.snippet,
    source: r.source,
    sourceDomain: r.source_domain,
    publishedTs: r.published_ts,
    firstSeenTs: r.first_seen_ts,
    retrievedTs: r.retrieved_ts,
    contentHash: r.content_hash,
    engine: r.engine,
    query: r.query,
  };
}

export function getArticle(urlHash) {
  return rowToArticle(getDb().prepare('SELECT * FROM articles WHERE url_hash = ?').get(urlHash));
}

export function listArticles({ limit = 100, since = null } = {}) {
  const rows = since
    ? getDb()
        .prepare('SELECT * FROM articles WHERE first_seen_ts >= ? ORDER BY first_seen_ts DESC LIMIT ?')
        .all(since, limit)
    : getDb().prepare('SELECT * FROM articles ORDER BY first_seen_ts DESC LIMIT ?').all(limit);
  return rows.map(rowToArticle);
}

export function listArticlesBySymbol(symbol, { limit = 100 } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT a.* FROM articles a JOIN article_entities e ON e.url_hash = a.url_hash
       WHERE e.symbol = ? ORDER BY a.first_seen_ts DESC LIMIT ?`,
    )
    .all(String(symbol).toUpperCase(), limit);
  return rows.map(rowToArticle);
}

export function countArticles() {
  return Number(getDb().prepare('SELECT COUNT(*) AS c FROM articles').get().c);
}

export function pruneArticles(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  getDb().prepare('DELETE FROM articles WHERE first_seen_ts < ?').run(cutoff);
}
