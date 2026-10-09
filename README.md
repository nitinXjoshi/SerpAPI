# Google Finance Viewer

A small local web app for two SerpAPI engines — [Google Finance](https://serpapi.com/google-finance-api)
(`engine=google_finance`) and [Google News](https://serpapi.com/google-news-api) (`engine=google_news`).
Type a stock / index / fund / currency / future and it renders **everything** the API returns in a
readable, navigable dashboard, including the latest news for the instrument you selected.

## What it shows

| Section | Source | Notes |
| --- | --- | --- |
| Overview | `summary` | Live price, day change, after-hours session, exchange, timestamp |
| Price chart | `graph` | Line chart with 1D/5D/1M/6M/YTD/1Y/5Y/MAX range switch |
| Key stats | `knowledge_graph.key_stats` | Previous close, day/year range, market cap, tags, climate score |
| About | `knowledge_graph.about` | Company profile, source link, CEO / employees / HQ info |
| Financials | `financials` | Income statement, balance sheet, cash flow — Quarterly/Annual switch |
| News | `news_results` | Contextual news from the Google Finance page |
| Latest news | `engine=google_news` | Full headline feed for the selected instrument, newest first |
| Related | `discover_more`, `suggestions`, `markets` | Clickable tickers that trigger a new search |
| Raw JSON | full response | The complete Google Finance payload, copyable |

Everything is clickable: related tickers and "did you mean" suggestions run a new lookup, and the
**Browse stocks** panel lists 260+ instruments you can search by symbol, name, or category.

## How a lookup works

1. **Search / pick** an instrument — type in the box (with live recommendations from SerpAPI),
   or click any row in the **Browse stocks** table, or click a related ticker.
2. **Dashboard** renders the full Google Finance response for it.
3. **Latest news** is fetched in parallel from the Google News engine, using the company name
   (e.g. `Apple Inc`), sorted by date.

## Architecture

- **`server.js`** — Express server that serves the UI and proxies three endpoints to SerpAPI:
  `/api/search` and `/api/suggest` (Google Finance) and `/api/news` (Google News). Your API key
  stays on the server (read from `.env`), so it is never exposed in the page. Responses are cached
  in memory for 10 minutes to save credits.
- **`public/`** — the page itself (`index.html`, `styles.css`, `app.js`, `catalog.js`), no build step.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your SerpAPI key. Either copy `.env.example` to `.env` and fill it in:

   ```bash
   cp .env.example .env
   # then edit .env and set SERPAPI_API_KEY=...
   ```

   ...or just paste the key into the **Settings** panel in the top-right of the page
   (kept in your browser only).

3. Start it:

   ```bash
   npm start
   ```

4. Open <http://localhost:3000>.

## Usage

- Enter a ticker **with its exchange** for best results — `AAPL:NASDAQ`, `WMT:NYSE`,
  `BRK.B:NYSE`, `.DJI:INDEXDJX`. Currencies and crypto work as pairs (`EUR-USD`, `BTC-USD`).
- Start typing to get live recommendations, or browse the **Browse stocks** list and click an
  instrument to load it.
- Selecting an instrument loads its **Latest news** from the Google News engine automatically.
- Use the range buttons above the chart to change the graph window. The first load is the
  full dataset; changing the range runs one extra request for the graph (cached afterwards).

## Notes

- Requires Node 18+ (uses the built-in `fetch`).
- Set `PORT` in `.env` to change the port (default `3000`).
- `npm run dev` restarts the server automatically on file changes.
- **Credits:** each lookup spends one Google Finance search, plus one Google News search for the
  headlines, plus one per (debounced) autocomplete query. Repeat queries within 10 minutes are
  served from the local cache and cost nothing.

## Source

Built against the SerpAPI [Google Finance API](https://serpapi.com/google-finance-api) and
[Google News API](https://serpapi.com/google-news-api).
