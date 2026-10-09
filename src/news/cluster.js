import crypto from 'node:crypto';
import { jaccard, overlap, shingles, tokenize } from './dedup.js';
import * as EventStore from '../events/store.js';

export const WINDOW_HOURS = 48;
export const SIM_THRESHOLD = 0.5; // headline shingle similarity → same story, reworded
export const TOKEN_THRESHOLD = 0.25; // headline+snippet token overlap → same topic coverage

function makeClusterKey(symbols, headline) {
  const tokens = tokenize(headline).slice(0, 5).join('-');
  const h = crypto.createHash('sha1').update(`${symbols[0] || 'GEN'}|${tokens}`).digest('hex').slice(0, 10);
  return `${symbols[0] || 'GEN'}:${h}`;
}

function union(a, b) {
  return [...new Set([...(a || []), ...(b || [])])];
}

function setUnion(a, b) {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}

/**
 * Deterministic event clustering.
 *
 * An article joins an existing event when it shares a symbol AND either:
 *   - its headline is highly similar (shingles) to one already in the event, or
 *   - its headline tokens overlap the event's aggregate headline tokens above a threshold
 *     (this groups reworded coverage of the same story into one event).
 * Otherwise it starts a new event. Events are updated in place — many publications
 * about one event become a single event with multiple evidence sources.
 */
export function clusterArticles(articles, {
  now = new Date(),
  windowHours = WINDOW_HOURS,
  threshold = SIM_THRESHOLD,
  tokenThreshold = TOKEN_THRESHOLD,
} = {}) {
  const results = [];
  const sinceIso = new Date(now.getTime() - windowHours * 3600 * 1000).toISOString();
  const candidates = EventStore.recentEventCandidates({ sinceIso });

  for (const art of articles) {
    const artShingles = shingles(art.headline);
    const artTokens = new Set(tokenize(`${art.headline} ${art.snippet || ''}`));
    const symbols = art.symbols || [];
    const artTime = Date.parse(art.publishedTs || art.firstSeenTs || now.toISOString());

    let strongEv = null;
    let strongSim = 0;
    let tokenEv = null;
    let tokenSim = 0;

    for (const ev of candidates) {
      if (!(symbols.length > 0 && ev.symbols.some((s) => symbols.includes(s)))) continue;
      const evTime = Date.parse(ev.lastUpdatedTs);
      const ageHours = Number.isFinite(evTime) ? Math.abs(evTime - artTime) / 3600000 : Infinity;
      if (ageHours > windowHours) continue;

      let sh = 0;
      for (const ts of ev.titleShingles) {
        const s = jaccard(artShingles, ts);
        if (s > sh) sh = s;
      }
      if (sh >= threshold && sh > strongSim) {
        strongSim = sh;
        strongEv = ev;
      }

      const tk = overlap(artTokens, ev.tokens);
      if (tk >= tokenThreshold && tk > tokenSim) {
        tokenSim = tk;
        tokenEv = ev;
      }
    }

    const match = strongEv || tokenEv;
    const similarity = strongEv ? strongSim : tokenSim;
    const tier = strongEv ? 'strong' : tokenEv ? 'token' : 'new';

    if (match) {
      EventStore.attachArticle(match.id, art.urlHash, false);
      const mergedSymbols = union(match.symbols, symbols);
      EventStore.updateEvent(match.id, { lastUpdatedTs: art.firstSeenTs, symbols: mergedSymbols });
      match.titleShingles.push(artShingles);
      match.tokens = setUnion(match.tokens, artTokens);
      match.symbols = mergedSymbols;
      match.lastUpdatedTs = art.firstSeenTs;
      match.articleCount += 1;
      results.push({ eventId: match.id, created: false, urlHash: art.urlHash, similarity: round(similarity), tier });
    } else {
      const ev = EventStore.createEvent({
        clusterKey: makeClusterKey(symbols, art.headline),
        title: art.headline,
        category: 'other',
        symbols,
        firstSeenTs: art.firstSeenTs,
        lastUpdatedTs: art.firstSeenTs,
      });
      EventStore.attachArticle(ev.id, art.urlHash, true);
      candidates.push({
        id: ev.id,
        symbols,
        lastUpdatedTs: art.firstSeenTs,
        titleShingles: [artShingles],
        tokens: artTokens,
        articleCount: 1,
      });
      results.push({ eventId: ev.id, created: true, urlHash: art.urlHash, similarity: 0, tier: 'new' });
    }
  }

  return results;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Post-pass: merge events that describe the same story but were created as separate
 * clusters (greedy clustering can start a competing cluster mid-stream).
 */
export function consolidateEvents({
  now = new Date(),
  windowHours = WINDOW_HOURS,
  tokenThreshold = TOKEN_THRESHOLD,
  simThreshold = SIM_THRESHOLD,
} = {}) {
  const sinceIso = new Date(now.getTime() - windowHours * 3600 * 1000).toISOString();
  const candidates = EventStore.recentEventCandidates({ sinceIso });
  let merged = 0;
  let changed = true;

  while (changed) {
    changed = false;
    outer: for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (!(a.symbols.length && a.symbols.some((s) => b.symbols.includes(s)))) continue;
        const gap =
          Math.abs(Date.parse(a.lastUpdatedTs) - Date.parse(b.lastUpdatedTs)) / 3600000;
        if (gap > windowHours) continue;

        const tk = overlap(a.tokens, b.tokens);
        let sh = 0;
        for (const sa of a.titleShingles) {
          for (const sb of b.titleShingles) {
            const s = jaccard(sa, sb);
            if (s > sh) sh = s;
          }
        }
        if (tk >= tokenThreshold || sh >= simThreshold) {
          EventStore.mergeEvents(a.id, b.id);
          a.tokens = setUnion(a.tokens, b.tokens);
          a.titleShingles.push(...b.titleShingles);
          a.symbols = union(a.symbols, b.symbols);
          a.lastUpdatedTs =
            Date.parse(b.lastUpdatedTs) > Date.parse(a.lastUpdatedTs) ? b.lastUpdatedTs : a.lastUpdatedTs;
          candidates.splice(j, 1);
          merged += 1;
          changed = true;
          break outer;
        }
      }
    }
  }

  return { merged, events: candidates.length };
}
