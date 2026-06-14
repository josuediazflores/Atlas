# Atlas — Architecture

This explains how the program is put together, what is genuinely computed versus
deterministically staged in demo mode, and where the live-Claude / real-MCP
seams are.

## Data flow

```
 search_studies ─┐
 list_repo_sessions ─┤  (MCP, real protocol)
                     ▼
        ┌──────────────────────────── per session ────────────────────────────┐
 get_transcript ─►  Extract ─►  Score novelty ─►  Verify ─►  Decide ─► verdict?
   (Fetch)          themes       cosine vs.        faithfulness  4-way    │
                    + quotes     accumulated set   0..1          branch   │ no → next session
                                                                          │ yes → Report
        └──────────────────────────────────────────────────────────────────────┘
                     │                                            │
                     ▼                                            ▼
            accumulated theme set                      BudgetTracker / ApprovalGate
            (embedding vectors)                         (hard cap / human-gated writes)
```

The loop (`src/engine/runLoop.ts`) is an `async generator` that yields a typed
event stream (`RunEvent`). The CLI renders those events; a future dashboard can
consume the identical stream. One verdict ends every run.

## The loop ↔ the concept

| Concept (from the brief) | Where it lives |
|--------------------------|----------------|
| Fetch via Great Question MCP | `providers/McpTranscriptProvider.ts` → `mcp/server.ts` tools |
| Extract themes anchored to quotes | `engine/extract.ts` |
| Embed + diff against accumulated set → novelty | `engine/novelty.ts` |
| Separate verifier grades faithfulness | `engine/verify.ts` |
| Decide: continue or halt | `engine/decide.ts` |
| Four verdicts | `engine/decide.ts` (`VerdictKind`) |
| Saturation reached at session N of M, $X saved | `report/buildReport.ts` |
| Grounded findings with traceable quotes | `report/buildReport.ts` + `report/markdown.ts` |
| Writes wait for human approval | `engine/approval.ts` |
| Hard budget cap | `engine/budget.ts` |

## Data model (`engine/types.ts`)

- **Run** — config + status; produces a **Report**.
- **Iteration** — one session: phase, MCP tool calls, themes, novelty, verifier
  result, cost.
- **Theme** — label, summary, and quotes (each with session id + line +
  timestamp). Merged across sessions into an **AccumulatedTheme** for the report.
- **Verdict** — one of `saturated` / `quality_halt` / `budget_halt` /
  `not_saturated`, with a headline and the recommended next action.
- **Report** — verdict, savings, novelty curve, findings, pending approvals.
- **PendingApproval** — a proposed write, gated on a human.

## What is real vs. staged in demo mode

The honest line: **the loop's logic is real; the theme generation is staged.**

| Step | In demo mode |
|------|--------------|
| Fetch | **Real.** Transcripts are fetched over the real MCP protocol from the mock server. |
| Extract | **Staged.** `DeterministicExtractor` reads gold theme annotations from the fixture (a stand-in for an LLM) and grounds each quote in the transcript it was handed. |
| Score novelty | **Real.** Themes are embedded (local lexical TF vectors) and novelty is the genuine cosine distance to everything seen so far. The declining curve *emerges from the text* — sessions that reuse wording score low novelty; sessions with new vocabulary score high. |
| Verify | **Real.** `DeterministicVerifier` independently re-reads the transcript and checks every claimed quote is actually supported (substring / token-overlap near the cited line). It does not trust the extractor's quote strings — and it catches the one unfaithful quote staged in session 5. |
| Decide | **Real.** The four-verdict logic runs on the genuine novelty history, verifier scores, and budget. |

So the "money shot" — novelty declining and crossing the threshold — is a real
computation over the fixture data, not a scripted animation. Live mode replaces
only the staged Extract step (and optionally the embedding provider).

### Novelty, precisely

`novelty(session) = mean over the session's themes of (1 − max cosine
similarity to any previously-accumulated theme)`. The first session compares
against an empty set, so it is fully novel (1.0). A theme that recurs with the
same wording matches its earlier self (similarity ≈ 1 → novelty ≈ 0); a reworded
"new angle" partially overlaps (≈ 0.45); a brand-new theme matches nothing (≈ 1).
The accumulated set grows after each session is scored.

### Decision precedence

At each completed iteration, `decide()` checks, in order: **quality floor →
budget cap → saturation streak → sessions exhausted**. Quality and budget are
hard limits and win ties; in a healthy run neither trips and saturation is what
fires. The "saturated at session 9" headline means session 9 was the *k*-th
consecutive session below threshold.

## The demo study (`fixtures/`)

A 14-session pricing/onboarding study, generated by `scripts/genFixtures.ts`
from a declarative schedule. Themes are introduced, re-angled, and repeated on a
controlled cadence so the computed novelty starts near 1.0 and crosses the 0.15
threshold such that sessions 7–9 are the three consecutive low-novelty sessions
→ saturation at session 9 of 14 → five sessions cancelled → ≈ $1,500 saved.

The signature quotes (e.g. *"I couldn't tell my manager what this would cost us
next quarter…"*) are placed at the exact timestamps the marketing site cites, so
a real run reproduces the site's sample report. Sessions 10–14 exist (so the
study has 14) and carry low-novelty repeat content for the `not_saturated`
scenario, which the happy path never reaches.

## MCP boundary

`get_transcript` returns transcript lines only — never the gold theme
annotations. The annotations live in the same fixture file but are read by a
different consumer (the demo extractor), which keeps the served surface faithful
to Great Question's real `get_transcript` and the swap-in honest. The engine
connects to the server over an in-memory transport for deterministic, no-
subprocess runs; the same server also runs standalone over stdio (`npm run mcp`)
for any external MCP client.

## Live dashboard (`src/server.ts` + `web/`)

The dashboard consumes the **same `RunEvent` stream** the CLI renders. A small
Node HTTP server serves the static front-end and exposes `/api/run`, which runs
the loop and forwards each event over Server-Sent Events — pacing them into a
watchable cadence (the engine stays pure; pacing lives in the server). The
vanilla-JS front-end renders the run-setup, the live view (animated novelty-vs-
threshold chart, four-way halt tracker, phase indicator, running totals, theme
repository, MCP tool-call log), a click-through iteration inspector (transcript
excerpt + themes + embedding match + verifier verdict), and the final report —
all in the Atlas dark-renaissance language, for one cohesive look across tool and
site. `/api/transcript` backs the inspector and, like the MCP boundary, returns
transcript lines only.

## Deferred

- **Live Claude run mode** — see the seam table in the README. Everything else
  the original spec called for (mock MCP, loop, CLI, dashboard, marketing site)
  is built.
