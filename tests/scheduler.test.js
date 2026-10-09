import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getDb } from '../src/db.js';
import { startScheduler, stopScheduler, schedulerState, kickSchedulers } from '../src/scheduler.js';

// Sequential single test: the single scheduler lock row is mutated across cases.
test('scheduler lock: leader election, takeover of stale locks, overlap prevention', () => {
  initDb();

  // No lock held → this instance becomes leader.
  getDb().prepare('DELETE FROM scheduler_locks').run();
  startScheduler();
  assert.equal(schedulerState().lockHeld, true);
  assert.ok(getDb().prepare('SELECT owner FROM scheduler_locks WHERE name = ?').get('scheduler').owner);
  stopScheduler();

  // Fresh lock held elsewhere → do not run (prevents overlapping cycles / duplicate instances).
  getDb().prepare('DELETE FROM scheduler_locks').run();
  getDb()
    .prepare('INSERT INTO scheduler_locks (name, owner, heartbeat_ts) VALUES (?, ?, ?)')
    .run('scheduler', 'other-instance:1234', new Date().toISOString());
  startScheduler();
  assert.equal(schedulerState().lockHeld, false);
  stopScheduler();

  // Stale lock → take over.
  getDb().prepare('DELETE FROM scheduler_locks').run();
  getDb()
    .prepare('INSERT INTO scheduler_locks (name, owner, heartbeat_ts) VALUES (?, ?, ?)')
    .run('scheduler', 'dead-instance:9', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  startScheduler();
  assert.equal(schedulerState().lockHeld, true);
  stopScheduler();

  // Without the lock, kicking is a no-op.
  getDb().prepare('DELETE FROM scheduler_locks').run();
  assert.equal(kickSchedulers({ newsDelayMs: 1, marketDelayMs: 1 }), false);
});
