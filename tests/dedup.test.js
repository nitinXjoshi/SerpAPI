import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, urlHash, jaccard, overlap, shingles, titlesAreSimilar } from '../src/news/dedup.js';

test('canonicalizeUrl strips tracking params, fragment and www', () => {
  const a = canonicalizeUrl('https://www.example.com/news/story?utm_source=x&id=5#top');
  const b = canonicalizeUrl('https://example.com/news/story?id=5');
  assert.equal(a, b);
});

test('urlHash is stable across tracking noise (duplicate URL detection)', () => {
  const h1 = urlHash('https://example.com/a?utm_campaign=newsletter');
  const h2 = urlHash('https://www.example.com/a/');
  assert.equal(h1, h2);
});

test('urlHash differs for different URLs', () => {
  assert.notEqual(urlHash('https://example.com/a'), urlHash('https://example.com/b'));
});

test('jaccard and overlap behave correctly', () => {
  const a = new Set(['x', 'y', 'z']);
  const b = new Set(['x', 'y', 'z']);
  assert.equal(jaccard(a, b), 1);
  assert.equal(overlap(a, b), 1);
  const c = new Set(['x', 'y']);
  assert.equal(overlap(a, c), 1); // containment
  assert.ok(jaccard(a, c) < 1);
});

test('near-duplicate headlines are detected, unrelated ones are not', () => {
  assert.equal(
    titlesAreSimilar(
      'US weighs new export restrictions on chipmaker chips',
      'US weighs new export restrictions on chipmaker chips',
    ),
    true,
  );
  assert.equal(
    titlesAreSimilar(
      'Analyst raises price target on data-centre demand',
      'Company reports record quarterly revenue',
    ),
    false,
  );
});

test('shingles produce k-grams', () => {
  const s = shingles('alpha beta gamma delta', 3);
  assert.equal(s.size, 2);
});
