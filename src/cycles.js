import { getDb } from './db.js';

export function startCycle({ kind, startedTs, queriesPlanned = 0, status = 'running' }) {
  const res = getDb()
    .prepare('INSERT INTO cycles (kind, started_ts, status, queries_planned) VALUES (?, ?, ?, ?)')
    .run(kind, startedTs, status, queriesPlanned);
  return Number(res.lastInsertRowid);
}

export function finishCycle(id, {
  status,
  queriesUsed = 0,
  articlesNew = 0,
  eventsNew = 0,
  articlesSeen = null,
  articlesDuplicate = null,
  errors = [],
  finishedTs,
} = {}) {
  getDb()
    .prepare(
      `UPDATE cycles SET finished_ts = ?, status = ?, queries_used = ?, articles_new = ?, events_new = ?,
         articles_seen = ?, articles_duplicate = ?, errors_json = ?
       WHERE id = ?`,
    )
    .run(
      finishedTs || new Date().toISOString(),
      status,
      queriesUsed,
      articlesNew,
      eventsNew,
      articlesSeen,
      articlesDuplicate,
      JSON.stringify(errors || []),
      id,
    );
}

export function lastCycle(kind = null) {
  const row = kind
    ? getDb().prepare('SELECT * FROM cycles WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind)
    : getDb().prepare('SELECT * FROM cycles ORDER BY id DESC LIMIT 1').get();
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    startedAt: row.started_ts,
    finishedAt: row.finished_ts,
    status: row.status,
    queriesPlanned: row.queries_planned,
    queriesUsed: row.queries_used,
    articlesNew: row.articles_new,
    articlesSeen: row.articles_seen,
    articlesDuplicate: row.articles_duplicate,
    eventsNew: row.events_new,
    errors: safeParse(row.errors_json),
  };
}

/**
 * A cycle still marked `running` was left behind by a crashed or restarted process —
 * it never completed, so record that honestly instead of showing it as in-progress.
 */
export function markInterruptedCycles() {
  const res = getDb()
    .prepare(
      "UPDATE cycles SET status = 'interrupted', finished_ts = COALESCE(finished_ts, started_ts) WHERE status = 'running'",
    )
    .run();
  return Number(res.changes || 0);
}

export function recentCycles(limit = 20) {
  return getDb()
    .prepare('SELECT * FROM cycles ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      startedAt: row.started_ts,
      finishedAt: row.finished_ts,
      status: row.status,
      queriesUsed: row.queries_used,
      articlesNew: row.articles_new,
      eventsNew: row.events_new,
    }));
}

function safeParse(s) {
  try {
    return JSON.parse(s || '[]');
  } catch {
    return [];
  }
}
