import { tokenize } from './dedup.js';

/**
 * Tokens that must NOT drive event clustering: the watchlist's own symbols, company
 * names and aliases, plus corporate filler. Without this, every story mentioning
 * "NVIDIA" looks similar to every other NVIDIA story.
 */
const FILLER = [
  'corporation', 'corp', 'inc', 'ltd', 'limited', 'company', 'co', 'group', 'holdings',
  'holding', 'plc', 'technologies', 'technology', 'class', 'common', 'stock', 'stocks',
  'share', 'shares', 'nasdaq', 'nyse', 'exchange', 'ticker',
];

export function buildGenericTokens(watchlist = []) {
  const set = new Set(FILLER);
  for (const w of watchlist || []) {
    for (const value of [w.symbol, w.companyName, ...(w.aliases || [])]) {
      if (!value) continue;
      for (const t of tokenize(String(value))) set.add(t);
    }
  }
  return set;
}

export function stripGeneric(tokens, generic) {
  if (!generic || generic.size === 0) return tokens;
  const out = new Set();
  for (const t of tokens) if (!generic.has(t)) out.add(t);
  return out;
}
