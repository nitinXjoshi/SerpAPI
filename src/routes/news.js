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

const router = Router();

// Preview the query plan + budget without spending anything.
router.get('/plan', async (_req, res) => {
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
});

router.post('/run', async (req, res) => {
  const force = req.body?.force !== false;
  try {
    const result = await triggerNewsCycle({ force });
    const summary = result.summary || result;
    res.json({ summary, cycles: recentCycles(5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/articles', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ count: countArticles(), articles: listArticles({ limit }) });
});

export default router;
