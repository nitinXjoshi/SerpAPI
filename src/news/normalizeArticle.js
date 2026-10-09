import { urlHash, contentHash } from './dedup.js';
import { extractEntities } from './entities.js';

function parseIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize a raw SerpApi news item into the common article record. */
export function normalizeArticle(raw, { spec = {}, watchlist = [], now = new Date() } = {}) {
  const url = raw.link || raw.url || '';
  const headline = String(raw.title || raw.headline || '').trim();
  const snippet = String(raw.snippet || raw.description || '').trim();

  let sourceDomain = '';
  try {
    sourceDomain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    sourceDomain = '';
  }

  const source =
    (typeof raw.source === 'object' ? raw.source?.name : raw.source) || sourceDomain || 'unknown';

  const publishedTs = parseIso(raw.iso_date) || parseIso(raw.date) || null;
  const text = `${headline} ${snippet}`;

  return {
    url,
    urlHash: urlHash(url),
    headline,
    snippet,
    source,
    sourceDomain,
    publishedTs,
    firstSeenTs: now.toISOString(),
    retrievedTs: now.toISOString(),
    contentHash: contentHash(text),
    engine: spec.engine || 'google_news',
    query: spec.q || null,
    symbols: extractEntities(text, watchlist),
    fixture: Boolean(raw._fixture),
    raw,
  };
}

/** Flatten google_news results that group stories under a headline. */
export function flattenNewsItems(items = []) {
  const out = [];
  for (const item of items) {
    if (Array.isArray(item.stories) && item.stories.length) {
      if (item.highlight) out.push(item.highlight);
      for (const s of item.stories) out.push(s);
    } else {
      out.push(item);
    }
  }
  return out;
}
