import { getSettings } from '../db.js';
import { config } from '../config.js';
import { getSymbolSet } from '../watchlist.js';
import { resolveMarketProvider, getTwelveDataKey } from '../providers/market/index.js';
import { insertObservations } from './store.js';
import { recordUsage, withinLimits } from '../quota/usageStore.js';
import { logger } from '../logger.js';

/** US equity session check (9:30–16:00 America/New_York, weekdays; holidays not modelled). */
export function marketStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const mins = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(map.weekday);
  const open = isWeekday && mins >= 570 && mins < 960;
  return {
    open,
    et: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    weekday: map.weekday,
    reason: open ? 'open' : isWeekday ? 'outside_hours' : 'weekend',
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleepToNextMinute() {
  const now = Date.now();
  const next = Math.ceil((now + 1) / 60000) * 60000;
  return new Promise((r) => setTimeout(r, Math.max(500, next - now + 250)));
}

/**
 * One market poll. Adaptive + budget-aware:
 *  - skips when the market is closed (unless forced)
 *  - splits the symbol set into chunks that respect the per-minute credit limit
 *  - refuses to exceed per-minute / per-day credit limits (deferring the rest)
 *  - never fabricates a movement for cached/stale quotes
 */
export async function pollMarket({ force = false, now = new Date(), allowWait = !force } = {}) {
  const settings = getSettings();
  const symbols = getSymbolSet();
  const status = marketStatus(now);

  if (!symbols.length) {
    return { skipped: true, reason: 'empty_watchlist', at: now.toISOString(), marketStatus: status };
  }
  if (!force && settings.monitoring.marketHoursOnly && !status.open) {
    return { skipped: true, reason: 'market_closed', at: now.toISOString(), marketStatus: status };
  }

  const provider = resolveMarketProvider(settings);
  // Fixture data must never be written to the persistent (live) database. Outside demo
  // mode, a missing provider key means "no data" — not synthetic prices.
  if (provider.id === 'fixture' && !config.demoMode) {
    return {
      skipped: true,
      reason: 'provider_unavailable',
      provider: 'fixture',
      message: 'No market-data provider configured. Add a Twelve Data key in Settings; fixtures are demo-only.',
      at: now.toISOString(),
      marketStatus: status,
    };
  }
  const isMetered = provider.id === 'twelvedata';
  // Reserve part of the per-minute allowance for interactive requests (a user opening a chart
  // or clicking a symbol) so background polling can never starve the page being viewed. Only
  // reserve when the cap is comfortably above the reservation — a tiny cap has no headroom.
  const INTERACTIVE_RESERVE = 2;
  const cap = settings.budget.twelvedataPerMinute;
  const perMinute = isMetered
    ? Math.max(1, cap - (cap >= 2 * INTERACTIVE_RESERVE ? INTERACTIVE_RESERVE : 0))
    : Infinity;
  const perDay = isMetered ? settings.budget.twelvedataPerDay : Infinity;
  const apiKey = isMetered ? getTwelveDataKey() : null;

  const chunks = isMetered ? chunk(symbols, Math.max(1, Math.floor(perMinute))) : [symbols];

  const quotes = [];
  const failed = [];
  const deferred = [];
  let creditsUsed = 0;
  let blockedReason = null;
  let creditsLeft;
  let rateLimited = false;

  for (let i = 0; i < chunks.length; i++) {
    const group = chunks[i];
    const cost = provider.creditCost(group);

    if (isMetered) {
      let check = withinLimits('twelvedata', cost, { perMinute, perDay }, new Date());
      if (!check.ok && check.reason === 'per_minute_limit' && allowWait) {
        await sleepToNextMinute();
        check = withinLimits('twelvedata', cost, { perMinute, perDay }, new Date());
      }
      if (!check.ok) {
        blockedReason = check.reason;
        deferred.push(...group);
        break;
      }
    }

    const res = await provider.fetchQuotes(group, { apiKey });
    creditsUsed += res.creditsUsed || 0;
    creditsLeft = res.creditsLeft ?? creditsLeft;
    recordUsage({ provider: provider.id, credits: res.creditsUsed || 0, requests: 1, ts: new Date() });
    if (res.quotes?.length) quotes.push(...res.quotes);
    if (res.failed?.length) failed.push(...res.failed);
    if (res.error && !res.quotes?.length) blockedReason = res.error;

    if (res.rateLimited) {
      rateLimited = true;
      deferred.push(...chunks.slice(i + 1).flat());
      break;
    }
  }

  if (quotes.length) insertObservations(quotes);

  logger.info('market.poll', {
    provider: provider.id,
    symbols: symbols.length,
    quotes: quotes.length,
    credits: creditsUsed,
    failed: failed.length,
    deferred: deferred.length,
  });

  const reason = deferred.length
    ? blockedReason || 'budget_deferred'
    : quotes.length
      ? null
      : blockedReason;

  return {
    skipped: quotes.length === 0 && !failed.length && Boolean(reason),
    reason,
    provider: provider.id,
    source: provider.label || provider.id,
    symbols: symbols.length,
    quotes,
    failed,
    deferred,
    rateLimited,
    creditsUsed,
    creditsLeft,
    at: now.toISOString(),
    marketStatus: status,
  };
}

/**
 * Adaptive interval: poll faster when an anomaly is present, slower when quiet.
 * Returns milliseconds until the next poll.
 */
export function adaptiveIntervalMs({ baseMinutes, hasAnomaly, status }) {
  if (status && !status.open) return Math.max(baseMinutes, 5) * 60 * 1000;
  const base = baseMinutes * 60 * 1000;
  return hasAnomaly ? Math.max(base / 2, 60 * 1000) : base;
}
