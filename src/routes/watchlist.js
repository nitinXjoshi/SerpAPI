import { Router } from 'express';
import {
  listWatchlist,
  upsertWatchlist,
  removeWatchlist,
  defaultWatchlist,
} from '../watchlist.js';
import { asSymbol, asString, asStringArray, asNumber, asBool } from '../security/validate.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ watchlist: listWatchlist() });
});

/** Validate and normalise a watchlist entry before persisting it. */
export function validateWatchlistEntry(body = {}) {
  const symbol = asSymbol(body.symbol, { field: 'symbol' });
  const exchange =
    body.exchange == null || body.exchange === '' ? null : asString(body.exchange, { field: 'exchange', max: 32 });
  const companyName =
    body.companyName == null || body.companyName === '' ? null : asString(body.companyName, { field: 'companyName', max: 200 });
  const sector = body.sector == null || body.sector === '' ? null : asString(body.sector, { field: 'sector', max: 100 });
  const aliases = body.aliases === undefined ? [] : asStringArray(body.aliases, { field: 'aliases', maxItems: 20, maxLen: 64 });
  const benchmarkSymbol =
    body.benchmarkSymbol == null || body.benchmarkSymbol === '' ? null : asSymbol(body.benchmarkSymbol, { field: 'benchmarkSymbol' });
  const peers =
    body.peers === undefined ? [] : asStringArray(body.peers, { field: 'peers', maxItems: 20, maxLen: 16 }).map((p) => asSymbol(p, { field: 'peers' }));
  const importance =
    body.importance === undefined ? 0.5 : asNumber(body.importance, { field: 'importance', min: 0, max: 1 });
  const enabled = body.enabled === undefined ? true : asBool(body.enabled, { field: 'enabled' });

  return { symbol, exchange, companyName, aliases, sector, benchmarkSymbol, peers, importance, enabled };
}

router.put('/', (req, res) => {
  const entry = validateWatchlistEntry(req.body || {});
  res.json({ entry: upsertWatchlist(entry) });
});

router.delete('/:symbol', (req, res) => {
  const symbol = asSymbol(req.params.symbol, { field: 'symbol' });
  removeWatchlist(symbol);
  res.json({ ok: true, watchlist: listWatchlist() });
});

router.post('/seed-defaults', (_req, res) => {
  for (const e of defaultWatchlist()) upsertWatchlist(e);
  res.json({ watchlist: listWatchlist() });
});

export default router;
