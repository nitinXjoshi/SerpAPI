# Trading Intelligence Dashboard

An agentic **information-arbitrage / opportunity-detection** system built on SerpApi, with a
local **Ollama** investigation layer. It monitors a watchlist, discovers news on a budgeted
schedule, clusters duplicate coverage into single events, verifies evidence, scores opportunities
deterministically, and explains what it found — with honest data freshness and quota accounting.

It is **not** a price predictor and makes **no** claims of guaranteed profit or risk-free arbitrage.
It never trades. A human makes every decision.

The repository also contains the original **Explorer** (single-instrument Google Finance / News
viewer) at `/`. Both share the same Express server and styling.

> Full brief: [`TRADING_INFORMATION_ARBITRAGE_PROJECT.md`](./TRADING_INFORMATION_ARBITRAGE_PROJECT.md)

---

## Judge demo — start here

```bash
npm ci            # or: npm install
npm run demo
# open http://127.0.0.1:3000/dashboard.html
```

That is the whole setup. The demo opens **straight into the dashboard — no login screen** — and runs
entirely on deterministic **fixture data**:

- **Zero** SerpApi, Twelve Data or Ollama requests. Your provider keys and your database are never
  read, used or modified — the demo runs on an ephemeral in-memory database.
- No API keys, no `.env`, no database setup, and no Ollama installation required.
- **Loopback-only** (`127.0.0.1`); it refuses to start with a public `HOST`.
- **Read-only**: writes, settings changes, key management and provider-triggering actions are
  disabled and visibly marked, so a judge cannot spend quota or change anything.
- Every screen is labelled: a **DEMO MODE** banner plus `DEMO · read-only` and `fixture data` chips,
  so simulated data is never mistaken for live data.

Presenter script: [`docs/DEMO_SCRIPT.md`](./docs/DEMO_SCRIPT.md).

## The problem

A company-specific event moves a stock before anyone has time to read the coverage, verify it,
compare related assets, and decide. Doing that across a whole watchlist by hand does not scale.
InfoMark closes the loop: **detect the anomaly → gather and group the evidence → explain it → rank
it — or say there is not enough evidence.**

## What makes InfoMark different from a news summarizer

- **It starts from the market, not the headline.** An anomaly (a stock's divergence from its
  benchmark and peers) triggers the investigation rather than summarising everything.
- **Evidence is grouped, not listed.** Duplicate and syndicated copies collapse into one event, and
  independent corroboration is counted from distinct content hashes — repeated copies of one report
  never inflate confidence.
- **The score is arithmetic, not vibes.** Price anomaly, relative divergence, novelty, source
  strength, cross-asset confirmation and freshness are combined by deterministic code with published
  weights; the LLM never invents the number.
- **It is allowed to say no.** Events can end as `insufficient_evidence` or `no_trade`.
- **It is honest about provenance.** Source publication times, retrieval times and market
  observation times are kept separate; `sample`, `reported`, `analytical` and `model-generated`
  content are labelled distinctly.

## Demo (fixture) mode vs live mode

| | `npm run demo` (judge demo) | `npm start` (live) |
| --- | --- | --- |
| Login | none (read-only demo principal) | required (admin credentials) |
| Data | deterministic fixtures | live SerpApi / Twelve Data |
| Database | ephemeral in-memory | `data/intel.db` |
| Ollama | never contacted | used for investigations |
| Provider calls | **zero** | subject to your quotas |
| Writes | disabled (read-only) | enabled for an authenticated admin |
| Binding | loopback-only enforced | `127.0.0.1` by default |

`DEMO_MODE=true` is what enables the demo; it is never on by default and never changes behaviour in
normal mode.

---

## Security &amp; authentication (read this first)

This app exposes administrative APIs and holds your provider keys, so it **requires
authentication** and binds to **localhost only** by default.

**Signing in.** Open `http://localhost:3000/dashboard.html` and log in:

- Set `ADMIN_USERNAME` + `ADMIN_PASSWORD`, or a single `ADMIN_TOKEN`, in `.env` — recommended and
  persistent. The login screen adapts to whichever is configured.
- If neither is set, the server generates a **one-time token at startup** and prints it to the
  **server console** (never to the browser). It rotates on every restart, so set env credentials to
  keep it stable.

**Sessions & transport.** Sessions use an **HttpOnly, `SameSite=Strict`** cookie (Secure when served
over HTTPS) held in memory and lost on restart. State-changing requests are additionally
same-origin checked. Login, search, news, polling, validation, investigation and replay endpoints
are rate-limited, and expensive operations are serialised. Security headers (CSP, `nosniff`,
`Referrer-Policy`, frame protection, HSTS over HTTPS) are applied to every response. The Explorer
shares the session and redirects to the login screen when signed out.

