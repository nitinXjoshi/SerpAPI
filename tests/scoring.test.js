import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEvent } from '../src/scoring/opportunity.js';
import { getDefaultSettings } from '../src/config.js';

const settings = getDefaultSettings();
const now = new Date('2025-05-22T14:12:00Z');

function market(overrides = {}) {
  return {
    NVDA: {
      symbol: 'NVDA',
      changePct: -5.4,
      divergence: -4.4,
      peerDivergence: -4.8,
      marketTs: '2025-05-22T14:10:00Z',
      stale: false,
      ...overrides,
    },
  };
}

test('strong anomaly with corroboration scores high and reads as an opportunity', () => {
  const r = scoreEvent({
    event: { symbols: ['NVDA'], firstSeenTs: '2025-05-22T13:38:00Z', model: { confidence: 0.6, contradictions: [] } },
    market: market(),
    evidence: { articleCount: 6, independentReports: 5, independentSources: 5, contradictions: 0, hasOfficialSource: true },
    settings,
    now,
  });
  assert.ok(r.score >= 70, `expected high score, got ${r.score}`);
  assert.equal(r.decision, 'potential_opportunity');
  assert.ok(r.components.relativeDivergence > 0.9);
});

test('identical news with a flat price scores low (no dislocation)', () => {
  const r = scoreEvent({
    event: { symbols: ['AAPL'], firstSeenTs: '2025-05-22T13:38:00Z', model: null },
    market: { AAPL: { symbol: 'AAPL', changePct: -0.2, divergence: -0.1, peerDivergence: 0.1, marketTs: '2025-05-22T14:10:00Z', stale: false } },
    evidence: { articleCount: 6, independentReports: 5, independentSources: 5, contradictions: 0 },
    settings,
    now,
  });
  assert.ok(r.score < 50, `expected low score, got ${r.score}`);
  assert.notEqual(r.decision, 'potential_opportunity');
});

test('no market observation means insufficient evidence', () => {
  const r = scoreEvent({
    event: { symbols: ['NVDA'], firstSeenTs: now.toISOString(), model: null },
    market: {},
    evidence: { articleCount: 3, independentReports: 2 },
    settings,
    now,
  });
  assert.equal(r.decision, 'insufficient_evidence');
  assert.equal(r.components.priceAnomaly, 0);
});

test('unresolved contradictions cap a high score at WATCH', () => {
  const r = scoreEvent({
    event: { symbols: ['NVDA'], firstSeenTs: '2025-05-22T13:38:00Z', model: { confidence: 0.4, contradictions: ['A', 'B'] } },
    market: market(),
    evidence: { articleCount: 6, independentReports: 5, independentSources: 5, contradictions: 2, hasOfficialSource: true },
    settings,
    now,
  });
  assert.equal(r.decision, 'watch');
  assert.ok(r.gates.length >= 1);
});

test('stale observations lose freshness and add uncertainty', () => {
  const stale = scoreEvent({
    event: { symbols: ['NVDA'], firstSeenTs: '2025-05-22T13:38:00Z', model: null },
    market: { NVDA: { symbol: 'NVDA', changePct: -5.4, divergence: -4.4, peerDivergence: -4.8, marketTs: '2025-05-21T14:10:00Z', stale: true } },
    evidence: { articleCount: 6, independentReports: 5, independentSources: 5, contradictions: 0 },
    settings,
    now,
  });
  const fresh = scoreEvent({
    event: { symbols: ['NVDA'], firstSeenTs: '2025-05-22T13:38:00Z', model: null },
    market: market(),
    evidence: { articleCount: 6, independentReports: 5, independentSources: 5, contradictions: 0 },
    settings,
    now,
  });
  assert.ok(stale.uncertainty > fresh.uncertainty);
  assert.ok(stale.score < fresh.score);
});

test('score is bounded and always documents that it is not a probability', () => {
  const r = scoreEvent({
    event: { symbols: ['NVDA'], firstSeenTs: now.toISOString(), model: null },
    market: market(),
    evidence: { articleCount: 50, independentReports: 30, independentSources: 30 },
    settings,
    now,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.match(r.disclaimer, /not a probability/i);
});
