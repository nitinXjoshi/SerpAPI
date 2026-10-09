import { getSettings, getSetting, setSetting } from '../db.js';

export function daysInMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * SerpApi news budget for the next cycle.
 *
 * On the free plan (250 searches/month) a 10-minute cycle (144/day) cannot spend a
 * whole search every cycle, so the planner carries a fractional allowance forward and
 * fires a query only when at least one accrues. A reserve fraction is held back for
 * anomaly-triggered follow-up searches.
 */
export function newsBudgetPlan({ settings = getSettings(), account = null, now = new Date() } = {}) {
  const days = daysInMonth(now);
  const daysLeft = Math.max(1, days - now.getUTCDate() + 1);
  const cyclesPerDay = (24 * 60) / Math.max(1, settings.monitoring.newsIntervalMinutes);

  const monthly = account?.searches_per_month ?? settings.budget.serpapiMonthlySearches;
  const remaining = account?.plan_searches_left ?? monthly;
  const dailyFromPlan = monthly / days;
  const dailyFromRemaining = remaining / daysLeft;
  const daily = Math.min(dailyFromPlan, dailyFromRemaining);
  const perCycle = daily / cyclesPerDay;

  const runtime = getSetting('runtime', {}) || {};
  const carry = Number(runtime.newsBudgetCarry) || 0;
  const available = carry + perCycle;
  const reserveNeeded = settings.budget.serpapiReserveFraction * perCycle;
  const spendable = Math.floor(Math.max(0, available - reserveNeeded));
  const allowed = Math.max(0, Math.min(spendable, settings.news.maxQueriesPerCycle));

  return {
    allowed,
    carry: Math.max(0, available - allowed),
    perCycle: round4(perCycle),
    daily: round4(daily),
    monthly,
    remaining,
    daysLeft,
    cyclesPerDay: Math.round(cyclesPerDay),
    reserveNeeded: round4(reserveNeeded),
  };
}

export function commitNewsBudget(plan) {
  const runtime = getSetting('runtime', {}) || {};
  runtime.newsBudgetCarry = plan.carry;
  runtime.newsBudgetUpdatedAt = new Date().toISOString();
  runtime.lastNewsPlan = {
    allowed: plan.allowed,
    perCycle: plan.perCycle,
    daily: plan.daily,
    remaining: plan.remaining,
  };
  setSetting('runtime', runtime);
}

/** Expected Twelve Data usage for the current watchlist / interval (pre-flight check). */
export function marketBudgetEstimate({ settings = getSettings(), symbolCount = 0 } = {}) {
  const minutesPerSession = settings.monitoring.marketHoursOnly ? 390 : 1440;
  const pollsPerDay = Math.floor(minutesPerSession / Math.max(1, settings.monitoring.marketIntervalMinutes));
  const creditsPerPoll = symbolCount;
  const creditsPerDay = pollsPerDay * creditsPerPoll;
  return {
    symbolCount,
    creditsPerPoll,
    pollsPerDay,
    creditsPerDay,
    perDay: settings.budget.twelvedataPerDay,
    perMinute: settings.budget.twelvedataPerMinute,
    exceedsDaily: creditsPerDay > settings.budget.twelvedataPerDay,
    exceedsMinute: creditsPerPoll > settings.budget.twelvedataPerMinute,
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
