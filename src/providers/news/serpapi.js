import { callSerpApi } from '../../serpapi.js';

/** SerpApi news provider — one engine call per query spec. */
export const serpapiNewsProvider = {
  id: 'serpapi',
  label: 'SerpApi',
  creditCost() {
    return 1;
  },

  async search(spec, { apiKey } = {}) {
    const params = {};
    if (spec.gl) params.gl = spec.gl;
    if (spec.hl) params.hl = spec.hl;
    // Defence in depth: google_news rejects `so` when `q` is present.
    if (spec.so && !spec.q) params.so = spec.so;
    const { status, data, creditsUsed, cached, error } = await callSerpApi(
      spec.engine || 'google_news',
      spec.q,
      params,
      apiKey,
    );
    return {
      status,
      items: Array.isArray(data?.news_results) ? data.news_results : [],
      data,
      creditsUsed: creditsUsed ?? 0,
      cached: Boolean(cached),
      error: data?.error || error || null,
    };
  },
};
