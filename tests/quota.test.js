import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { recordUsage, usageOn, usageThisMinute, withinLimits, dayKey } from '../src/quota/usageStore.js';
import { newsBudgetPlan, marketBudgetEstimate, daysInMonth } from '../src/quota/planner.js';
import { getDefaultSettings } from '../src/config.js';

initDb();

test('usage accounting sums credits per day and per minute', () => {
  const now = new Date();
  recordUsage({ provider: 'testprov', credits: 3, requests: 1, ts: now });
  recordUsage({ provider: 'testprov', credits: 2, requests: 1, ts: now });
  assert.equal(usageOn('testprov', now).credits, 5);
  assert.equal(usageThisMinute('testprov', now).credits, 5);
  assert.equal(usageOn('testprov', now).requests, 2);
});

test('withinLimits enforces per-minute and per-day caps', () => {
  const now = new Date();
  recordUsage({ provider: 'cap1', credits: 7, requests: 1, ts: now });
  const blocked = withinLimits('cap1', 2, { perMinute: 8, perDay: 800 }, now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'per_minute_limit');
  assert.equal(withinLimits('cap1', 1, { perMinute: 8, perDay: 800 }, now).ok, true);
});

test('withinLimits enforces the daily cap', () => {
  const now = new Date();
  const earlier = new Date(now.getTime() - 5 * 60 * 1000); // different minute, same day
  recordUsage({ provider: 'cap2', credits: 799, requests: 1, ts: earlier });
  const blocked = withinLimits('cap2', 2, { perMinute: 8, perDay: 800 }, now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'daily_limit');
});

test('free-tier news budget accrues fractionally and defers when < 1', () => {
  const settings = getDefaultSettings(); // 250/mo, 10-min cycle
  const plan = newsBudgetPlan({ settings, now: new Date() });
  assert.ok(plan.perCycle < 1, 'per-cycle allowance should be well under 1 on the free plan');
  assert.equal(plan.allowed, 0);
  assert.ok(plan.carry > 0, 'unspent allowance is carried forward');
  assert.ok(plan.daily > 0 && plan.daily < 20);
});

test('a large budget allows queries per cycle', () => {
  const settings = getDefaultSettings();
  settings.budget.serpapiMonthlySearches = 15000;
  settings.budget.serpapiReserveFraction = 0;
  const plan = newsBudgetPlan({ settings, now: new Date() });
  assert.ok(plan.allowed >= 1);
});

test('market budget estimate flags a watchlist over the per-minute cap', () => {
  const settings = getDefaultSettings();
  const est = marketBudgetEstimate({ settings, symbolCount: 10 });
  assert.equal(est.creditsPerPoll, 10);
  assert.equal(est.exceedsMinute, true); // 10 > 8/min
  const small = marketBudgetEstimate({ settings, symbolCount: 6 });
  assert.equal(small.exceedsMinute, false);
  assert.ok(small.creditsPerDay <= 800);
});

test('daysInMonth is correct', () => {
  assert.equal(daysInMonth(new Date('2024-02-10T00:00:00Z')), 29);
  assert.equal(daysInMonth(new Date('2025-02-10T00:00:00Z')), 28);
  assert.equal(dayKey(new Date('2025-01-02T03:04:05Z')), '2025-01-02');
});
