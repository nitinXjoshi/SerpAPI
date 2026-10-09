/**
 * Deterministic synthetic news provider.
 *
 * Every item carries `_fixture: true` and is labelled as synthetic. It deliberately
 * produces a *cluster* (many outlets, one event), a syndicated near-duplicate and a
 * contradicting company statement, so dedup / clustering / contradiction handling can
 * be exercised without spending SerpApi quota.
 */
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function makeItem({ title, domain, sourceName, hoursAgo, snippet, now }) {
  const d = new Date(now.getTime() - hoursAgo * 3600 * 1000);
  return {
    position: 1,
    title,
    source: { name: sourceName || domain, icon: '' },
    link: `https://${domain}/news/${slug(title)}`,
    snippet: snippet || title,
    iso_date: d.toISOString(),
    date: d.toISOString(),
    thumbnail: '',
    _fixture: true,
  };
}

function companyCluster(symbol, name, now) {
  const n = name || symbol;
  return [
    makeItem({
      title: `US weighs new export restrictions on ${n} chips`,
      domain: 'reuters.com',
      sourceName: 'Reuters',
      hoursAgo: 2.1,
      snippet: `Washington is considering fresh limits on advanced chip sales, people familiar said, a move that could affect ${n}.`,
      now,
    }),
    makeItem({
      title: `US weighs fresh export curbs on ${n}, sources say`,
      domain: 'bloomberg.com',
      sourceName: 'Bloomberg',
      hoursAgo: 1.6,
      snippet: `The administration is weighing additional export controls affecting ${n}, according to people familiar with the matter.`,
      now,
    }),
    makeItem({
      title: `White House considering limits on ${n} AI chip sales`,
      domain: 'cnbc.com',
      sourceName: 'CNBC',
      hoursAgo: 1.2,
      snippet: `Officials are discussing narrower restrictions on AI accelerator exports, with ${n} among the companies affected.`,
      now,
    }),
    makeItem({
      title: `New export rules could hit ${n}, analysts warn`,
      domain: 'theverge.com',
      sourceName: 'The Verge',
      hoursAgo: 0.9,
      snippet: `Analysts said proposed rules could pressure ${n}'s data-centre segment if enacted.`,
      now,
    }),
    makeItem({
      title: `US weighs new export restrictions on ${n} chips`,
      domain: 'finance.yahoo.com',
      sourceName: 'Yahoo Finance',
      hoursAgo: 0.6,
      snippet: `Syndicated report: Washington is considering fresh limits on advanced chip sales.`,
      now,
    }),
    makeItem({
      title: `${n} responds to export restrictions report, sees no material impact`,
      domain: 'company-ir.example',
      sourceName: 'Company IR',
      hoursAgo: 0.3,
      snippet: `${n} said it does not expect a material near-term impact and is monitoring the situation.`,
      now,
    }),
    makeItem({
      title: `Analyst raises ${n} price target on data-centre demand`,
      domain: 'barrons.com',
      sourceName: "Barron's",
      hoursAgo: 52,
      snippet: `A sell-side analyst lifted the price target, citing continued data-centre demand.`,
      now,
    }),
  ];
}

function sectorItems(sector, now) {
  return [
    makeItem({
      title: `${sector} shares slip as export-control talk weighs`,
      domain: 'marketwatch.com',
      sourceName: 'MarketWatch',
      hoursAgo: 1.4,
      snippet: `The ${sector.toLowerCase()} group traded lower amid reports of tighter export rules.`,
      now,
    }),
    makeItem({
      title: `${sector} sector: what the new rules could mean`,
      domain: 'investors.com',
      sourceName: "Investor's Business Daily",
      hoursAgo: 0.8,
      snippet: `Analysts assessed the potential read-through for the ${sector.toLowerCase()} sector.`,
      now,
    }),
  ];
}

function marketItems(now) {
  return [
    makeItem({
      title: 'Stocks edge lower as traders weigh new export-control reports',
      domain: 'cnbc.com',
      sourceName: 'CNBC',
      hoursAgo: 1.1,
      snippet: 'Major averages slipped as technology shares came under pressure.',
      now,
    }),
    makeItem({
      title: 'S&P 500 dips as chip stocks retreat',
      domain: 'reuters.com',
      sourceName: 'Reuters',
      hoursAgo: 0.7,
      snippet: 'The benchmark index eased as semiconductor names weakened.',
      now,
    }),
  ];
}

export const fixtureNewsProvider = {
  id: 'fixture',
  label: 'Fixture (synthetic — not real news)',
  creditCost() {
    return 0;
  },

  async search(spec, { now = new Date() } = {}) {
    let items = [];
    if (spec.tags?.includes('company')) {
      const symbol = spec.symbols?.[0] || 'X';
      const name = spec.companyName || symbol;
      items = companyCluster(symbol, name, now);
    } else if (spec.tags?.includes('sector')) {
      items = sectorItems(spec.tags[1] || 'Sector', now);
    } else {
      items = marketItems(now);
    }
    return { status: 200, items, data: { news_results: items, _fixture: true }, creditsUsed: 0, cached: false, error: null };
  },
};
