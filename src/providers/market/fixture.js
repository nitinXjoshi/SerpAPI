/**
 * Deterministic synthetic market provider.
 *
 * Used when no Twelve Data key is configured or DEMO_MODE is on. Every quote is
 * explicitly labelled `source: 'fixture'` and must never be presented as live data.
 *
 * The profiles below deliberately include a company-specific divergence (NVDA vs the
 * SOXX/SPY benchmarks) so the anomaly → investigation → scoring flow is demonstrable
 * without spending provider quota.
 */
const PROFILES = {
  NVDA: { base: 128, chgPct: -5.8, volume: 2.5e8, exchange: 'NASDAQ' },
  AMD: { base: 162, chgPct: -1.0, volume: 6e7, exchange: 'NASDAQ' },
  INTC: { base: 30, chgPct: 0.2, volume: 4e7, exchange: 'NASDAQ' },
  TSM: { base: 175, chgPct: 0.4, volume: 1.2e7, exchange: 'NYSE' },
  SOXX: { base: 232, chgPct: -1.1, volume: 5e6, exchange: 'NASDAQ' },
  SPY: { base: 520, chgPct: -0.6, volume: 4e7, exchange: 'NYSEARCA' },
  QQQ: { base: 440, chgPct: -0.5, volume: 2e7, exchange: 'NASDAQ' },
  AAPL: { base: 190, chgPct: 0.3, volume: 5e7, exchange: 'NASDAQ' },
  MSFT: { base: 420, chgPct: -0.2, volume: 2e7, exchange: 'NASDAQ' },
  GOOGL: { base: 176, chgPct: 0.1, volume: 2.5e7, exchange: 'NASDAQ' },
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

function profileFor(symbol) {
  if (PROFILES[symbol]) return PROFILES[symbol];
  const h = hash(symbol);
  return { base: 40 + h * 200, chgPct: (h * 2 - 1) * 2, volume: 1e6, exchange: null };
}

export const fixtureProvider = {
  id: 'fixture',
  label: 'Fixture (synthetic — not live data)',
  supportsBatch: true,

  creditCost() {
    return 0;
  },

  async fetchQuotes(symbols) {
    const now = new Date();
    const bucket = Math.floor(now.getTime() / 60000);
    const marketTs = new Date(bucket * 60000).toISOString();
    const quotes = (symbols || []).map((raw) => {
      const symbol = String(raw).toUpperCase();
      const p = profileFor(symbol);
      const jitter = (hash(symbol + bucket) - 0.5) * 0.4;
      const changePct = Math.round((p.chgPct + jitter) * 1000) / 1000;
      const previousClose = p.base;
      const price = Math.round(previousClose * (1 + changePct / 100) * 100) / 100;
      const change = Math.round((price - previousClose) * 100) / 100;
      return {
        symbol,
        exchange: p.exchange,
        price,
        previousClose,
        change,
        changePct,
        volume: p.volume,
        currency: 'USD',
        marketTs,
        retrievedTs: now.toISOString(),
        source: 'fixture',
        marketClosed: false,
        stale: false,
      };
    });
    return { quotes, failed: [], creditsUsed: 0 };
  },
};
