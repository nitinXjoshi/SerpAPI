import { getSettings } from '../db.js';
import { listWatchlist } from '../watchlist.js';
import { latestObservations } from '../market/store.js';
import { analyzeWatchlist } from '../market/analyze.js';
import { getEvent, getEventArticles, setEventScore, notifyOnce } from '../events/store.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round2 = (x) => Math.round(x * 100) / 100;

const OFFICIAL_RE = /(company-ir|\.gov$|sec\.gov|investor|press release|ir\.)/i;

/**
 * Deterministic opportunity scoring. Pure function — no I/O, no LLM.
 *
 *   score = 100 · clamp( Σ weightᵢ · componentᵢ − w_uncertainty · uncertainty − w_exec · executionCost )
 *
 * Every component is normalized to [0,1]. The output is a ranking score, NOT a calibrated
 * probability of profit. Directional news is never assumed to be bullish or bearish.
 */
export function scoreEvent({ event = {}, market = {}, evidence = {}, settings, now = new Date() } = {}) {
  const w = settings.scoring.weights;
  const th = settings.scoring.thresholds;
  const anomalyPct = settings.scoring.anomalyPct ?? 4;
  const divergencePct = settings.scoring.divergencePct ?? 3;

  const symbols = event.symbols || [];

  // Primary symbol = watchlist symbol with the largest absolute move.
  let primary = null;
  let primaryRow = null;
  let bestAbs = -1;
  for (const s of symbols) {
    const r = market[s];
    if (r && r.changePct != null && Math.abs(r.changePct) > bestAbs) {
      bestAbs = Math.abs(r.changePct);
      primary = s;
      primaryRow = r;
    }
  }
  const hasMarket = Boolean(primaryRow);

  const priceAnomaly = hasMarket ? clamp01(Math.abs(primaryRow.changePct) / anomalyPct) : 0;
  const relativeDivergence =
    hasMarket && primaryRow.divergence != null ? clamp01(Math.abs(primaryRow.divergence) / divergencePct) : 0;
  const crossAssetConfirmation =
    hasMarket && primaryRow.peerDivergence != null ? clamp01(Math.abs(primaryRow.peerDivergence) / divergencePct) : 0;

  const ageHours = Math.max(0, (now.getTime() - Date.parse(event.firstSeenTs)) / 3600000);
  const articleCount = evidence.articleCount || 0;
  const noveltyFactor = articleCount <= 3 ? 1 : articleCount <= 8 ? 0.75 : 0.5;
  const eventNovelty = clamp01(1 - ageHours / 24) * noveltyFactor;

  const relevance = hasMarket && symbols.includes(primary) ? 1 : 0.5;

  const independentReports = evidence.independentReports || 0;
  const hasOfficial = Boolean(evidence.hasOfficialSource);
  const sourceStrength = clamp01(independentReports / 4) * 0.8 + (hasOfficial ? 0.2 : 0);

  const obsAgeMin = primaryRow?.marketTs ? (now.getTime() - Date.parse(primaryRow.marketTs)) / 60000 : Infinity;
  const freshness = clamp01(1 - obsAgeMin / (24 * 60));

  const contradictions = evidence.contradictions || 0;
  let uncertainty = 0;
  if (!event.model) uncertainty += 0.3;
  if (contradictions > 0) uncertainty += 0.35;
  if (independentReports < 2) uncertainty += 0.3;
  if (primaryRow?.stale) uncertainty += 0.2;
  uncertainty = clamp01(uncertainty);

  const executionCost = 0; // no reliable spread/liquidity source in this phase

  const components = {
    priceAnomaly,
    relativeDivergence,
    eventNovelty,
    relevance,
    sourceStrength,
    crossAssetConfirmation,
    freshness,
  };

  const positive =
    w.priceAnomaly * priceAnomaly +
    w.relativeDivergence * relativeDivergence +
    w.eventNovelty * eventNovelty +
    w.relevance * relevance +
    w.sourceStrength * sourceStrength +
    w.crossAssetConfirmation * crossAssetConfirmation +
    w.freshness * freshness;
  const raw = positive - w.uncertainty * uncertainty - w.executionCost * executionCost;
  const score = Math.round(clamp01(raw) * 100);

  let decision;
  if (!hasMarket || articleCount === 0) decision = 'insufficient_evidence';
  else if (score >= th.opportunity) decision = 'potential_opportunity';
  else if (score >= th.watch) decision = 'watch';
  else if (score >= th.insufficient) decision = 'insufficient_evidence';
  else decision = 'no_trade';

  const gates = [];
  if (contradictions >= 2 || uncertainty >= 0.7) {
    if (decision === 'potential_opportunity') {
      decision = 'watch';
      gates.push('Capped at WATCH: unresolved contradictions or high uncertainty.');
    }
  }
  if (!event.model) gates.push('No model investigation yet — components use defaults.');

  const modelConf = event.model?.confidence ?? 0.3;
  const confidence = Math.round(clamp01(sourceStrength * 0.45 + freshness * 0.25 + modelConf * 0.3) * 100);

  const notes = [];
  notes.push(`${primary ? `${primary} moved ${(primaryRow.changePct ?? 0).toFixed(2)}%` : 'No market observation'}.`);
  if (hasMarket && primaryRow.divergence != null) notes.push(`Divergence vs benchmark: ${primaryRow.divergence.toFixed(2)}%.`);
  notes.push(`${articleCount} article(s) from ${independentReports} independent report(s).`);
  if (event.model?.impact?.direction && event.model.impact.direction !== 'unclear') {
    notes.push(`Model reads the news direction as ${event.model.impact.direction} (not treated as a prediction).`);
  }

  return {
    score,
    decision,
    confidence,
    uncertainty: round2(uncertainty),
    executionCost,
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round2(v)])),
    weights: w,
    primarySymbol: primary,
    gates,
    notes,
    disclaimer: 'Ranking score, not a probability of profit. Human decision required.',
  };
}

