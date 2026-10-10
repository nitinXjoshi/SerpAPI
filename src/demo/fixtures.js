/**
 * Authored demo analysis.
 *
 * IMPORTANT: this is NOT model output. In fixture-only demo mode no Ollama request is
 * made, so judges still get a populated investigation view from these hand-written,
 * evidence-linked samples. Every result is stamped `sample: true` and rendered with a
 * "sample" label so it is never mistaken for a live AI analysis.
 *
 * Claims cite the *actual* fixture article URLs from the event, so no citation is invented.
 */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function buildSampleModel(event, articles) {
  const by = (re) => articles.find((a) => re.test(`${a.source || ''} ${a.sourceDomain || ''}`));
  const wire = by(/reuters|bloomberg|cnbc|marketwatch/i) || articles[0];
  const company = by(/company|ir\b|--ir/i);
  const analyst = by(/verge|barron|investor/i) || articles.find((a) => a !== wire);
  const domains = [...new Set(articles.map((a) => a.sourceDomain).filter(Boolean))];

  const companyName = event.symbols?.[0] || 'the company';

  const keyClaims = [
    {
      claim: `${wire?.source || 'Coverage'} reports that new export restrictions affecting ${companyName} are being weighed.`,
      attribution: 'reported',
      source_url: wire?.url || '',
    },
  ];
  if (company) {
    keyClaims.push({
      claim: `${company.source} states it does not expect a material near-term impact.`,
      attribution: 'company statement',
      source_url: company.url,
    });
  }
  if (analyst && analyst.url !== wire?.url) {
    keyClaims.push({
      claim: `${analyst.source} notes the proposals could pressure data-centre demand if enacted.`,
      attribution: 'analytical',
      source_url: analyst.url,
    });
  }

  const contradictions = company
    ? [
        `${company.source} (company statement) sees no material impact, while ${wire?.source} reports the restrictions are actively under consideration.`,
      ]
    : [];

  const confidence = clamp(0.3 + 0.1 * Math.max(0, domains.length - 1), 0.3, 0.75);

  return {
    sample: true,
    generatedBy: 'demo-fixture (authored, not model-generated)',
    event_title: event.title,
    category: 'regulation',
    summary:
      `A cluster of reports indicates that fresh export restrictions are being considered that would affect ${companyName}. ` +
      `Coverage spans ${domains.length} distinct source(s) covering the same development; no primary/regulatory source is present in the cluster. ` +
      (company
        ? `The company has responded publicly, and its statement conflicts with the reported measures.`
        : `No company response is present in the cluster.`),
    key_claims: keyClaims,
    entities: (event.symbols || []).map((s) => ({ symbol: s, name: '' })),
    novelty: `First detected ${event.firstSeenTs}; ${articles.length} article(s) across ${domains.length} source(s).`,
    contradictions,
    impact: {
      direction: 'down',
      magnitude: 'medium',
      rationale:
        'Export restrictions could reduce a portion of addressable demand, but the scope is unconfirmed and the read-through is uncertain.',
    },
    confidence,
    uncertainty_notes: [
      'The scope, timing and finality of any restrictions are unconfirmed.',
      'No primary/regulatory source is present in the evidence cluster.',
      company ? 'The company statement conflicts with the reported measures.' : 'No company response is present.',
      'No historical price reaction for this exact scenario is available.',
    ],
    follow_up_queries: [
      'Primary/regulatory source for the reported export restrictions',
      'Company earnings-call commentary on export exposure',
      'Peer and supplier statements on the same regulation',
    ],
  };
}
