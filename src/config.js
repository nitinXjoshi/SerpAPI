import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function bool(value, fallback) {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

export const config = {
  root: ROOT,
  port: num(process.env.PORT, 3000),
  /** Bind to loopback by default so the dashboard is not exposed on the LAN. */
  host: process.env.HOST || '127.0.0.1',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'intel.db'),
  demoMode: bool(process.env.DEMO_MODE, false),
  /**
   * Local hackathon presentation mode: no sign-in page, full functionality, real
   * providers, persistent database. Loopback-only. Distinct from demoMode (read-only
   * fixtures) and from normal mode (authentication required).
   */
  hackathonMode: bool(process.env.HACKATHON_MODE, false),
  encryptionKey: process.env.APP_ENCRYPTION_KEY || null,
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || null,
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_MS, 60000),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  csp: {
    enabled: bool(process.env.CSP_ENABLED, true),
  },
  auth: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || null,
    token: process.env.ADMIN_TOKEN || null,
    /** Explicit, opt-in, insecure local-only bypass. Never enabled by default. */
    disabled: bool(process.env.AUTH_DISABLED, false),
    sessionTtlMinutes: Math.max(5, num(process.env.SESSION_TTL_MINUTES, 480)),
    cookieName: process.env.SESSION_COOKIE_NAME || 'ti_session',
    maxLoginAttempts: Math.max(3, num(process.env.AUTH_MAX_ATTEMPTS, 10)),
    loginWindowMinutes: Math.max(1, num(process.env.AUTH_WINDOW_MINUTES, 15)),
  },
};

/** Runtime-tunable settings (persisted in the DB; these are the defaults). */
export const DEFAULT_SETTINGS = {
  monitoring: {
    enabled: false,
    newsIntervalMinutes: 10,
    marketIntervalMinutes: 10,
    marketHoursOnly: true,
    backfillHours: 6,
    autoInvestigate: true,
    maxInvestigationsPerCycle: 1,
  },
  providers: {
    market: 'auto', // 'auto' | 'twelvedata' | 'fixture'
    news: 'auto', // 'auto' | 'serpapi' | 'fixture'
  },
  budget: {
    serpapiMonthlySearches: 250,
    serpapiReserveFraction: 0.2,
    twelvedataPerMinute: 8,
    twelvedataPerDay: 800,
  },
  news: {
    maxQueriesPerCycle: 6,
    companyQueries: true,
    sectorQueries: true,
    marketQuery: true,
    categories: [
      'earnings',
      'guidance',
      'regulation',
      'litigation',
      'product',
      'production',
      'supply-chain',
      'm&a',
      'management',
    ],
    categoryQueries: false,
  },
  scoring: {
    weights: {
      priceAnomaly: 0.16,
      relativeDivergence: 0.22,
      eventNovelty: 0.14,
      relevance: 0.12,
      sourceStrength: 0.14,
      crossAssetConfirmation: 0.12,
      freshness: 0.10,
      uncertainty: 0.20,
      executionCost: 0.05,
    },
    thresholds: { opportunity: 70, watch: 50, insufficient: 30 },
    anomalyPct: 4,
    divergencePct: 3,
  },
  notifications: {
    minScore: 40,
    dedupeWindowHours: 12,
  },
};

export function getDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}
