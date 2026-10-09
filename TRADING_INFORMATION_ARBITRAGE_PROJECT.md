# Trading Information-Arbitrage System

## Decision
**Project direction locked in:** We are proceeding with an agentic information-arbitrage / trading-opportunity detection system for the SerpApi hackathon.

## Core Idea
Build a system that monitors **multiple related stocks/assets simultaneously**, detects unusual relative price movements and information discrepancies, investigates the underlying causes using SerpApi, and ranks potentially actionable opportunities.

This is **not** a generic AI stock predictor and should not claim risk-free arbitrage.

### Positioning
> **An agentic information-arbitrage engine that monitors multiple correlated assets, detects abnormal relative movements, investigates the underlying information using SerpApi, verifies competing explanations, and ranks actionable opportunities.**

Use the term **information arbitrage** carefully. Traditional arbitrage implies a near-risk-free price discrepancy; our system instead exploits temporary discrepancies between information, market reaction, and related assets.

---

## Problem
Traders/investors can miss important information because relevant signals are scattered across:
- stock/market movements
- sector and peer movements
- financial data
- breaking news
- web reports
- search-interest changes
- related companies/events

The system should answer:

> **"Is something inconsistent here, why is it happening, and is there a potentially actionable opportunity?"**

---

## Core Workflow

```text
Stock Universe
      ↓
Market Scanner
      ↓
Detect abnormal movement / relative divergence
      ↓
Compare:
  • Stock
  • Market
  • Sector
  • Peers
      ↓
Agentic Investigation
      ↓
SerpApi:
  • Google Finance
  • Google News
  • Google Search / News
  • Google Trends
      ↓
Event Detection + Clustering
      ↓
Source / Evidence Verification
      ↓
Fundamental & Market Impact Analysis
      ↓
Opportunity Scoring
      ↓
Trade Hypothesis / WATCH / NO TRADE
```

## Key Principle
The system must be able to say **NO TRADE**.

It should never simply do:

```text
News → LLM prediction → BUY/SELL
```

Instead:

```text
Anomaly
→ investigate
→ compare peers/market
→ identify event
→ verify evidence
→ assess materiality
→ measure relative dislocation
→ evaluate risk/uncertainty
→ rank opportunity
→ possibly reject trade
```

---

## Opportunity Score

The numeric score should be produced by a deterministic scoring engine, not invented by an LLM.

Possible components:

```text
Opportunity Score =
    price anomaly
  + relative divergence
  + information novelty
  + source confidence
  + cross-asset confirmation
  + liquidity
  + expected persistence
  - uncertainty
  - transaction costs
  - execution risk
```

The exact formula will be designed during implementation.

The LLM/agent should primarily:
- investigate
- reason over evidence
- identify candidate catalysts
- explain the opportunity
- surface contradictions
- decide what information to retrieve next

---

## Multi-Asset Intelligence

This is a major differentiator.

Instead of analyzing each stock independently, analyze relationships.

Example:

```text
NVDA   -6.1%
AMD    -1.0%
SOXX   -0.8%
NASDAQ -0.5%
TSM    +0.3%
```

The system should recognize that NVDA has a significant company-specific relative divergence and investigate why.

Possible opportunities include:
- relative-value dislocations
- company vs sector divergence
- peer divergence
- information arriving before broad market reaction
- second-order effects across suppliers/competitors
- event-driven opportunities

Do not claim causality with certainty. Use terms such as:
- "best-supported explanation"
- "likely catalyst"
- "evidence suggests"
- "confidence"

---

## Example Opportunity Output

```text
NVDA — OPPORTUNITY DETECTED

Price:              -5.8%
Sector:             -1.1%
Market:             -0.6%

Relative divergence: 4.7%

Likely catalyst:
New export restriction reported at 10:12.

Evidence:
✓ Multiple independent sources
✓ Primary/official source where available
✓ Search-interest spike
✓ Sector did not experience equivalent decline

Confidence: 87%

Recommendation:
Potential opportunity — investigate / simulate / WATCH

Important:
The system must distinguish evidence from inference and must not guarantee profit.
```

---

## SerpApi's Role

SerpApi should be part of the intelligence loop, not just a decorative search box.

Primary engines:

1. **Google Finance**
   - prices
   - historical movement
   - financial information
   - related securities
   - company news/context

2. **Google News**
   - current news
   - grouped stories
   - source/date information

3. **Google Search / News**
   - deeper investigation
   - niche reports
   - corroboration
   - primary sources

