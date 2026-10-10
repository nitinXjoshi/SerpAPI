# InfoMark — 3-minute demo script

A tight, presenter-friendly walkthrough for a screen recording. Timings are a guide.

## Before you record

```bash
git clone https://github.com/nitinXjoshi/SerpAPI.git
cd SerpAPI
npm ci                 # or: npm install
npm run demo
```

Then open **http://127.0.0.1:3000/dashboard.html**

That is all. No API keys, no `.env`, no database setup, no Ollama. The demo binds to
loopback only and runs entirely on fixture data with **zero** paid or external calls.

On-screen, the yellow **DEMO MODE** banner and the `DEMO · read-only` chip make the data
provenance obvious at all times.

---

## 0:00 — The problem (20s)

> "When a company-specific event breaks, the information a trader needs is scattered: the price
> move, the peer and sector reaction, dozens of near-duplicate articles, and no quick way to tell
> corroboration from noise. InfoMark closes that gap: it detects the anomaly, gathers and groups
> the evidence with SerpApi, and produces an evidence-linked, explainable read — or an honest
> 'not enough evidence'."

State plainly: this is an **information-arbitrage assistant**, not a price predictor, and it never trades.

## 0:20 — Market Radar (30s)

Open on **Market Radar**.

- Point at the watchlist: price, change, and **relative divergence vs benchmark and peers**.
- Highlight **NVDA**: an anomaly chip, ~−5.9%, and a large negative divergence vs its sector
  benchmark. That is the signal that starts an investigation.
- Call out the **freshness** column: every observation carries its own timestamp and a
  `fresh`/`stale` badge. Say: "stale data is never shown as live."
- Note the top-right status bar: `DEMO · read-only`, `fixture data`, `ollama off`.

## 0:50 — Event Feed (40s)

Click **Event Feed**.

- One row per **clustered event**, not per article. Point out the evidence line:
  *"7 articles · 7 independent · 0 syndicated."*
- Explain the honest grouping: duplicate and syndicated copies collapse into the same event, so
  repeated copies of one report never inflate corroboration.
- Show the **decision spectrum** in one screen: `potential_opportunity` (NVDA, high score),
  `watch` (AMD), and `insufficient_evidence` for names that did not move. Say: *"the system is
  allowed to say no."*
- Use the toolbar: type `nvidia` in search → the feed narrows; switch **Sort → Highest score**.
  Click a symbol from Radar to show symbol filtering.

## 1:30 — Event Investigation (50s)

Open an event (for example the NVDA export-restrictions event). This is the differentiator.

Walk the sections in order, answering the trader's questions:

1. **What happened** — the summary, labelled *"sample analysis — authored, not model output"* in
   the demo (live mode uses Ollama and says so).
2. **Which instruments** — the affected symbols and category.
3. **Evidence** — key claims, each with a clickable **source ↗** link back to the underlying
   article.
4. **Conflicting reports** — the **Contradictions** section: the company says "no material
   impact" while the reports say restrictions are being weighed.
5. **What the market did** — Market context: before / after / current with observation times.
6. **Why this score** — the deterministic component breakdown (price anomaly, relative divergence,
   novelty, source strength, …), the weights, and the explicit disclaimer that the score is a
   ranking, **not** a probability of profit.
7. **What is uncertain** — the uncertainty notes.
8. **What to verify next** — suggested follow-up checks, clearly marked *suggested — not executed*.

If you have a minute, open the model-backed event in live mode and click **Re-investigate** to show
Ollama generating the same structure live.

## 2:20 — Historical Replay (25s)

Click **Replay**, then **Run replay**.

- Show the timeline and the *no look-ahead* notice.
- Point out the decision, the score, and the component breakdown at the simulated decision time.
- Say: *"this is a labelled synthetic fixture; it demonstrates the method, not profitability."*

## 2:45 — Close on honesty (15s)

> "What makes InfoMark different from a news summarizer: it fuses a market anomaly with grouped,
> de-duplicated, source-linked evidence, explains its score deterministically, and is willing to
> return no opportunity. SerpApi is the retrieval backbone; the scoring is arithmetic, not vibes.
> It never trades and never promises returns."

---

## Do NOT claim

- Detection before the market reacts, guaranteed arbitrage, or profitability.
- That fixture numbers are real market data.
- That the sample analysis is live model output (the UI labels it).
- That free-tier quotas are unlimited.

## If something fails on stage

- Blank/empty screens: confirm you ran `npm run demo` (not `npm start`, which requires a login).
- Port busy: `PORT=3001 npm run demo`.
- Full troubleshooting is in the README.
