import crypto from 'node:crypto';

const TRACKING_RE =
  /^(utm_|gclid|fbclid|mc_|ref$|ref_src|igshid|cmp|campaign|s_kwcid|spm|_hs|vero_|oly_|ncid|mod|CMP)/i;

export function canonicalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_RE.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

export function urlHash(url) {
  return crypto.createHash('sha256').update(canonicalizeUrl(url)).digest('hex');
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'new', 'says', 'said', 'will', 'has', 'have', 'had', 'after', 'over', 'amid',
  'us', 'its',
]);

/** Very light plural stemmer — enough to match "chips"/"chip", "restrictions"/"restriction". */
function stem(token) {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export function shingles(text, k = 3) {
  const tokens = tokenize(text);
  const set = new Set();
  if (tokens.length < k) {
    if (tokens.length) set.add(tokens.join(' '));
    return set;
  }
  for (let i = 0; i <= tokens.length - k; i++) set.add(tokens.slice(i, i + k).join(' '));
  return set;
}

export function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}

/**
 * Overlap coefficient |A∩B| / min(|A|,|B|). More robust than Jaccard when the two
 * token sets differ a lot in size (short headline vs headline+snippet).
 */
export function overlap(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const x of small) if (large.has(x)) inter++;
  return inter / small.size;
}

export function contentHash(text) {
  return crypto.createHash('sha256').update(tokenize(text).join(' ')).digest('hex');
}

/** True when two headlines describe (almost) the same event. */
export function titlesAreSimilar(a, b, threshold = 0.6) {
  return jaccard(shingles(a), shingles(b)) >= threshold;
}
