import { Router } from 'express';
import { triggerNewsCycle } from '../scheduler.js';
import { listArticles, countArticles } from '../news/store.js';
import { recentCycles } from '../cycles.js';
import { buildQueryPlan } from '../news/queries.js';
import { newsBudgetPlan } from '../quota/planner.js';
import { getSettings } from '../db.js';
import { listWatchlist } from '../watchlist.js';
import { resolveNewsProvider, hasSerpApiKey } from '../providers/news/index.js';
import { resolveSerpApiKey, fetchSerpApiAccount } from '../serpapi.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asyncHandler } from '../security/errors.js';
import { asBool, asInt } from '../security/validate.js';

const router = Router();
const cycleGuard = createConcurrencyGuard(1, 'A news cycle is already running.');

// Preview the query plan + budget without spending anything.
router.get(
  '/plan',
  asyncHandler(async (_req, res) => {
    const settings = getSettings();
    const watchlist = listWatchlist();
    const provider = resolveNewsProvider(settings);
    const account = provider.id === 'serpapi' ? await fetchSerpApiAccount(resolveSerpApiKey()) : null;
    const plan = newsBudgetPlan({ settings, account });
    const specs = buildQueryPlan({ watchlist, settings });
    res.json({
      provider: provider.id,
      hasKey: hasSerpApiKey(),
      plan,
      queries: specs.map((s) => ({ id: s.id, q: s.q, priority: s.priority, tags: s.tags })),
    });
  }),
);

router.post(
  '/run',
  cycleGuard,
  asyncHandler(async (req, res) => {
    const force = req.body?.force === undefined ? true : asBool(req.body.force, { field: 'force' });
    const result = await triggerNewsCycle({ force });
    const summary = result.summary || result;
    res.json({ summary, cycles: recentCycles(5) });
  }),
);

router.get('/articles', (req, res) => {
  const limit = req.query.limit === undefined ? 100 : asInt(req.query.limit, { field: 'limit', min: 1, max: 500 });
  res.json({ count: countArticles(), articles: listArticles({ limit }) });
});

export default router;