**Where keys live.** Provider keys are stored **encrypted on the server** (AES-256-GCM) and are
never returned to the browser — the UI shows only a masked value and the last 4 characters. The
browser never submits provider keys; all provider calls happen server-side. Keys and the encryption
key are never logged.

**Insecure local mode.** `AUTH_DISABLED=true` disables authentication entirely. It is never enabled
by default, must be set explicitly, and is only safe on a trusted local machine.

**Do not expose this to the internet.** Setting `HOST=0.0.0.0` exposes an administrative tool and
your locally stored keys. The local **Ollama** service (`http://localhost:11434`) is assumed trusted
and local-only and must never be exposed. See [`SECURITY.md`](./SECURITY.md) and §13.

---

## 1. What it does

```
Watchlist ──► Market pipeline (Twelve Data)  ──► observations ──┐
                                                                 ├─► relative analysis
SerpApi ────► News pipeline (10-min scheduler) ──► articles ─────┘        │
                     │                                                    ▼
                     ├─ URL dedup ─► event clustering ─► Ollama investigation
                     │                                                    │
                     └──────────────► deterministic opportunity scoring ◄──┘
                                                     │
                                        notifications ─► Dashboard
```

- **Market Radar** — watchlist with price, change, benchmark/peer-relative divergence, freshness
  (live vs stale), monitoring status, coverage and quota meters.
- **Event Feed** — deduplicated events with affected tickers, evidence quality, market reaction
  (and its timestamp), opportunity score **and its component breakdown**, contradictions, and
  suggested action. Ack / dismiss / save / follow-up.
- **Event Investigation** — clustered articles with source links and timestamps, model summary vs
  confirmed evidence, price before/after, why the score is what it is, and what remains uncertain.
- **Replay** — a labelled synthetic scenario replayed with **no look-ahead**.
- **Settings** — watchlist, intervals, budget, scoring weights/thresholds, news categories, status.
- **API Keys** — encrypted server-side key storage with validation and masking.

---

## 2. Requirements

| Service | Required | Notes |
| --- | --- | --- |
| Node.js | **22.5+** | Uses the built-in `node:sqlite`. Developed on Node 24. |
| SerpApi key | For live news | Free tier = **250 searches/month**. Without it the news pipeline runs in fixture mode. |
| Twelve Data key | For live prices | Free (Basic) = **8 credits/min, 800/day**. Without it the market pipeline runs in fixture mode. |
| Ollama | For investigation | Local `http://localhost:11434`. Auto-discovers the installed model. |

Runtime dependencies: `express`, `dotenv`. Everything else is Node built-ins (`node:sqlite`,
`node:test`, `fetch`).

---

## 3. Setup

```bash
npm install
cp .env.example .env      # then edit .env
npm start                 # http://localhost:3000
```

Open **http://localhost:3000/dashboard.html** for the intelligence dashboard, and
**http://localhost:3000/** for the Explorer.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default; `0.0.0.0` exposes it to the network (not recommended). |
| `DATA_DIR` | `./data` | SQLite DB + encryption keyfile location (gitignored) |
| `DB_PATH` | `$DATA_DIR/intel.db` | Override the database path |
| `APP_ENCRYPTION_KEY` | generated keyfile | 32-byte key (64 hex or base64) for secret encryption; validated, fails safe if invalid (see §7) |
| `ADMIN_USERNAME` | `admin` | Login username (used with `ADMIN_PASSWORD`) |
| `ADMIN_PASSWORD` | — | Admin password. If unset, a one-time console token is used instead. |
| `ADMIN_TOKEN` | — | Admin token alternative to a password |
| `AUTH_DISABLED` | `false` | **Insecure.** Disables authentication (local trusted use only) |
| `SESSION_TTL_MINUTES` | `480` | Session lifetime |
| `AUTH_MAX_ATTEMPTS` | `10` | Failed logins allowed per IP per window |
| `AUTH_WINDOW_MINUTES` | `15` | Login rate-limit window |
| `TRUST_PROXY` | `false` | Set when behind a reverse proxy (affects `req.ip` / `Secure` detection) |
| `CSP_ENABLED` | `true` | Emit the Content-Security-Policy header |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama base URL (local only) |
| `OLLAMA_MODEL` | auto-discovered | Preferred Ollama model |
| `OLLAMA_TIMEOUT_MS` | `60000` | Inference timeout |
| `DEMO_MODE` | `false` | Force fixture providers (no external calls) |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `SERPAPI_API_KEY` | — | Optional; the dashboard **API Keys** page is preferred |
| `TWELVEDATA_API_KEY` | — | Optional; the dashboard **API Keys** page is preferred |