/** Assemble inputs for an event, score it, persist, and notify on decision changes. */
export function scoreEventById(eventId, { now = new Date() } = {}) {
  const settings = getSettings();
  const event = getEvent(eventId);
  if (!event) return null;

  const watchlist = listWatchlist();
  const symbols = new Set(event.symbols || []);
  for (const w of watchlist) {
    if ((event.symbols || []).includes(w.symbol)) {
      if (w.benchmarkSymbol) symbols.add(String(w.benchmarkSymbol).toUpperCase());
      for (const p of w.peers || []) symbols.add(String(p).toUpperCase());
    }
  }
  const latest = latestObservations([...symbols]);
  const rows = analyzeWatchlist({ watchlist, latestBySymbol: latest, thresholds: settings.scoring });
  const market = {};
  for (const r of rows) market[r.symbol] = r;

  const articles = getEventArticles(eventId);
  const contentGroups = new Set(articles.map((a) => a.contentHash).filter(Boolean));
  const domains = new Set(articles.map((a) => a.sourceDomain).filter(Boolean));
  const hasOfficialSource = [...domains].some((d) => OFFICIAL_RE.test(d)) ||
    articles.some((a) => OFFICIAL_RE.test(String(a.source || '')));

  const evidence = {
    articleCount: articles.length,
    independentReports: contentGroups.size,
    independentSources: domains.size,
    contradictions: event.model?.contradictions?.length || 0,
    hasOfficialSource,
  };

  const result = scoreEvent({ event, market, evidence, settings, now });
  setEventScore(eventId, {
    score: result.score,
    decision: result.decision,
    confidence: result.confidence,
    evidence: { ...result, evidence },
  });

  if (
    (result.decision === 'potential_opportunity' || result.decision === 'watch') &&
    result.score >= (settings.notifications?.minScore ?? 40)
  ) {
    notifyOnce({ eventId, dedupeKey: `event:${eventId}:${result.decision}` });
  }

  return result;
}
