# Atlas — a walkthrough

> **An agent loop that knows when research is done.**
> A presentation-oriented tour: what it is, the idea behind it, how to read it, and how to run it.

---

## 1. The one-liner

Atlas runs an autonomous loop over interview transcripts and tells a research team the moment further interviews stop teaching them anything new — then stops, and reports how much recruiting budget that saved.

It processes **one interview session per iteration**: fetch the transcript, extract the themes, measure how much is genuinely new, have a *separate* model check the work, and decide whether to keep going. It halts on a verifiable condition, hands back a grounded report, and never makes a change to the research platform without a human's say-so.

## 2. The problem

Qualitative research has no natural stopping point. A study plan says "recruit 12–15 participants" because nobody actually knows the right number. So teams keep interviewing — often well past the point where new sessions teach them anything — and every extra session costs real money in incentives, recruiting, and researcher time. "Have we heard enough?" is usually answered by gut feel, if it's answered at all.

## 3. The insight (the load-bearing idea)

Qualitative researchers already have the answer: **saturation** — you stop interviewing when new sessions stop yielding new themes. What makes saturation interesting to an *engineer* is that it's **verifiable**. An autonomous loop needs a halting condition it can actually check — not a vibe, a measurement. Saturation turns "enough research" into a condition a machine can test.

That's the whole bet: give the loop a stopping condition grounded in an idea researchers already trust.

## 4. How the loop works

Each pass through the loop consumes exactly one session and ends with a decision: continue, or halt with a verdict.

| Step | What happens |
|------|--------------|
| **1. Fetch** | Pull the next transcript through Great Question's MCP server (`search_studies` → `list_repo_sessions` → `get_transcript`). |
| **2. Extract** | Read the transcript and pull out the themes, each anchored to verbatim quotes. |
| **3. Score novelty** | Embed the new themes and compare them against everything heard so far. The distance is the session's novelty score. |
| **4. Verify** | A *separate* model re-reads the transcript and grades the extraction for faithfulness. The worker never grades its own work. |
| **5. Decide** | Continue, or halt against the saturation threshold, the quality floor, and the budget cap — then loop. |

The decision runs **after every session**, not just at the end — that's what lets Atlas stop at session 9 instead of grinding through all 14.

## 5. The novelty number, in plain terms

Novelty is a **0-to-1 score** — read it as *"what fraction of this session was new information."*

- **1.0** = everything was new · **0.5** = half new, half repeat · **0.15** = ~15% new · **0.0** = pure repetition.

How it's built: for each theme, `newness = 1 − (similarity to the closest theme already heard)`. A theme you've basically heard before scores ~0; a brand-new theme scores ~1. The session's novelty is the **average** across its themes.

A quick worked example — a session with four themes:

| Theme | similarity to prior | newness |
|---|---|---|
| nearly verbatim repeat | 0.95 | 0.05 |
| already heard | 0.90 | 0.10 |
| fresh angle on a known theme | 0.70 | 0.30 |
| brand new | 0.00 | 1.00 |