4. **Google Trends**
   - sudden information/search-interest changes
   - confirmation of attention spikes

Potential future signals:
- YouTube
- Google Jobs
- Google Scholar
- Google Patents
- shopping/marketplace data

Do not expand scope until the core engine works.

---

## Killer Features

### 1. Relative Anomaly Detection
Find assets behaving unusually compared with market/sector/peers.

### 2. Event → Causal Timeline
Example:

```text
10:12  Event reported
   ↓
10:14  Search activity rises
   ↓
10:17  Related coverage appears
   ↓
10:20  Stock begins abnormal move
   ↓
10:27  Sector remains stable
```

### 3. Evidence / Reliability Layer
Track:
- source reliability
- independence
- recency
- primary vs secondary source
- corroboration
- contradictory claims

### 4. Event Clustering
50 articles about the same event should become **one event**, not 50 signals.

### 5. Contradiction Detection
Example:

```text
Company: "No material production impact"
Supplier report: "Potential delays"
Analyst: "Margin risk"
```

The agent should recognize the conflict and investigate further.

### 6. Historical Replay / Backtesting
Replay historical events as if the system were operating live.

Ask:

> "Would our agent have detected this opportunity before the major move?"

This is extremely important for the final demo.

### 7. NO-TRADE Decision
A credible trading system should frequently reject weak opportunities.

---

## Dashboard Concept

### Market Radar

```text
ACTIVE OPPORTUNITIES

NVDA      87   HIGH
TSLA      71   MEDIUM
AMD       64   WATCH
AAPL      22   NONE
```

### Opportunity Detail

```text
WHY?

Company-specific anomaly detected.

Price:  -5.8%
Sector: -1.1%
Market: -0.6%

Divergence: 4.7%

Catalyst:
Export restriction

Evidence: 87%
Opportunity: 91%
```

### Causal Graph

```text
EVENT
  ↓
EXPECTED FUNDAMENTAL IMPACT
  ↓
NEWS COVERAGE
  ↓
SEARCH SPIKE
  ↓
PRICE MOVE
  ↓
RELATIVE DISLOCATION
```

### Replay

```text
EVENT REPLAY

10:00 ─────────────────────
10:12 News detected
10:14 Agent investigates
10:17 Opportunity generated
10:31 Major price movement
10:45 Stabilization
```

---

## What We Must NOT Claim

Avoid:
- "AI predicts stocks"
- "guaranteed profit"
- "risk-free arbitrage"
- "our model knows where price will go"
- "we make money automatically"

Prefer:
- information arbitrage
- opportunity detection
- relative dislocation
- evidence-backed catalyst detection
- simulated/backtested performance
- confidence
- risk-aware ranking
- human-in-the-loop

---

## MVP Scope

### Must Have
- Multi-stock monitoring
- Price/relative anomaly detection
- Market + sector + peer comparison
- SerpApi Finance integration
- SerpApi News/Search integration
- Event clustering
- Evidence scoring
- Opportunity score
- Explainable opportunity page
- Historical replay/backtest
- NO-TRADE outcome

### Nice to Have
- Google Trends signal
- persistent thesis
- thesis version history
- second-order exposure/ripple map
- portfolio contagion analysis
- rumor radar

### Later / Avoid for MVP
- HFT
- real brokerage execution
- options strategies
- dozens of exotic data sources
- autonomous real-money trading

---

## Hackathon Strategy

The project should demonstrate that SerpApi enables the agent to move from:

**market anomaly → information retrieval → investigation → evidence verification → opportunity detection**

The strongest demo should use a historical event where:
1. related assets behave differently,
2. the anomaly is detected,
3. the agent searches for the catalyst,
4. multiple sources are clustered and verified,
5. the system produces an opportunity/no-trade decision,
6. replay shows what happened afterward.

The goal is to make judges think:

> **"This isn't a chatbot with a finance dashboard. This is an agentic market-intelligence system."**

---

## Next Work Session

When resuming, do **not** restart ideation.

Start with:

1. Finalize exact system architecture.
2. Define the asset relationship model.
3. Define anomaly-detection mathematics.
4. Define the opportunity-score formula.
5. Map every stage to exact SerpApi calls.
6. Design event clustering/evidence verification.
7. Build the historical replay pipeline.
8. Implement the MVP.
9. Create a killer end-to-end demo.
10. Polish README, architecture diagram, and pitch.

**Current status: IDEA LOCKED — BUILDING NEXT.**
