/**
 * Deterministic relative-performance analysis.
 * Compares each watchlist symbol against its benchmark and peers. No LLM involved.
 */
export function analyzeWatchlist({ watchlist = [], latestBySymbol = {}, thresholds = {} } = {}) {
  const divergenceThreshold = thresholds.divergencePct ?? 3;
  const anomalyThreshold = thresholds.anomalyPct ?? 4;

  return watchlist
    .filter((w) => w.enabled !== false)
    .map((w) => {
      const obs = latestBySymbol[w.symbol] || null;
      const bench = w.benchmarkSymbol ? latestBySymbol[String(w.benchmarkSymbol).toUpperCase()] : null;
      const peers = (w.peers || [])
        .map((p) => latestBySymbol[String(p).toUpperCase()])
        .filter(Boolean);

      const changePct = obs?.changePct ?? null;
      const benchmarkChangePct = bench?.changePct ?? null;
      const divergence =
        changePct != null && benchmarkChangePct != null ? round(changePct - benchmarkChangePct) : null;

      const peerChangeAvg = peers.length
        ? round(peers.reduce((a, b) => a + (b.changePct ?? 0), 0) / peers.length)
        : null;
      const peerDivergence =
        changePct != null && peerChangeAvg != null ? round(changePct - peerChangeAvg) : null;

      const anomalous =
        (divergence != null && Math.abs(divergence) >= divergenceThreshold) ||
        (changePct != null && Math.abs(changePct) >= anomalyThreshold);

      return {
        symbol: w.symbol,
        exchange: w.exchange,
        companyName: w.companyName,
        sector: w.sector,
        importance: w.importance,
        price: obs?.price ?? null,
        changePct,
        change: obs?.change ?? null,
        volume: obs?.volume ?? null,
        currency: obs?.currency ?? null,
        marketTs: obs?.marketTs ?? null,
        retrievedTs: obs?.retrievedTs ?? null,
        source: obs?.source ?? null,
        stale: obs ? Boolean(obs.stale) : true,
        hasData: Boolean(obs),
        benchmarkSymbol: w.benchmarkSymbol || null,
        benchmarkChangePct,
        divergence,
        peerSymbols: w.peers || [],
        peerChangeAvg,
        peerDivergence,
        anomalous,
      };
    });
}

function round(n) {
  return Math.round(n * 100) / 100;
}