Novelty = (0.05 + 0.10 + 0.30 + 1.00) ÷ 4 = **0.36** → "about a third of this session was new." (Session 1 is always 1.0 — nothing's been heard yet for its themes to resemble.)

## 6. The dials you set

A run is configured, not prompted. Four knobs define the "ask":

| Dial | Default | In plain terms |
|------|---------|----------------|
| **Novelty threshold** | 0.15 | The line on the 0–1 novelty scale below which a session counts as "barely taught us anything." Lower = stricter (run longer); higher = stop sooner. |
| **k — consecutive sessions** | 3 | How many sessions *in a row* must fall below the threshold before declaring saturation. The patience knob — guards against stopping on a single fluke dip. The streak resets if novelty rebounds. |
| **Quality floor** | 0.6 | The minimum extraction faithfulness (0–1) the loop tolerates. Below it → halt and review, because measuring saturation over untrustworthy themes is meaningless. |
| **Budget cap** | — | A hard ceiling on agent spend. Crossing it halts the run — a recorded verdict, not a crash. |

**Threshold and k together** are how the researcher's idea of saturation becomes machine-checkable: *novelty below the threshold for k consecutive sessions.*

> **On the quality floor specifically:** you don't pick it by feel — you measure where *faithful* extractions normally score and set the floor a notch below that band (so it never false-alarms on a healthy run but still catches a real collapse). The default 0.6 sits just under the demo's one deliberate dip (0.667), so the blip is tolerated while anything worse trips.

## 7. Four ways a run ends

A run never simply stops — it concludes with one of four verdicts, each telling the team something different to do next:

| Verdict | Trigger | What it means |
|---------|---------|---------------|
| **Saturated** | novelty below threshold for k consecutive sessions | Stop recruiting — the themes have converged. |
| **Quality halt** | verifier faithfulness below the floor | Review the extraction before resuming — synthesis is no longer trustworthy. |
| **Budget halt** | agent spend over the cap | Raise the cap or accept partial synthesis. |
| **Not saturated** | sessions ran out, novelty still high | Keep recruiting — the field is still teaching. |

## 8. What a finished run hands back

On the demo study, Atlas reaches **saturation at session 9 of 14**: sessions 7, 8, and 9 are the three consecutive sessions below the 0.15 threshold. That cancels 5 remaining sessions → **≈ $1,500 saved** at $300/session.

The report it produces is **grounded** — every finding cites verbatim quotes traceable to their source session and timestamp. For example: *"Pricing opacity erodes trust before the first invoice — raised by 7 of 9 participants, stabilized by session 4,"* backed by the quote *"I couldn't tell my manager what this would cost us next quarter, so I stopped recommending it."* (S4 · 00:18:22). Nothing renders as an unattributed claim.

The visual payoff — the "money shot" — is the **novelty curve declining and crossing the threshold line** live, which you can watch in the dashboard.

## 9. Trust by design

An agent that spends money and writes findings has to be built defensively. Four constraints hold on every run — enforced in code, not just described:

1. **Every claim is grounded** — no finding without a citable quote tied to a session and timestamp.
2. **The worker never grades itself** — extraction and verification are separate (in live mode, *different models*); the loop refuses to start if they're the same.
3. **Writes wait for a human** — any change to the research platform (e.g. pausing recruiting) is recorded and surfaced, never auto-executed. Reading is autonomous; changing things is not.
4. **A hard budget cap** — crossing it halts the loop, recorded like any other verdict.

## 10. What's real vs. what's demo (the honest part)

This build runs in **demo mode**: fully deterministic, offline, no API key, no cost. Worth being precise about what that means, because it's the thing to defend:

- **The loop's logic is real.** Fetch is a real MCP call. Novelty is genuinely computed cosine distance — the declining curve *emerges* from the text, it isn't scripted. Verification genuinely re-checks that every quote is grounded in the transcript. The four-verdict decision runs on real numbers.
- **Only theme generation is staged.** The extractor reads gold annotations from the fixtures instead of calling a model.

**Is there a prompt anywhere?** Not in this build — there are zero LLM prompts; the Anthropic SDK isn't even a dependency. Prompts enter only in **live mode**, at two clearly-marked seams, run by *two different models*:

- **Extractor** (`claude-opus-4-8`) — a prompt that pulls themes + verbatim quotes from the transcript, forced into a structured schema.
- **Verifier** (`claude-sonnet-4-6`, a different model) — a faithfulness-grading prompt that returns the 0–1 score the quality floor is compared against.

Keeping those as separate prompts on separate models is the maker/checker split, at the prompt level. Demo mode swaps both for deterministic stand-ins that produce the same shaped outputs — so going live is a one-module change, not a rewrite.

## 11. The MCP workaround

Atlas is built on Great Question's MCP server. Their real server (`greatquestion.co/api/mcp/v1`, OAuth 2.1/PKCE) is gated early-access and not open to this account yet — and the advertised npm package doesn't actually exist. So the repo ships a **mock MCP server that speaks the real Model Context Protocol** and exposes Great Question's real read tools, backed by local fixtures.

The engine talks to it as a normal MCP **client**, so swapping in the real server later is a transport/URL/auth change above an unchanged loop. The demo isn't faking MCP — it's running the real protocol against a stand-in backend.

## 12. Run it yourself

No API key needed.

```bash
npm install
npm run demo          # streams a run to the terminal → verdict + report in out/
```

Set the dials yourself:

```bash
npx tsx src/cli.ts run --study pricing-study --threshold 0.15 --k 3 --budget 50
# try: --budget 0.05 (budget halt) · --quality-floor 0.7 (quality halt) · --threshold 0 (not saturated)
```

Or watch it in the browser:

```bash
npm run dashboard     # → http://localhost:4317   (or /?run=1 to auto-start)
```

The dashboard has one extra knob, **Pace (ms/session)** — purely cosmetic. The real run finishes in ~70ms, too fast to see, so the server slows the *stream* to a watchable speed. It changes nothing about the run or the result; it's the speed dial on a video player. Use a higher pace (e.g. 1100) when screen-sharing so the curve visibly crosses the threshold.

## 13. Under the hood, in one breath

A **thin, pure engine** (the loop) that emits a single event stream, sitting behind **four interfaces** (transcript provider, extractor, verifier, embedder) and rendered by **three surfaces** (a streaming CLI, a live dashboard, and the marketing site). Because every surface consumes the same `RunEvent` stream, the dashboard required *zero* engine changes. The whole thing is ~1,950 lines of TypeScript, with 20 tests covering all four verdicts, the novelty math, and full end-to-end runs.

## 14. Where it goes next

Three documented seams, in priority order:

1. **Live run mode** — swap the deterministic extractor/verifier for the opus-worker / sonnet-verifier prompts above. One module each.
2. **Real Great Question MCP** — point the provider at the real server when access lands (transport + OAuth).
3. **Event-driven operation** — today a run processes a fixed batch and exits; trigger it on a "new session published" webhook and persist state between sessions to make it genuinely always-on.

None of these change the loop — only what's plugged into it. That separability is the design, not an afterthought.

---

*Atlas is an engineering prototype, built to test one idea: that saturation — a concept qualitative researchers already trust — gives an autonomous agent loop a stopping condition it can actually verify. Great Question is referenced as the research platform whose MCP this builds on; no affiliation or endorsement implied.*
