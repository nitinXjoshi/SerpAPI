import { getDb } from '../db.js';
import { shingles, tokenize } from '../news/dedup.js';

function parse(json, fallback) {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function rowToEvent(r) {
  if (!r) return null;
  return {
    id: r.id,
    clusterKey: r.cluster_key,
    title: r.title,
    category: r.category,
    firstSeenTs: r.first_seen_ts,
    lastUpdatedTs: r.last_updated_ts,
    status: r.status,
    decision: r.decision,
    score: r.score,
    confidence: r.confidence,
    summary: parse(r.summary_json, null),
    model: parse(r.model_json, null),
    evidence: parse(r.evidence_json, []),
    uncertain: parse(r.uncertain_json, []),
    symbols: parse(r.symbols_json, []),
    lastNotifiedTs: r.last_notified_ts,
  };
}

export function createEvent({ clusterKey, title, category = 'other', symbols = [], firstSeenTs, lastUpdatedTs }) {
  const now = new Date().toISOString();
  const res = getDb()
    .prepare(
      `INSERT INTO events (cluster_key, title, category, first_seen_ts, last_updated_ts, status, symbols_json)
       VALUES (?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(
      clusterKey,
      title,
      category,
      firstSeenTs || now,
      lastUpdatedTs || firstSeenTs || now,
      JSON.stringify(symbols || []),
    );
  return getEvent(Number(res.lastInsertRowid));
}

export function getEvent(id) {
  return rowToEvent(getDb().prepare('SELECT * FROM events WHERE id = ?').get(Number(id)));
}

export function getEventByClusterKey(clusterKey) {
  return rowToEvent(getDb().prepare('SELECT * FROM events WHERE cluster_key = ?').get(clusterKey));
}

export function updateEvent(id, fields = {}) {
  const current = getEvent(id);
  if (!current) return null;
  const next = {
    title: fields.title ?? current.title,
    category: fields.category ?? current.category,
    lastUpdatedTs: fields.lastUpdatedTs ?? current.lastUpdatedTs,
    status: fields.status ?? current.status,
    decision: fields.decision ?? current.decision,
    score: fields.score ?? current.score,
    confidence: fields.confidence ?? current.confidence,
    summary: fields.summary ?? current.summary,
    model: fields.model ?? current.model,
    evidence: fields.evidence ?? current.evidence,
    uncertain: fields.uncertain ?? current.uncertain,
    symbols: fields.symbols ?? current.symbols,
  };
  getDb()
    .prepare(
      `UPDATE events SET title=?, category=?, last_updated_ts=?, status=?, decision=?, score=?, confidence=?,
         summary_json=?, model_json=?, evidence_json=?, uncertain_json=?, symbols_json=? WHERE id=?`,
    )
    .run(
      next.title,
      next.category,
      next.lastUpdatedTs,
      next.status,
      next.decision,
      next.score,
      next.confidence,
      next.summary == null ? null : JSON.stringify(next.summary),
      next.model == null ? null : JSON.stringify(next.model),
      next.evidence == null ? null : JSON.stringify(next.evidence),
      next.uncertain == null ? null : JSON.stringify(next.uncertain),
      JSON.stringify(next.symbols || []),
      Number(id),
    );
  return getEvent(id);
}

export function attachArticle(eventId, urlHash, isPrimary = false) {
  const res = getDb()
    .prepare(
      'INSERT OR IGNORE INTO event_articles (event_id, url_hash, is_primary, added_ts) VALUES (?, ?, ?, ?)',
    )
    .run(Number(eventId), urlHash, isPrimary ? 1 : 0, new Date().toISOString());
  return Number(res.changes) > 0;
}

export function getEventArticles(eventId) {
  return getDb()
    .prepare(
      `SELECT a.*, ea.is_primary FROM articles a JOIN event_articles ea ON ea.url_hash = a.url_hash
       WHERE ea.event_id = ? ORDER BY a.published_ts IS NULL, a.published_ts ASC, a.first_seen_ts ASC`,
    )
    .all(Number(eventId))
    .map((a) => ({
      urlHash: a.url_hash,
      url: a.url,
      headline: a.headline,
      snippet: a.snippet,
      source: a.source,
      sourceDomain: a.source_domain,
      publishedTs: a.published_ts,
      firstSeenTs: a.first_seen_ts,
      engine: a.engine,
      contentHash: a.content_hash,
      isPrimary: Boolean(a.is_primary),
    }));
}

export function eventArticlesByEventIds(ids) {
  const map = new Map();
  for (const id of ids) map.set(id, []);
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT ea.event_id, a.source_domain, a.source, a.headline, a.content_hash FROM articles a
       JOIN event_articles ea ON ea.url_hash = a.url_hash WHERE ea.event_id IN (${placeholders})`,
    )
    .all(...ids);
  for (const r of rows) map.get(r.event_id)?.push(r);
  return map;
}

export function listEvents({ limit = 50, status = null, sinceIso = null } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (sinceIso) {
    clauses.push('last_updated_ts >= ?');
    params.push(sinceIso);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM events ${where} ORDER BY last_updated_ts DESC LIMIT ?`)
    .all(...params, limit);
  return rows.map(rowToEvent);
}

export function countEvents() {
  return Number(getDb().prepare('SELECT COUNT(*) AS c FROM events').get().c);
}

/** Candidate events for clustering: recent events plus their article headlines. */
export function recentEventCandidates({ sinceIso }) {
  const rows = getDb()
    .prepare('SELECT * FROM events WHERE last_updated_ts >= ? ORDER BY last_updated_ts DESC LIMIT 500')
    .all(sinceIso);
  return rows.map((r) => {
    const arts = getDb()
      .prepare(
        'SELECT a.headline, a.snippet FROM articles a JOIN event_articles ea ON ea.url_hash = a.url_hash WHERE ea.event_id = ?',
      )
      .all(r.id);
    const ev = rowToEvent(r);
    const tokens = new Set();
    for (const a of arts) for (const t of tokenize(`${a.headline || ''} ${a.snippet || ''}`)) tokens.add(t);
    return {
      id: ev.id,
      symbols: ev.symbols,
      lastUpdatedTs: ev.lastUpdatedTs,
      titleShingles: arts.filter((a) => a.headline).map((a) => shingles(a.headline)),
      tokens,
      articleCount: arts.length,
    };
  });
}

/** Merge event `dupId` into `keepId`: move its articles across and delete the duplicate. */
export function mergeEvents(keepId, dupId) {
  const db = getDb();
  const keep = getEvent(keepId);
  const dup = getEvent(dupId);
  if (!keep || !dup) return keep;
  const now = new Date().toISOString();
  const urls = db.prepare('SELECT url_hash, is_primary FROM event_articles WHERE event_id = ?').all(dupId);
  db.exec('BEGIN');
  try {
    for (const u of urls) {
      db.prepare(
        'INSERT OR IGNORE INTO event_articles (event_id, url_hash, is_primary, added_ts) VALUES (?, ?, ?, ?)',
      ).run(keepId, u.url_hash, u.is_primary, now);
    }
    db.prepare('DELETE FROM event_articles WHERE event_id = ?').run(dupId);
    db.prepare('DELETE FROM events WHERE id = ?').run(dupId);
    const symbols = [...new Set([...(keep.symbols || []), ...(dup.symbols || [])])];
    const lastUpdatedTs =
      Date.parse(dup.lastUpdatedTs) > Date.parse(keep.lastUpdatedTs)
        ? dup.lastUpdatedTs
        : keep.lastUpdatedTs;
    db.prepare('UPDATE events SET symbols_json = ?, last_updated_ts = ? WHERE id = ?').run(
      JSON.stringify(symbols),
      lastUpdatedTs,
      keepId,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getEvent(keepId);
}

export function setEventStatus(id, status) {
  getDb().prepare('UPDATE events SET status = ? WHERE id = ?').run(status, Number(id));
  return getEvent(id);
}

export function setEventModel(id, { summary, model, uncertain, confidence, category }) {
  return updateEvent(id, { summary, model, uncertain, confidence, category });
}

export function setEventScore(id, { score, decision, confidence, evidence }) {
  return updateEvent(id, { score, decision, confidence, evidence });
}

/* ---------------- notifications ---------------- */

export function notifyOnce({ eventId, dedupeKey }) {
  const res = getDb()
    .prepare(
      'INSERT OR IGNORE INTO notifications (event_id, dedupe_key, created_at, state) VALUES (?, ?, ?, ?)',
    )
    .run(Number(eventId), dedupeKey, new Date().toISOString(), 'unread');
  if (Number(res.changes) > 0) {
    getDb().prepare('UPDATE events SET last_notified_ts = ? WHERE id = ?').run(new Date().toISOString(), Number(eventId));
    return true;
  }
  return false;
}

export function listNotifications({ limit = 50, state = null } = {}) {
  const rows = state
    ? getDb()
        .prepare('SELECT * FROM notifications WHERE state = ? ORDER BY id DESC LIMIT ?')
        .all(state, limit)
    : getDb().prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
    state: r.state,
  }));
}

export function setNotificationState(id, state) {
  getDb().prepare('UPDATE notifications SET state = ? WHERE id = ?').run(state, Number(id));
}