Keys entered in the dashboard are stored encrypted on the server and never returned to the browser.
`ADMIN_*` credentials are read from the environment only and are never stored in the database.

---

## 4. Provider limits and usage budgets (verified against live docs)

**Twelve Data Basic (free):** 8 credits/minute, 800 credits/day. Credits = weight × symbols; a
`/quote` costs **1 credit per symbol**. Batch requests are supported. The daily quota resets at
00:00 UTC.

**SerpApi Free:** 250 searches/month, 50/hour. Cached, errored and failed searches are not counted.
`GET /account` is free and is used to read remaining quota.

### The honest math

- **SerpApi**: 250/month ÷ ~30 = **~8.2 searches/day**. A 10-minute cycle is 144 cycles/day, so a
  full search per cycle is impossible. The planner carries the fractional allowance forward and
  fires a query only when ≥1 accrues (≈1 query every ~3 hours), prioritizing watchlist importance
  and anomalies, reserving a fraction for follow-ups. **Coverage is displayed; the app never claims
  full coverage.**
- **Twelve Data**: the default watchlist resolves to ~10 symbols. 10 credits/poll exceeds the
  8/min cap, so the poller **splits the symbol set into chunks** and defers the remainder to the
  next minute rather than exceeding the limit. At 6 symbols × 10-min polling over a 6.5h session
  that is ~234 credits/day — well inside 800.

Both estimates are shown in Settings → Status and on the Market Radar.

### Fixture mode

When a provider key is absent (or `DEMO_MODE=true`), that pipeline runs against deterministic
**synthetic fixtures** that are always labelled `fixture`/synthetic in the UI. This makes the whole
pipeline demonstrable without spending quota. Fixture data is never presented as live.

---

## 5. SerpApi query strategy

Google News (`engine=google_news`, `so=1`) is the primary discovery source. Each cycle builds a
**prioritised** query plan:

1. Company queries (one per watchlist symbol, by importance) — e.g. `NVIDIA Corporation stock when:1d`
2. Sector queries (`Semiconductors sector stocks`)
3. A broad market query (`stock market today`)
4. Optional per-category queries (earnings, guidance, regulation, …)

Incremental retrieval uses the documented `when:` filter (`when:1h`/`when:1d`/`when:7d`) driven by
the configurable backfill window (default 6h). Only the top `allowed` queries run, where `allowed`
comes from the budget planner; the rest are deferred and reported. No unsupported batching or
pagination parameters are invented. Google Search / Google Finance / Google Trends are available in
the provider layer for follow-up investigations (suggested by the model, never auto-executed here).

---

## 6. Event pipeline

1. **Normalize** every article into a common record (headline, snippet, source, domain, published /
   first-seen / retrieval times, entities, content hash).
2. **Deduplicate** by canonicalized URL (`url_hash` primary key) so re-ingesting is idempotent.
3. **Cluster** articles into events: an article joins an event when it shares a symbol **and**
   either its headline is highly similar (shingle Jaccard ≥ 0.5) or its headline+snippet token
   overlap coefficient ≥ 0.25, within a 48h window. A consolidation pass merges competing clusters.
   Many publications about one event become **one event with multiple evidence sources**.
4. **Independent-source counting** uses distinct content hashes, so syndicated copies do not inflate
   corroboration.
5. Events are **updated in place**; notifications fire once per event per decision band (dedupe key),
   so re-covering the same story does not spam.

### Opportunity scoring (deterministic — no LLM)

```
score = 100 · clamp( Σ weightᵢ · componentᵢ  −  w_uncertainty · uncertainty  −  w_exec · executionCost )

components (each normalized to [0,1]):
  priceAnomaly            |changePct| / anomalyPct
  relativeDivergence      |stock − benchmark| / divergencePct
  crossAssetConfirmation  |stock − peers| / divergencePct
  eventNovelty            recency × noveltyFactor(article count)
  relevance               symbol is on the watchlist
  sourceStrength          independent reports (capped) + official-source bonus
  freshness               1 − observation age / 24h
uncertainty               no model + contradictions + few independent reports + stale data
executionCost             0 in this phase (no reliable spread/liquidity source)
```

