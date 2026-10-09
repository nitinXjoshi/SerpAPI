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
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'intel.db'),
  demoMode: bool(process.env.DEMO_MODE, false),
  encryptionKey: process.env.APP_ENCRYPTION_KEY || null,
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || null,
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_MS, 60000),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
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
