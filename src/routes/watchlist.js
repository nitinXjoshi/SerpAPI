import { Router } from 'express';
import {
  listWatchlist,
  upsertWatchlist,
  removeWatchlist,
  defaultWatchlist,
} from '../watchlist.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ watchlist: listWatchlist() });
});

router.put('/', (req, res) => {
  try {
    res.json({ entry: upsertWatchlist(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:symbol', (req, res) => {
  removeWatchlist(req.params.symbol);
  res.json({ ok: true, watchlist: listWatchlist() });
});

router.post('/seed-defaults', (_req, res) => {
  for (const e of defaultWatchlist()) upsertWatchlist(e);
  res.json({ watchlist: listWatchlist() });
});

export default router;
