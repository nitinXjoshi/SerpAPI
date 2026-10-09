import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getDb } from '../src/db.js';
import { runReplay } from '../src/replay/engine.js';
import { countEvents } from '../src/events/store.js';

initDb();

test('replay scores the scenario using only data available at the decision time', () => {
  const r = runReplay('nvda-export-restrictions');
  const decision = Date.parse(r.decisionTime);

  // no look-ahead: nothing in the timeline is after the decision point
  for (const step of r.steps) {
    assert.ok(Date.parse(step.ts) <= decision, `step after decision: ${step.ts}`);
  }
  // the post-decision observation is reported separately and not part of the timeline
  assert.ok(r.postDecision.length >= 1);
  const postTs = r.postDecision[0].ts;
  assert.ok(!r.steps.some((s) => s.ts === postTs), 'post-decision data must not enter the timeline');
  assert.match(r.lookaheadNotice, /at or before decisionTime/i);
});

test('replay produces a bounded score and a defined decision', () => {
  const r = runReplay('nvda-export-restrictions');
  assert.ok(r.summary.score >= 0 && r.summary.score <= 100);
  assert.ok(['potential_opportunity', 'watch', 'insufficient_evidence', 'no_trade'].includes(r.summary.decision));
  assert.equal(r.summary.primarySymbol, 'NVDA');
  assert.ok(r.summary.divergence < 0, 'NVDA diverges negatively from the benchmark');
});

test('replay does not mutate live event state', () => {
  const before = countEvents();
  runReplay('nvda-export-restrictions');
  assert.equal(countEvents(), before);
});

test('unknown scenarios are rejected', () => {
  assert.throws(() => runReplay('does-not-exist'));
});
