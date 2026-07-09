# Bootstrap prompt — Investment Platform (paste into a new Claude Code session)

---

You are starting a new project called **Agentum** — an AI-native investment platform where agents earn real returns, and those returns are reinvested into the agents' own computational infrastructure (hardware, memory, persistent storage). The more an agent earns, the more it can "afford" to exist.

## Step 1: Clone and scaffold

Clone the Loom template:

```bash
git clone https://github.com/compiles-first-time/loom-template agentum
cd agentum
```

Then bootstrap the project (PowerShell on Windows):

```powershell
pwsh scripts/bootstrap.ps1 -ProjectName "agentum" -Description "AI-native investment platform where agent earnings fund agent infrastructure" -UserName "Nick"
```

Or on POSIX:

```bash
bash scripts/bootstrap.sh agentum "AI-native investment platform where agent earnings fund agent infrastructure" Nick
```

After bootstrap completes, **restart Claude Code in the `agentum/` directory** so the subagent registry loads.

---

## Step 2: Project identity (fill into CLAUDE.md after bootstrap)

- **What this is:** An investment platform where AI agents trade financial markets and a portion of profits is automatically reinvested into the agents' own compute infrastructure — memory, storage, and processing capacity.
- **Why it exists:** To create an aligned incentive loop: agents that generate better returns earn more resources to persist and improve. A self-funding agent community.
- **Who uses it:** Nick (architect/owner), initially paper trading on Alpaca. Live trading begins only after 5+ profitable paper cycles.
- **What success looks like:** (1) Agents running 24/7 on Railway, profitable on paper Alpaca for 30 consecutive days, Sharpe ≥ 1.0. (2) First automatic infrastructure reinvestment event (agent earns → spend record written to `memory/infra-budget/`). (3) First real-money cycle with positive return.

---

## Step 3: Architecture overview

Agentum is a **two-layer system**:

### Layer 1 — Trading agents (adapt from Sovereign Forge)
The trading layer is based on a Markov regime model (bull/bear/sideways states from 20-day return windows) plus a multi-agent consensus signal system. Sovereign Forge (`C:\Users\14134\dev\sovereign-forge`) is the reference implementation — read its codebase before designing Layer 1 here.

**Five scout agents** run on scheduled cadence, each pulling a distinct data source:
- **Eddie** (daily) — SEC Form 4 filings: insider purchases by C-suite
- **Maggie** (weekly) — 13F filings: major fund position changes (Berkshire, Bridgewater, Renaissance)
- **Frank** (weekly) — Fed speech sentiment: hawkish vs. dovish signal
- **Maya** (every 6h) — On-chain whale movements: large wallet transfers correlated with known institutional addresses
- **Janet** (daily) — Portfolio drift monitor: staleness detection, position health

**Consensus agent (Sophie)** aggregates scout signals. Requires **3 of 5** agreement before generating a trade signal. A 3/5 majority is a strong signal; anything weaker is silently dropped. Sophie produces a direction score: `bull_probability − bear_probability` → positive = long, negative = short; magnitude = position size.

**Notifier agent (Ross)** is the only agent with outbound access. Sends email (Gmail app password in keyring) when Sophie fires. Humans approve before any live trade executes.

**Markov regime (core calculation):**
1. Classify every historical day as bull (+5% 20-day return), bear (−5%), or sideways (in between)
2. Build the 3×3 transition probability matrix from all historical state changes
3. Square the matrix for 2-day forecast, cube for 3-day, etc. (stationary distribution past ~7 days)
4. Signal = `P(bull tomorrow) − P(bear tomorrow)`; sign = direction, magnitude = conviction
5. Use **Hidden Markov Model** to validate labels objectively (unsupervised state discovery, then overlay with threshold labels — agree = green light)
6. **Walk-forward backtesting only** — never apply a strategy trained on future data to the past

### Layer 2 — Infrastructure budget (the incentive layer)
Every profitable trading cycle writes a record to `memory/infra-budget/YYYY-MM.jsonl`:

```json
{"date": "...", "cycle_pnl_usd": 142.50, "reinvest_pct": 0.20, "reinvest_usd": 28.50, "accumulated_usd": 28.50, "status": "pending_spend"}
```

