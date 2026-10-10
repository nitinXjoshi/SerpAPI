import { ValidationError } from './errors.js';

const SYMBOL_RE = /^[A-Z0-9.\-:]{1,16}$/;

export function asString(value, { field = 'value', min = 0, max = 1000, pattern = null, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string.`, { field });
  const s = trim ? value.trim() : value;
  if (s.length < min) throw new ValidationError(`${field} must be at least ${min} character(s).`, { field });
  if (s.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`, { field });
  if (pattern && !pattern.test(s)) throw new ValidationError(`${field} has an invalid format.`, { field });
  return s;
}

export function asInt(value, { field = 'value', min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ValidationError(`${field} must be an integer.`, { field });
  }
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}.`, { field });
  return n;
}

export function asNumber(value, { field = 'value', min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number.`, { field });
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}.`, { field });
  return n;
}

export function asBool(value, { field = 'value' } = {}) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new ValidationError(`${field} must be a boolean.`, { field });
}

export function asEnum(value, allowed, { field = 'value', fallback = undefined } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}.`, { field });
  }
  return value;
}

export function asStringArray(value, { field = 'value', maxItems = 50, maxLen = 64, pattern = null } = {}) {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array.`, { field });
  if (value.length > maxItems) throw new ValidationError(`${field} must have at most ${maxItems} items.`, { field });
  return value.map((v, i) => asString(v, { field: `${field}[${i}]`, min: 1, max: maxLen, pattern }));
}

export function asId(value, { field = 'id', min = 1, max = 2147483647 } = {}) {
  return asInt(value, { field, min, max });
}

export function asSymbol(value, { field = 'symbol' } = {}) {
  const s = asString(value, { field, min: 1, max: 16 });
  const upper = s.toUpperCase();
  if (!SYMBOL_RE.test(upper)) throw new ValidationError(`${field} has an invalid format.`, { field });
  return upper;
}

/* ------------------------------------------------------------------ */
/* Settings schema validation (rejects unknown and out-of-range values)*/
/* ------------------------------------------------------------------ */

export function validateSettingsPatch(patch) {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('settings must be an object.');
  }
  const out = {};

  if (patch.monitoring !== undefined) {
    const m = patch.monitoring;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new ValidationError('monitoring must be an object.');
    const o = {};
    if (m.enabled !== undefined) o.enabled = asBool(m.enabled, { field: 'monitoring.enabled' });
    if (m.newsIntervalMinutes !== undefined) o.newsIntervalMinutes = asInt(m.newsIntervalMinutes, { field: 'monitoring.newsIntervalMinutes', min: 1, max: 1440 });
    if (m.marketIntervalMinutes !== undefined) o.marketIntervalMinutes = asInt(m.marketIntervalMinutes, { field: 'monitoring.marketIntervalMinutes', min: 1, max: 1440 });
    if (m.marketHoursOnly !== undefined) o.marketHoursOnly = asBool(m.marketHoursOnly, { field: 'monitoring.marketHoursOnly' });
    if (m.backfillHours !== undefined) o.backfillHours = asInt(m.backfillHours, { field: 'monitoring.backfillHours', min: 0, max: 720 });
    if (m.autoInvestigate !== undefined) o.autoInvestigate = asBool(m.autoInvestigate, { field: 'monitoring.autoInvestigate' });
    if (m.maxInvestigationsPerCycle !== undefined) o.maxInvestigationsPerCycle = asInt(m.maxInvestigationsPerCycle, { field: 'monitoring.maxInvestigationsPerCycle', min: 0, max: 20 });
    out.monitoring = o;
  }

  if (patch.providers !== undefined) {
    const p = patch.providers;
    if (typeof p !== 'object' || p === null) throw new ValidationError('providers must be an object.');
    const o = {};
    if (p.market !== undefined) o.market = asEnum(p.market, ['auto', 'twelvedata', 'fixture'], { field: 'providers.market' });
    if (p.news !== undefined) o.news = asEnum(p.news, ['auto', 'serpapi', 'fixture'], { field: 'providers.news' });
    out.providers = o;
  }

  if (patch.budget !== undefined) {
    const b = patch.budget;
    if (typeof b !== 'object' || b === null) throw new ValidationError('budget must be an object.');
    const o = {};
    if (b.serpapiMonthlySearches !== undefined) o.serpapiMonthlySearches = asInt(b.serpapiMonthlySearches, { field: 'budget.serpapiMonthlySearches', min: 0, max: 10_000_000 });
    if (b.serpapiReserveFraction !== undefined) o.serpapiReserveFraction = asNumber(b.serpapiReserveFraction, { field: 'budget.serpapiReserveFraction', min: 0, max: 0.9 });
    if (b.twelvedataPerMinute !== undefined) o.twelvedataPerMinute = asInt(b.twelvedataPerMinute, { field: 'budget.twelvedataPerMinute', min: 1, max: 100_000 });
    if (b.twelvedataPerDay !== undefined) o.twelvedataPerDay = asInt(b.twelvedataPerDay, { field: 'budget.twelvedataPerDay', min: 1, max: 100_000_000 });
    out.budget = o;
  }

  if (patch.news !== undefined) {
    const n = patch.news;
    if (typeof n !== 'object' || n === null) throw new ValidationError('news must be an object.');
    const o = {};
    if (n.maxQueriesPerCycle !== undefined) o.maxQueriesPerCycle = asInt(n.maxQueriesPerCycle, { field: 'news.maxQueriesPerCycle', min: 0, max: 200 });
    for (const k of ['companyQueries', 'sectorQueries', 'marketQuery', 'categoryQueries']) {
      if (n[k] !== undefined) o[k] = asBool(n[k], { field: `news.${k}` });
    }
    if (n.categories !== undefined) o.categories = asStringArray(n.categories, { field: 'news.categories', maxItems: 20, maxLen: 40 });
    out.news = o;
  }

  if (patch.scoring !== undefined) {
    const s = patch.scoring;
    if (typeof s !== 'object' || s === null) throw new ValidationError('scoring must be an object.');
    const o = {};
    if (s.weights !== undefined) {
      if (typeof s.weights !== 'object' || s.weights === null) throw new ValidationError('scoring.weights must be an object.');
      const allowed = ['priceAnomaly', 'relativeDivergence', 'eventNovelty', 'relevance', 'sourceStrength', 'crossAssetConfirmation', 'freshness', 'uncertainty', 'executionCost'];
      const w = {};
      for (const k of allowed) {
        if (s.weights[k] !== undefined) w[k] = asNumber(s.weights[k], { field: `scoring.weights.${k}`, min: 0, max: 1 });
      }
      o.weights = w;
    }
    if (s.thresholds !== undefined) {
      const t = s.thresholds;
      if (typeof t !== 'object' || t === null) throw new ValidationError('scoring.thresholds must be an object.');
      const oo = {};
      for (const k of ['opportunity', 'watch', 'insufficient']) {
        if (t[k] !== undefined) oo[k] = asInt(t[k], { field: `scoring.thresholds.${k}`, min: 0, max: 100 });
      }
      o.thresholds = oo;
    }
    if (s.anomalyPct !== undefined) o.anomalyPct = asNumber(s.anomalyPct, { field: 'scoring.anomalyPct', min: 0.1, max: 100 });
    if (s.divergencePct !== undefined) o.divergencePct = asNumber(s.divergencePct, { field: 'scoring.divergencePct', min: 0.1, max: 100 });
    out.scoring = o;
  }

  if (patch.notifications !== undefined) {
    const n = patch.notifications;
    if (typeof n !== 'object' || n === null) throw new ValidationError('notifications must be an object.');
    const o = {};
    if (n.minScore !== undefined) o.minScore = asInt(n.minScore, { field: 'notifications.minScore', min: 0, max: 100 });
    if (n.dedupeWindowHours !== undefined) o.dedupeWindowHours = asInt(n.dedupeWindowHours, { field: 'notifications.dedupeWindowHours', min: 0, max: 720 });
    out.notifications = o;
  }

  if (Object.keys(out).length === 0) throw new ValidationError('No valid settings were provided.');
  return out;
}

/** After merging, thresholds must be ordered opportunity >= watch >= insufficient. */
export function assertThresholdOrder(settings) {
  const t = settings?.scoring?.thresholds;
  if (!t) return;
  if (!(t.opportunity >= t.watch && t.watch >= t.insufficient)) {
    throw new ValidationError('scoring thresholds must satisfy opportunity >= watch >= insufficient.');
  }
}

export const WATCHLIST_LIMITS = { aliases: 20, peers: 20, importanceMin: 0, importanceMax: 1 };
export const NOTIFICATION_STATES = ['unread', 'read', 'dismissed'];
export const EVENT_STATUSES = ['new', 'acknowledged', 'dismissed', 'saved', 'following'];
