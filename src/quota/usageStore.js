import { getDb } from '../db.js';

export function dayKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}
export function minuteKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 16);
}

export function recordUsage({ provider, credits = 0, requests = 1, ts = new Date() } = {}) {
  const d = ts instanceof Date ? ts : new Date(ts);
  getDb()
    .prepare(
      'INSERT INTO provider_usage (provider, day, minute_bucket, credits, requests, ts) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(provider, dayKey(d), minuteKey(d), credits, requests, d.toISOString());
}

export function usageOn(provider, d = new Date()) {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(credits),0) AS credits, COALESCE(SUM(requests),0) AS requests FROM provider_usage WHERE provider = ? AND day = ?',
    )
    .get(provider, dayKey(d));
  return { credits: Number(row.credits), requests: Number(row.requests) };
}

export function usageThisMinute(provider, d = new Date()) {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(credits),0) AS credits, COALESCE(SUM(requests),0) AS requests FROM provider_usage WHERE provider = ? AND minute_bucket = ?',
    )
    .get(provider, minuteKey(d));
  return { credits: Number(row.credits), requests: Number(row.requests) };
}

/** Would spending `credits` for `provider` stay within the configured limits? */
export function withinLimits(provider, credits, limits = {}, d = new Date()) {
  const perMin = limits.perMinute ?? Infinity;
  const perDay = limits.perDay ?? Infinity;
  const minute = usageThisMinute(provider, d);
  const day = usageOn(provider, d);
  return {
    ok: minute.credits + credits <= perMin && day.credits + credits <= perDay,
    minute,
    day,
    perMin,
    perDay,
    reason:
      minute.credits + credits > perMin
        ? 'per_minute_limit'
        : day.credits + credits > perDay
          ? 'daily_limit'
          : null,
  };
}
