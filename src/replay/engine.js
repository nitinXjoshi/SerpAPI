import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jaccard, overlap, shingles, tokenize, urlHash } from '../news/dedup.js';
import { getSettings } from '../db.js';
import { scoreEvent } from '../scoring/opportunity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

export function listScenarios() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const s = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8'));
      return { id: s.id, title: s.title, description: s.description, synthetic: Boolean(s.synthetic) };
    });
}

function loadScenario(id) {
  const file = path.join(FIXTURE_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`Unknown scenario: ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** In-memory clustering (no DB writes) so replay never mutates live state. */
function clusterInMemory(articles, { threshold = 0.5, tokenThreshold = 0.25 } = {}) {
  const clusters = [];
  const seenUrls = new Set();
  for (const a of articles) {
    const h = urlHash(a.url);
    if (seenUrls.has(h)) continue; // exact URL dedup
    seenUrls.add(h);
    const sh = shingles(a.title);
    const tk = new Set(tokenize(`${a.title} ${a.snippet || ''}`));
    let best = null;
    let bestSim = 0;
    for (const c of clusters) {
      const sharesSymbol = (a.symbols || []).some((s) => c.symbols.includes(s));
      if (!sharesSymbol) continue;
      let shingleSim = 0;
      for (const t of c.titleShingles) shingleSim = Math.max(shingleSim, jaccard(sh, t));
      const tokenSim = overlap(tk, c.tokens);
      const strong = shingleSim >= threshold;
      const byToken = tokenSim >= tokenThreshold;
      const score = Math.max(strong ? shingleSim : 0, byToken ? tokenSim : 0);
      if (score > bestSim) {
        bestSim = score;
        best = score > 0 ? c : null;
      }
    }
    if (best) {
      best.articles.push(a);
      best.symbols = [...new Set([...best.symbols, ...(a.symbols || [])])];
      best.titleShingles.push(sh);
      best.tokens = new Set([...best.tokens, ...tk]);
    } else {
      clusters.push({ articles: [a], symbols: [...(a.symbols || [])], titleShingles: [sh], tokens: tk, firstTs: a.ts });
    }
  }
  // largest cluster first
  clusters.sort((x, y) => y.articles.length - x.articles.length);
  return clusters;
}

function latestAtOrBefore(observations, symbol, iso) {
  const t = Date.parse(iso);
  let best = null;
  for (const o of observations) {
    if (o.symbol !== symbol) continue;
    if (Date.parse(o.ts) <= t) {
      if (!best || Date.parse(o.ts) > Date.parse(best.ts)) best = o;
    }
  }
  return best;
}

/**
 * Replay a scenario with NO look-ahead: only observations and articles published at or
 * before decisionTime are used to cluster evidence and score the outcome.
 */
export function runReplay(scenarioId, { now } = {}) {
  const s = loadScenario(scenarioId);
  const decisionTime = s.decisionTime;
  const settings = getSettings();

  const knownObs = s.observations.filter((o) => Date.parse(o.ts) <= Date.parse(decisionTime));
  const knownArticles = s.articles.filter((a) => Date.parse(a.ts) <= Date.parse(decisionTime));

  // Market context at the decision point.
  const market = {};
  const prev = s.previousClose || {};
  const rows = [];
  for (const symbol of Object.keys(prev)) {
    const o = latestAtOrBefore(knownObs, symbol, decisionTime);
    if (!o) continue;
    const changePct = ((o.price - prev[symbol]) / prev[symbol]) * 100;
    rows.push({ symbol, price: o.price, changePct, ts: o.ts });
  }
  const bySym = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  for (const r of rows) {
    const benchSym = s.benchmarks?.[r.symbol];
    const bench = benchSym ? bySym[benchSym] : null;
    const divergence = bench ? round2(r.changePct - bench.changePct) : null;
    const peers = (s.peers?.[r.symbol] || []).map((p) => bySym[p]).filter(Boolean);
    const peerAvg = peers.length ? peers.reduce((a, b) => a + b.changePct, 0) / peers.length : null;
    market[r.symbol] = {
      ...r,
      marketTs: r.ts,
      benchmarkSymbol: benchSym || null,
      benchmarkChangePct: bench ? round2(bench.changePct) : null,
      divergence,
      peerDivergence: peerAvg == null ? null : round2(r.changePct - peerAvg),
      stale: false,
    };
  }

  // Cluster the evidence known at decision time.
  const clusters = clusterInMemory(knownArticles);
  const primaryCluster = clusters[0] || { articles: [], symbols: [], firstTs: decisionTime };
  const symbols = [...new Set([...(s.watchSymbols || []), ...primaryCluster.symbols])].filter(
    (sym) => market[sym],
  );
  const domains = new Set(primaryCluster.articles.map((a) => a.domain));
  const contentGroups = new Set(primaryCluster.articles.map((a) => a.contentHash || urlHash(a.url)));

  const event = { symbols, firstSeenTs: primaryCluster.firstTs, model: null };
  const evidence = {
    articleCount: primaryCluster.articles.length,
    independentReports: contentGroups.size,
    independentSources: domains.size,
    contradictions: 0,
    hasOfficialSource: [...domains].some((d) => /company-ir|\.gov$|sec\.gov/i.test(d)),
  };
  const scoring = scoreEvent({ event, market, evidence, settings, now: new Date(decisionTime) });

  // Timeline of everything known at or before the decision (no look-ahead).
  const steps = [];
  for (const a of knownArticles) {
    steps.push({ ts: a.ts, kind: 'news', label: `${a.source}: ${a.title}` });
  }
  for (const o of knownObs) {
    steps.push({ ts: o.ts, kind: 'price', label: `${o.symbol} ${o.price}` });
  }
  steps.push({ ts: decisionTime, kind: 'decision', label: `Decision point — ${scoring.decision} (score ${scoring.score})` });
  steps.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const primary = scoring.primarySymbol || symbols[0] || null;
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    synthetic: Boolean(s.synthetic),
    decisionTime,
    steps,
    events: clusters.map((c) => ({
      title: c.articles[0]?.title || '(untitled)',
      articleCount: c.articles.length,
      symbols: c.symbols,
      sources: [...new Set(c.articles.map((a) => a.domain))],
    })),
    summary: {
      articlesKnown: knownArticles.length,
      clusters: clusters.length,
      independentSources: domains.size,
      primarySymbol: primary,
      divergence: primary ? market[primary]?.divergence ?? null : null,
      decision: scoring.decision,
      score: scoring.score,
      confidence: scoring.confidence,
      components: scoring.components,
      notes: scoring.notes,
      gates: scoring.gates,
      disclaimer: scoring.disclaimer,
    },
    postDecision: s.postDecision || [],
    lookaheadNotice:
      'Scoring used only data timestamped at or before decisionTime. Post-decision observations are shown for evaluation only.',
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