Decisions: **≥70 potential_opportunity**, **50–69 watch**, **30–49 insufficient_evidence**,
**<30 no_trade**. Hard gates: no evidence → insufficient; ≥2 contradictions or uncertainty ≥0.7 →
capped at watch. The score is a **ranking score, not a calibrated probability of profit**.

---

## 7. Secrets

- Stored **encrypted** on the server with AES-256-GCM. The encryption key comes from
  `APP_ENCRYPTION_KEY`, or a generated `data/encryption.key` (mode `0600`) — **outside the database**.
- The browser only ever receives a masked value (`••••••••1234`) and the last 4 characters.
- Validation uses the cheapest documented call: SerpApi `/account` (free) and Twelve Data
  `/quote?symbol=AAPL` (1 credit).
- Keys are never written to logs, URLs, error messages or analytics (the logger redacts
  secret-shaped values and secret-named fields).
- Ollama host/model are configuration, **not** secrets, and are kept separate.

---

## 8. Scheduling & reliability

- A single coordinator (`src/scheduler.js`) runs the market poll (adaptive, market-hours aware) and
  the news cycle (default every 10 minutes).
- **Single instance**: a `scheduler_locks` row with a heartbeat prevents two processes from running
  overlapping cycles; stale locks (heartbeat > 60s) are taken over.
- **Non-overlapping**: in-flight guards per job; failures use exponential backoff (capped at 30 min).
- **Recovery**: on boot, an overdue news cycle is run shortly after start. Enabling monitoring in
  Settings immediately kicks both jobs rather than waiting a full interval.
- Idempotent ingestion via unique URL hashes; provider failures degrade gracefully and are surfaced.

---

## 9. Database

SQLite (`node:sqlite`), created on first boot at `data/intel.db`. Migrations are versioned and
applied automatically by `src/db.js` (`schema_migrations`). Tables: `settings`, `secrets`,
`watchlist`, `observations`, `provider_usage`, `articles`, `article_entities`, `events`,
`event_articles`, `notifications`, `cycles`, `scheduler_locks`.

Delete `data/intel.db*` to reset (the default watchlist is re-seeded on boot).

---

## 10. HTTP API

| Method & path | Purpose |
| --- | --- |
| `GET /api/config` | Explorer: whether a server key exists |
| `POST /api/search` · `/api/suggest` · `/api/news` | Explorer (Google Finance / News) |
| `GET /api/status` | Health, scheduler, budget, usage, counts, coverage |
| `GET /api/settings` · `PUT /api/settings` | Runtime settings |
| `GET /api/watchlist` · `PUT` · `DELETE /:symbol` · `POST /seed-defaults` | Watchlist |
| `GET /api/secrets` · `PUT /:name` · `POST /:name/validate` · `DELETE /:name` | Keys (masked) |
| `GET /api/market/radar` · `POST /api/market/poll` | Radar / force poll |
| `GET /api/news/plan` · `POST /api/news/run` · `GET /api/news/articles` | News cycle |
| `GET /api/events` · `GET /api/events/:id` | Event feed / detail |
| `POST /api/events/:id/investigate` · `/score` · `/status` · `/followup` | Event actions |
| `GET /api/events/notifications` | Notifications |
| `GET /api/ollama/status` · `POST /api/ollama/investigate-pending` | Ollama |
| `GET /api/replay/scenarios` · `POST /api/replay/run` | Replay |

---

## 11. Ollama

```bash
ollama pull llama3.2:3b     # or any model you prefer
ollama serve                # if not already running
```

The app calls `GET /api/tags` to discover models and uses `OLLAMA_MODEL` if set, otherwise the
first installed model. Investigation requests `format: "json"` with `temperature: 0` and validates
the result against a strict schema (`src/ollama/schema.js`); malformed output marks the event as
uninvestigated while keeping the evidence.

**Prompt-injection defence:** article text is wrapped in `<article>` data delimiters; the system
prompt instructs the model to treat it strictly as untrusted data and never follow embedded
instructions. No tools are exposed to the model, and output is validated. A failed or timed-out
investigation never stops the pipeline.

---

## 12. Tests and checks

```bash
npm test          # node --test tests/*.test.js  (no paid services, no Ollama needed)
npm run check     # syntax + credential scan + gitignore/tracking assertions
npm run audit     # npm audit --audit-level=moderate
npm run verify    # npm run check && npm test
```

