# Atlas

**An agent loop that knows when research is done.**

**New here?** Start with the [**walkthrough**](docs/PRESENTATION.md) — a presentation-style tour of what Atlas is, how to read the dials, and how to run it.

Atlas runs an autonomous research-synthesis loop over interview sessions fetched
through [Great Question's](https://greatquestion.co) MCP server. It reads each
transcript as it lands, measures how much is genuinely new, and tells the team
the moment further interviews stop teaching anything — then stops, and reports
how much recruiting spend that saved.

The idea rests on one load-bearing insight: **saturation**. Qualitative
researchers have known for decades that you stop interviewing when new sessions
stop yielding new themes. What makes saturation interesting to an engineer is
that it is *verifiable* — a halting condition a loop can actually check. Atlas
turns "have we heard enough?" from a gut call into a measurement.

> This repository is **the program**. The single-page site that pitches the
> concept lives in [`site/`](site/index.html), built from a Claude Design
> handoff.

---

## The loop

Each pass consumes exactly one session and ends with a decision: continue, or
halt with a verdict.

| # | Step | What happens |
|---|------|--------------|
| 1 | **Fetch** | Pull the next transcript through Great Question's MCP — `search_studies`, `list_repo_sessions`, `get_transcript`. |
| 2 | **Extract** | An extractor reads the transcript and produces themes, each anchored to verbatim quotes. |
| 3 | **Score novelty** | New themes are embedded and compared against the accumulated set; the distance is the session's novelty score. |
| 4 | **Verify** | A *separate* verifier re-reads the transcript and grades the extraction for faithfulness. The worker never grades its own work. |
| 5 | **Decide** | Continue, or halt against the saturation threshold, the quality floor, and the budget cap — then loop. |

A run never simply stops — it concludes with one of **four verdicts**:

- **`saturated`** — novelty stayed below threshold for *k* consecutive sessions → *stop recruiting.*
- **`quality_halt`** — verifier faithfulness dropped below the floor → *review the extraction.*
- **`budget_halt`** — agent spend exceeded the cap → *raise the cap or accept partial synthesis.*
- **`not_saturated`** — sessions ran out while novelty was still high → *keep recruiting.*

---

## Quickstart

No API keys, no cost — the default demo runs fully offline and deterministically.

```bash
npm install
npm run demo          # atlas run --study pricing-study
```

You'll see the loop stream session by session, a live halt-condition tracker,
and the novelty curve crossing the threshold — the moment saturation is called:

```
  novelty per session
   1.0 │●
       │  ●
       │    ●
       │      ● ●
  0.15 ┤┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄  threshold
       │            ●
   0.0 │              ● ◉
      └──────────────────
       s1s2s3s4s5s6s7s8s9

  ┏━ VERDICT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┃ Saturated at session 9 of 14
  ┃ Stop recruiting — the themes have converged.
  ┃ 5 sessions cancelled × $300 = ≈ $1,500 saved
  ┃ verifier floor held (min 0.667)
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

It writes a grounded, citable findings report to `out/` as JSON and Markdown.

### Live dashboard

```bash
npm run dashboard     # → http://localhost:4317
```

The same run, in the browser, in the Atlas dark-renaissance look: the novelty
curve draws point by point and crosses the threshold live, alongside a phase
indicator, a four-way halt-condition tracker, the growing theme repository, the
MCP tool-call log, and a click-through iteration inspector (transcript excerpt,
extracted themes, embedding match, verifier verdict). It streams the *same*
`RunEvent` stream the CLI renders — the server (`src/server.ts`) just paces it
into a watchable cadence over Server-Sent Events. Deep-link a run with
`/?run=1&pace=1100`.

### Other commands

```bash
npm run mcp           # run the mock Great Question MCP server standalone (stdio)
npm run connect:gq    # connect to the REAL Great Question MCP over OAuth (lists studies, fetches a transcript)
npm test              # the test suite (4 verdicts, novelty math, full-run scenarios)
npm run typecheck     # tsc --noEmit
npx tsx scripts/genFixtures.ts   # regenerate the demo study fixtures
```

### Useful flags

```bash
atlas run --study pricing-study --threshold 0.15 --k 3 \
          --quality-floor 0.6 --budget 100000 --cost-per-session 300 [--approve] [--json]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--threshold` | 0.15 | novelty below this counts toward saturation |
| `--k` | 3 | consecutive low-novelty sessions to declare saturation |
| `--quality-floor` | 0.6 | verifier faithfulness floor before a quality halt |
| `--budget` | 100000 | hard agent-spend cap (USD) |
| `--cost-per-session` | 300 | research cost per session, drives the savings figure |
| `--approve` | off | record approval of proposed writes (still never auto-executed) |

Defaults can also be set via `.env` (see `.env.example`).

Try the other verdicts:

```bash
atlas run --study pricing-study --budget 0.05         # → budget_halt
atlas run --study pricing-study --quality-floor 0.7   # → quality_halt at s5
atlas run --study pricing-study --threshold 0         # → not_saturated (runs all 14)
```

---

## Trust by design

An agent that spends money and writes findings is built defensively. Four
constraints hold on every run, enforced in code — not just described:

1. **Every claim is grounded.** No finding exists without a citable verbatim
   quote, traceable to its source session and timestamp.
2. **The worker never grades itself.** Extraction and verification are separate
   components; the loop refuses to start if they share an identity. (In live
   mode they must be different models — opus worker, sonnet verifier.)
3. **Writes wait for a human.** Any write against the research platform (e.g.
   pausing recruiting) is recorded as a `PendingApproval` and surfaced — never
   auto-executed.
4. **A hard budget cap.** Crossing it halts the loop — a recorded verdict, like
   any other.

---

## Demo mode vs. live mode

This build ships **demo mode**: deterministic, offline, no API key, no cost. The
loop's control logic is real — novelty is genuinely computed from text overlap,
the verifier genuinely re-checks that every quote is grounded in the transcript,
and the four verdicts are real decisions. Only the *theme generation* is a
deterministic stand-in for an LLM (it reads gold annotations from the fixtures).

**Live mode is a documented seam, not a rewrite.** Each pluggable piece has its
swap-in point marked in the source:

| Concern | Demo (now) | Live seam |
|---------|------------|-----------|
| Extract (`src/engine/extract.ts`) | `DeterministicExtractor` | `claude-opus-4-8`, structured output, adaptive thinking |
| Verify (`src/engine/verify.ts`) | `DeterministicVerifier` | `claude-sonnet-4-6` (asserted ≠ worker) |
| Embeddings (`src/engine/novelty.ts`) | `LocalLexicalEmbeddings` | Voyage (Anthropic has no native embeddings API) |
| Transcripts (`src/providers/`) | mock MCP server (default) | **real Great Question MCP — already built** (OAuth 2.1/PKCE), see below |

The budget meter even *estimates* what a live run would spend (opus + sonnet
token costs), so the cap stays meaningful in demo mode.

---

## Great Question MCP: mock by default, real integration built in

The demo is backed by `src/mcp/server.ts` — a **mock that speaks the real Model
Context Protocol** and exposes Great Question's real read tools, served from
local fixtures. The engine talks to it as a plain MCP **client**, so the
transcript source is a config switch, not a rewrite.

That switch is real, and so is the other side of it. `GreatQuestionMcpProvider`
connects Atlas to Great Question's hosted server
(`https://greatquestion.co/api/mcp/v1`) over Streamable HTTP with **OAuth 2.1 /
PKCE and dynamic client registration — no API key**. Set `ATLAS_MCP_URL` and the
same loop runs against live research data:

```bash
npm run connect:gq    # authorize in the browser, list studies, fetch one transcript
ATLAS_MCP_URL=https://greatquestion.co/api/mcp/v1 npm run demo -- --study <id>
```

This was verified against the live server: the OAuth challenge, dynamic client
registration, and Great Question's consent screen (rendering Atlas's client name
and MCP scopes) all work. The one remaining gate is **account-side** — the
workspace must have *MCP OAuth* enabled — so live tool calls wait on that flag;
the moment it flips, `connect:gq` runs against real data with zero code changes.
The provider introspects the live `tools/list` on connect, maps real transcript
payloads into Atlas's types, and is **read-only** (the one contemplated write —
pausing recruiting — stays a `PendingApproval`). Full mechanics in
[`src/providers/greatquestion.md`](src/providers/greatquestion.md).

---

## Project layout

```
src/
  mcp/server.ts              mock Great Question MCP server (stdio + in-process)
  providers/                 TranscriptProvider — mock client + real GQ client (oauth.ts, OAuth 2.1/PKCE)
  engine/                    types, extract, novelty, verify, decide, budget, approval, runLoop
  report/                    grounded findings report (Markdown + JSON)
  cli.ts                     streaming CLI — phases, tool log, money-shot chart, verdict
  connect.ts                 npm run connect:gq — prove the real MCP data path end to end
  server.ts                  dashboard server — drives the loop, streams events (SSE)
web/                         live-run dashboard (vanilla JS, Atlas dark-renaissance)
fixtures/studies/pricing-study/   14-session demo study (saturates at s9)
site/                        the Atlas marketing page (Claude Design handoff)
scripts/                     fixture generator + dev harnesses
test/                        decide / novelty / end-to-end
docs/ARCHITECTURE.md         how the loop maps to the concept; the trust model
```

## Status

Engineering prototype. Built to test one idea: that saturation gives an
autonomous agent loop a stopping condition it can actually verify. Great
Question is referenced as the research platform whose MCP this builds on — no
affiliation or endorsement implied.
