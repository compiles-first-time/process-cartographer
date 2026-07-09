# Alpaca provisioning playbook

> last_verified: 2026-06-07 | verification_method: agent + authoritative-docs | TTL: 90 days
> Per [ADR-0035](../../adr/0035-provisioning-specialist-and-playbooks.md). Specialist consumers: [`credential-setup/SKILL.md`](../../agents/specialists/_registry/credential-setup/SKILL.md) (Class B browser steps — registration/login/key-gen) and [`provisioning/SKILL.md`](../../agents/specialists/_registry/provisioning/SKILL.md) (Class A validation + MCP).
>
> Authored for the `credential-setup` specialist (ADR-0042). Sourced against the Alpaca docs Nick supplied 2026-06-07 (see Vendor canonical docs). Alpaca offers **paper trading** (simulated, free) and **live trading** (real money, requires brokerage KYC). This playbook targets **paper**.

## Key fact: there is NO programmatic self-service key creation

Per the [connect guide](https://alpaca.markets/learn/connect-to-alpaca-api) and getting-started docs: **trading API keys (Key ID + Secret) are generated only in the web dashboard, and the Secret is shown once.** There is no API to create your own trading keys — so key acquisition is genuinely browser-gated (Class B), which is exactly what `credential-setup` is for.

**Disambiguation (do not confuse):** Alpaca's [`issuetokens`](https://docs.alpaca.markets/us/reference/issuetokens) reference is `POST https://authx.alpaca.markets/v1/oauth2/token` — it issues **OAuth2 access tokens** via the `client_credentials` grant, for OAuth apps / Broker-API partners acting on behalf of users. It is **not** a way to mint your own trading API keys. Don't route key acquisition through it.

## Setup (one-time per architect account)
<!-- last_verified: 2026-06-07 | verification_method: agent + authoritative-docs -->

1. **Register or log in** at https://app.alpaca.markets/signup (the `credential-setup` specialist navigates here; the human performs account creation + password + verification — see ADR-0042 §Executing-agent constraint). Paper trading is available without live-brokerage KYC.
2. **Generate paper API keys** from the dashboard **Home** section (paper environment) → generate Key ID + Secret. **"Securely store your Secret Key when first generated — you can only view it once"** (Alpaca connect guide). Paper and live have **separate** keys.
3. **Store via `scripts/collect-credentials.{sh,ps1} alpaca`** — paste Key ID + Secret into the hidden stdin prompts. The collector validates the pair against `GET /v2/account` (paired two-header), attests the account, and stores both in the OS keyring (refs in `.env.local`). **Never paste keys into chat** (LR-03); the specialist hands off here and does not read the secret (ADR-0042 §C).

## Class A — automated operations (after keys exist)
<!-- last_verified: 2026-06-07 | verification_method: agent + authoritative-docs -->

### A1. Direct REST (used by the collector + `node index.js --status`)

Alpaca auth is **two custom headers** — `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` — **not** bearer. Validated as a pair.

| Operation | API | Request | Success | Failure recovery | Source |
|---|---|---|---|---|---|
| `get_account` (validate + attest) | `GET https://paper-api.alpaca.markets/v2/account` + both `APCA-*` headers | both headers | HTTP 200; `{id, account_number, status, currency, buying_power, cash, ...}` | 401 = wrong/swapped key or paper-vs-live mismatch → `collect-credentials … --rotate alpaca` (CRED-EX-08) | [getAccount](https://docs.alpaca.markets/reference/getaccount) |
| `get_clock` | `GET https://paper-api.alpaca.markets/v2/clock` | none | HTTP 200; `{is_open, next_open, next_close}` | n/a (read-only) | [getClock](https://docs.alpaca.markets/reference/getclock) |

### A2. MCP — `alpaca-mcp-server` (official; preferred for agent-driven trading)

The official [**alpaca-mcp-server**](https://github.com/alpacahq/alpaca-mcp-server) (FastMCP v2) exposes Alpaca as MCP tools: **account/portfolio, trading (stocks/crypto/options), positions, watchlists, assets & market info, market data, news, fixed income, indices.** It **requires API keys the user already has** (it does not create them — it is downstream of `credential-setup`).

```jsonc
// MCP client config (env-var auth)
"alpaca": {
  "command": "...", // per the server README (uv / pipx / docker)
  "env": {
    "ALPACA_API_KEY":   "<key id>",      // note: NOT named ALPACA_KEY_ID
    "ALPACA_SECRET_KEY": "<secret>",
    "ALPACA_PAPER_TRADE": "true",         // defaults true
    "ALPACA_TOOLSETS":   "..."            // optional tool filter
  }
}
```

> **Env-var-name caveat:** the MCP server uses `ALPACA_API_KEY`; Sovereign Forge's app uses `ALPACA_KEY_ID`. Same value, different variable name — map accordingly if wiring the MCP into a project. Prefer keyring-backed injection over literal env values (ADR-0036). For Loom, register this server in `tools/mcp-servers/config.yaml` + the [MCP-vs-CLI matrix](../mcp-cli-capability-matrix.md) (ADR-0033) before relying on it.

## Class B — browser-only steps (the credential-setup specialist's domain)
<!-- last_verified: 2026-06-07 | verification_method: agent + authoritative-docs -->

Driven by `credential-setup` with **explicit per-step consent** (ADR-0042 §B). Per the §Executing-agent constraint, the human performs account creation, password entry, and any CAPTCHA; the agent navigates (read-only) and guides. Verify each step against the live page.

| Step | URL | Action (human-performed) | Output | Why no API | Source |
|---|---|---|---|---|---|
| Register account | https://app.alpaca.markets/signup | Human enters email + password, submits | Account email (non-secret) | No programmatic signup | [connect guide](https://alpaca.markets/learn/connect-to-alpaca-api) |
| Email verification | (link in inbox) | Human clicks verify link / enters code (CRED-EX-04 pause) | Verified state | One-time code; human-gated | Alpaca onboarding |
| Log in | https://app.alpaca.markets/login | Human enters password (+ 2FA if enabled) | Session | Password entry is human-only (ADR-0042) | Alpaca |
| Generate paper keys | dashboard **Home** (paper) | Human clicks generate; Key ID + Secret display (Secret once) | **Key ID** (non-secret, may capture); **Secret** → hand to `collect-credentials` stdin, do NOT read (CRED-EX-03) | No key-creation API (see Key fact) | [connect guide](https://alpaca.markets/learn/connect-to-alpaca-api) |

## Class C — runtime-dependent (just-in-time handoff)
<!-- last_verified: 2026-06-07 -->

| Trigger | URL | Action | Notes | Source |
|---|---|---|---|---|
| Paper → live (real money) | https://app.alpaca.markets/ | Brokerage onboarding (KYC: identity, SSN/tax, funding) | **Decline trigger** — KYC handed entirely to the user (CRED-EX-02); agent never enters identity/financial data. Live uses different keys + base `https://api.alpaca.markets` | [live trading](https://docs.alpaca.markets/us/docs/getting-started) |
| CAPTCHA / anti-bot at signup | (signup page) | Human solves in their browser (CRED-EX-01) | Never solved by the agent | n/a |

## MCP capabilities (per ADR-0033 matrix)

- **alpaca-mcp-server** (https://github.com/alpacahq/alpaca-mcp-server) — drives account/trading/data; **consumes** keys (Class A, agent-driven trading). Downstream of credential-setup.
- **Alpaca docs MCP** (`https://docs.alpaca.markets/mcp`, type `http`, server name `alpaca-us`) — documentation server. Use for ADR-0035 staleness re-validation of this playbook (query the docs MCP instead of, or alongside, WebFetch).

## Vendor canonical docs (re-validate on TTL expiry)

`scripts/validate-playbook.{sh,ps1} alpaca` re-fetches these (or queries the docs MCP) and asks an agent (ADR-0034 path 2b) to compare + report drift:

- [Getting started](https://docs.alpaca.markets/us/docs/getting-started)
- [Connect to the Alpaca API](https://alpaca.markets/learn/connect-to-alpaca-api) — authoritative key-gen steps (Home dashboard, shown once, no programmatic gen)
- [OAuth token endpoint `issuetokens`](https://docs.alpaca.markets/us/reference/issuetokens) — OAuth2, NOT key creation (disambiguation)
- [getAccount `/v2/account`](https://docs.alpaca.markets/reference/getaccount) · paper base `https://paper-api.alpaca.markets/v2`
- [alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server) + docs MCP `https://docs.alpaca.markets/mcp`

## Version log
- **2026-06-07** — initial population for `credential-setup` (ADR-0042). Class A (REST validate/clock + alpaca-mcp-server), Class B (register/verify/login/key-gen), Class C (paper→live KYC, CAPTCHA).
- **2026-06-07 (rev 2)** — corrected against authoritative Alpaca docs supplied by the architect: confirmed key generation is dashboard-only (no programmatic API); disambiguated `issuetokens` as OAuth2 token issuance (not key creation); added the official alpaca-mcp-server (Class A2) + docs MCP; corrected key-gen location to dashboard Home; added paper-vs-live key + env-var-name caveats.