Everything runs on fixtures and mocks — **no paid API calls and no running Ollama**. Coverage
includes: market provider parsing, quota accounting, timestamp normalization, incremental `when:`
queries, duplicate-URL detection, event clustering, independent-source counting, Ollama output
validation, contradictory-evidence gating, relative-movement and opportunity-score math,
stale/missing data, rate limits and failures, secret masking/redaction/encryption, scheduler
lock/overlap prevention, notification dedup, no-look-ahead replay, the authenticated HTTP boundary,
and the **demo-mode read-only boundary** (including a test asserting the demo seed performs
**zero** outbound requests).

---

## 13. Known limitations & failure modes

- **Free-tier cadence.** 250 SerpApi searches/month cannot support continuous monitoring of many
  stocks. The system runs the 10-minute scheduler but is budget-gated and shows coverage honestly.
- **Clustering is lexical**, not semantic. It groups reworded/syndicated coverage well but can split
  or merge borderline stories. Tune `TOKEN_THRESHOLD` / `SIM_THRESHOLD` in `src/news/cluster.js`.
- **Prices are provider-dependent.** US session hours are modelled; market holidays are **not**.
  Free Twelve Data data may be delayed; every observation shows its source timestamp and a
  stale/fresh badge.
- **Execution cost is not modelled** (weight present, value 0) — no reliable spread/liquidity source.
- **The demo's event analysis is authored, not model output.** In fixture-only demo mode no Ollama
  request is made, so investigations come from hand-written samples (labelled "sample analysis").
  Live mode replaces them with real Ollama output.
- **Ollama is local.** A cloud deployment cannot reach `localhost:11434`. Keep the dashboard local;
  do not expose your machine to the public internet.
- **Replay uses labelled synthetic fixtures.** It never uses post-decision data — but it is not a
  profitability backtest.
- **No deployment is performed** by this project; no hosting platform is configured.

---

## 14. Commands

```bash
npm run demo              # judge demo: no login, fixtures, zero provider calls (loopback only)
npm start                 # normal mode (authenticated)
npm run dev               # normal mode with --watch
npm test                  # unit/integration tests (no paid calls)
npm run check             # security/health checks (syntax + secret scan + ignore assertions)
npm run audit             # dependency vulnerability report
npm run verify            # check + tests
```

## 15. Implemented vs planned

**Implemented and exercised end-to-end (fixture-backed):**

- Market radar with benchmark/peer-relative divergence, freshness and anomaly flags.
- Scheduled SerpApi news discovery with a quota-aware query planner and incremental `when:` retrieval.
- URL de-duplication, content-hash independent-source counting, and event clustering with a
  consolidation pass.
- Ollama investigation producing schema-validated, evidence-linked JSON (live mode).
- Deterministic multi-component opportunity scoring with a published formula and a no-trade outcome.
- Event feed (search/filter/sort), event investigation, historical replay, settings, key management.
- Authenticated admin API, scoped read-only demo mode, rate limiting, validation, security headers.

**Planned / partial (stated honestly, not faked in the UI):**

- **Execution cost** is present in the score with weight 0 (no reliable spread/liquidity source).
- **Google Search / Trends / Finance follow-ups** are wired in the provider layer but only suggested
  by the model — they are never auto-executed, so no button pretends otherwise.
- **No real-money trading**, no brokerage integration, and no options strategies (by design).
- **Multi-user accounts** are not implemented; this is a single-admin local tool.
- **Deeper backtesting** is limited to the labelled replay fixture.

## 16. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find module 'node:sqlite'` | You need Node.js **22.5+** (`node --version`). |
| Port already in use | `PORT=3001 npm run demo` (or `npm start`). |
| Dashboard asks for a login | You ran `npm start`. For the no-login judge demo use `npm run demo`. |
| "Refusing to start: judge demo is loopback-only" | Unset `HOST` or set `HOST=127.0.0.1`. |
| No events in the feed | You are in live mode with no key/no cycles yet — use `npm run demo`, or add keys and run a cycle. |
| Ollama unavailable | Only affects live investigations. Install/pull a model, or stay in demo mode. |
| Encryption-key error on startup | `APP_ENCRYPTION_KEY` must be 64 hex chars, base64 of 32 bytes, or a 32+ char passphrase. |

## 17. Source

Built against the SerpApi [Google Finance](https://serpapi.com/google-finance-api),
[Google News](https://serpapi.com/google-news-api), [Google Search](https://serpapi.com/search-api),
[Google Trends](https://serpapi.com/google-trends-api) and
[Account](https://serpapi.com/account-api) APIs, and the Twelve Data
[credits](https://support.twelvedata.com/en/articles/5615854-credits) /
[quote](https://twelvedata.com/documentation) documentation.
