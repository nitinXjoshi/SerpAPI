import crypto from 'node:crypto';
import { getDb, getSettings } from './db.js';
import { pollMarket, adaptiveIntervalMs, marketStatus } from './market/poller.js';
import { buildRadar } from './market/radar.js';
import { runNewsCycle } from './news/ingest.js';
import { lastCycle, markInterruptedCycles } from './cycles.js';
import { logger } from './logger.js';

const OWNER = `${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const LOCK_NAME = 'scheduler';
const HEARTBEAT_STALE_MS = 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

const state = {
  started: false,
  owner: OWNER,
  lockHeld: false,
  market: { running: false, lastAt: null, lastError: null, failures: 0, inFlight: false },
  news: { running: false, lastAt: null, lastError: null, failures: 0, inFlight: false },
};

let marketTimer = null;
let newsTimer = null;
let heartbeatTimer = null;
let stopping = false;

/* ---------------- single-instance lock ---------------- */

function readLock() {
  return getDb().prepare('SELECT * FROM scheduler_locks WHERE name = ?').get(LOCK_NAME);
}

function acquireLock() {
  const now = Date.now();
  const row = readLock();
  if (row && row.owner !== OWNER) {
    const hb = row.heartbeat_ts ? Date.parse(row.heartbeat_ts) : 0;
    if (now - hb < HEARTBEAT_STALE_MS) {
      logger.warn('scheduler.lock.held_by_other', { owner: row.owner });
      return false;
    }
    logger.warn('scheduler.lock.stale_takeover', { previousOwner: row.owner });
  }
  writeHeartbeat();
  return true;
}

function writeHeartbeat() {
  getDb()
    .prepare(
      `INSERT INTO scheduler_locks (name, owner, heartbeat_ts) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, heartbeat_ts = excluded.heartbeat_ts`,
    )
    .run(LOCK_NAME, OWNER, new Date().toISOString());
}

function releaseLock() {
  const row = readLock();
  if (row && row.owner === OWNER) {
    getDb().prepare('DELETE FROM scheduler_locks WHERE name = ?').run(LOCK_NAME);
  }
}

/* ---------------- jobs ---------------- */

async function tickMarket() {
  if (state.market.running || stopping) return;
  const settings = getSettings();
  if (!settings.monitoring.enabled) return;
  if (!state.lockHeld) return;

  state.market.running = true;
  state.market.inFlight = true;
  try {
    const result = await pollMarket();
    state.market.lastAt = new Date().toISOString();
    state.market.lastError = null;
    state.market.failures = 0;
    state.market.lastResult = result;
  } catch (err) {
    state.market.failures += 1;
    state.market.lastError = err.message;
    logger.error('scheduler.market.error', { error: err.message });
  } finally {
    state.market.running = false;
    state.market.inFlight = false;
    scheduleMarket();
  }
}

function scheduleMarket() {
  clearTimeout(marketTimer);
  if (stopping) return;
  const settings = getSettings();
  const base = settings.monitoring.marketIntervalMinutes;
  let hasAnomaly = false;
  try {
    hasAnomaly = buildRadar().rows.some((r) => r.anomalous);
  } catch {
    /* ignore */
  }
  const status = marketStatus();
  let delay = adaptiveIntervalMs({ baseMinutes: base, hasAnomaly, status });
  if (state.market.failures > 0) {
    delay = Math.min(delay * 2 ** state.market.failures, MAX_BACKOFF_MS);
  }
  marketTimer = setTimeout(tickMarket, delay);
  marketTimer.unref?.();
}

async function tickNews() {
  if (state.news.running || stopping) return;
  const settings = getSettings();
  if (!settings.monitoring.enabled) return;
  if (!state.lockHeld) return;

  state.news.running = true;
  state.news.inFlight = true;
  try {
    const { summary } = await runNewsCycle({ force: false });
    state.news.lastAt = new Date().toISOString();
    state.news.lastError = null;
    state.news.failures = 0;
    state.news.lastSummary = summary;
  } catch (err) {
    state.news.failures += 1;
    state.news.lastError = err.message;
    logger.error('scheduler.news.error', { error: err.message });
  } finally {
    state.news.running = false;
    state.news.inFlight = false;
    scheduleNews();
  }
}

function scheduleNews() {
  clearTimeout(newsTimer);
  if (stopping) return;
  const settings = getSettings();
  let delay = Math.max(1, settings.monitoring.newsIntervalMinutes) * 60 * 1000;
  if (state.news.failures > 0) {
    delay = Math.min(delay * 2 ** state.news.failures, MAX_BACKOFF_MS);
  }
  newsTimer = setTimeout(tickNews, delay);
  newsTimer.unref?.();
}

/* ---------------- lifecycle ---------------- */

export function startScheduler() {
  if (state.started) return state;
  state.started = true;
  state.lockHeld = acquireLock();

  const interrupted = markInterruptedCycles();
  if (interrupted) logger.warn('scheduler.recovered_interrupted_cycles', { count: interrupted });

  heartbeatTimer = setInterval(() => {
    if (state.lockHeld) writeHeartbeat();
  }, 20000);
  heartbeatTimer.unref?.();

  // Recovery: if monitoring is on and the last cycle is overdue, run one soon.
  const settings = getSettings();
  if (state.lockHeld && settings.monitoring.enabled) {
    const last = lastCycle('news');
    const overdue =
      !last ||
      Date.now() - Date.parse(last.finishedAt || last.startedAt) >
        settings.monitoring.newsIntervalMinutes * 2 * 60 * 1000;
    if (overdue) {
      logger.info('scheduler.recovery.news_overdue');
      newsTimer = setTimeout(tickNews, 5000);
      newsTimer.unref?.();
    }
  }

  scheduleMarket();
  if (!newsTimer) scheduleNews();
  logger.info('scheduler.started', { owner: OWNER, lockHeld: state.lockHeld });
  return state;
}

export function stopScheduler() {
  stopping = true;
  clearTimeout(marketTimer);
  clearTimeout(newsTimer);
  clearInterval(heartbeatTimer);
  releaseLock();
  state.started = false;
  state.lockHeld = false;
  state.market.inFlight = false;
  state.news.inFlight = false;
  logger.info('scheduler.stopped');
}

export function schedulerState() {
  const settings = getSettings();
  const lastNews = lastCycle('news');
  const lastMkt = lastCycle('market');
  return {
    owner: OWNER,
    lockHeld: state.lockHeld,
    monitoringEnabled: settings.monitoring.enabled,
    intervals: {
      newsMinutes: settings.monitoring.newsIntervalMinutes,
      marketMinutes: settings.monitoring.marketIntervalMinutes,
    },
    market: { ...state.market, lastResult: undefined },
    news: { ...state.news, lastSummary: undefined },
    lastNewsCycle: lastNews,
    lastMarketCycle: lastMkt,
    marketStatus: marketStatus(),
  };
}

/** Run soon after monitoring is switched on, instead of waiting a full interval. */
export function kickSchedulers({ newsDelayMs = 3000, marketDelayMs = 1500 } = {}) {
  if (!state.lockHeld) return false;
  clearTimeout(newsTimer);
  newsTimer = setTimeout(tickNews, newsDelayMs);
  newsTimer.unref?.();
  clearTimeout(marketTimer);
  marketTimer = setTimeout(tickMarket, marketDelayMs);
  marketTimer.unref?.();
  logger.info('scheduler.kicked', { newsDelayMs, marketDelayMs });
  return true;
}

/** Manual triggers (used by the dashboard "run now" buttons). */
export async function triggerMarketPoll(opts) {
  if (state.market.inFlight) return { skipped: true, reason: 'already_running' };
  state.market.inFlight = true;
  try {
    return await pollMarket(opts);
  } finally {
    state.market.inFlight = false;
  }
}

export async function triggerNewsCycle(opts) {
  if (state.news.inFlight) return { skipped: true, reason: 'already_running' };
  state.news.inFlight = true;
  try {
    return await runNewsCycle(opts);
  } finally {
    state.news.inFlight = false;
  }
}