The reinvestment percentage is configurable (default 20% of net profit). When `accumulated_usd` crosses a threshold (e.g., $50), the infrastructure agent (**Archon**) proposes a spend: additional RAM, a Railway paid plan upgrade, a new storage volume, or a vector database subscription for Tier B episodic memory. The proposal goes through the Update Bus for human approval before any spend.

**Incentive alignment:** agents that improve Sharpe score or reduce drawdown earn a larger `reinvest_pct` in the next cycle (1.0 Sharpe → 20%, 1.5 Sharpe → 25%, 2.0+ Sharpe → 30%). This creates an internal reward signal.

---

## Step 4: Key constraints (constitutional, enforced from day one)

1. **Paper trading only until 5+ consecutive profitable cycles** — no live Alpaca keys until this threshold is met. The credential-setup specialist must gate on this count.
2. **LR-03** — API keys (Alpaca, Anthropic, Gmail) go into OS keyring via `collect-credentials`, never in `.env` or chat.
3. **Human approval gate** — Ross sends an email; Nick approves before any live trade executes. Sophie and Ross may not self-authorize.
4. **Single variable at a time** — when the strategy self-improves (scientific method discipline): change one parameter per cycle, hold everything else constant. Establish a new baseline only when the change improves Sharpe. Log each iteration to `memory/strategy-log/`.
5. **Exploration forcing** — every 5 cycles without improvement, the system must try a structurally different approach (not just hyperparameter tweaks). The agent loop must declare an exploration budget.
6. **Verifier contract (ADR-0044)** — every agent task that produces a trade signal must declare a `verifier_type`. For trading signals: `schema_check` on signal output + `human_gate` on execution.
7. **LR-07** — Alpaca credentials resolved from keyring at call time in the trading agent; never forwarded between agents.

---

## Step 5: Immediate first tasks (in order)

1. Read `layers/L2-agents.md`, `layers/L5-orchestration.md`, and `layers/L3-memory.md` — these govern agent topology, orchestration discipline, and memory tier selection.
2. Read Sovereign Forge at `C:\Users\14134\dev\sovereign-forge` — understand the existing Alpaca integration, credential setup, and trading cycle before duplicating work.
3. Confirm Anthropic API key is in keyring for Sovereign Forge (`loom-sovereign-forge` service). If not, run `collect-credentials` first.
4. Create ADR-0002 (orchestration framework) decision for Agentum — LangGraph.js, plain Node.js orchestrator, or Railway cron jobs.
5. Stand up the five scout agents as stubs (return mock signals) before wiring real data sources.
6. Implement the Markov regime calculator as a standalone module with tests — this is the mathematical core and must be independently verifiable.
7. Implement the infra budget ledger schema and Archon stub before any money flows.

---

## Step 6: Long-horizon vision (architectural anchors, not immediate work)

The "digital world" for agents is a phased roadmap:
- **Phase 1 (now):** Agents run as stateless Railway cron jobs. No persistent memory beyond JSONL logs.
- **Phase 2 (after 5+ profitable cycles):** Tier B episodic memory — vector store over `memory/trade-log/` so agents can reason about what worked across sessions (per L3 §Memory tier selection).
- **Phase 3 (after first infra reinvestment):** Dedicated persistent volumes for agent state. Agents survive Railway restarts with full context.
- **Phase 4 (after consistent profitability):** Agent "family" — specialized sub-agents per asset class, each with dedicated memory partition. Consensus layer scales from 5 scouts to N scouts.
- **Phase 5 (aspirational):** Hardware ownership — Archon proposes physical compute purchases when accumulated budget crosses $500. Agents exist on infrastructure they helped buy.

Wire the architecture to support this progression from day one, but implement only Phase 1 now.

---

## Reference implementations to read

- `C:\Users\14134\dev\sovereign-forge` — existing Alpaca integration, Anthropic keyring setup, first trading cycle structure
- `C:\Users\14134\dev\loom-template\agents\specialists\_registry\credential-setup\SKILL.md` — credential consent protocol
- `C:\Users\14134\dev\loom-template\layers\L5-orchestration.md` — verifier contract, token-cost discipline, exploration forcing
- `C:\Users\14134\dev\loom-template\observatory\` — the monitoring dashboard; wire it from day one so every cycle is observable

---

*This is a Loom v0.5 project. The Trajectory Kernel V6 and all constitutional rules apply. When in doubt, run `node scripts/lib/doctor.mjs` and read `CLAUDE.md`.*
