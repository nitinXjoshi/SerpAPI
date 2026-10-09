function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministic entity extraction: finds watchlist companies mentioned in text.
 * Short tickers require a word boundary to avoid false positives.
 */
export function extractEntities(text, watchlist = []) {
  const haystack = String(text || '');
  if (!haystack) return [];
  const found = new Set();
  for (const w of watchlist) {
    const needles = [w.symbol, w.companyName, ...(w.aliases || [])].filter(Boolean);
    for (const needle of needles) {
      const n = String(needle).trim();
      if (n.length < 3) continue;
      const re = new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i');
      if (re.test(haystack)) {
        found.add(w.symbol);
        break;
      }
    }
  }
  return [...found];
}
