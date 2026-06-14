/**
 * Budget tracking. Every run has a hard spending cap; crossing it halts the
 * loop — recorded and reported as a verdict, never as a crash.
 *
 * This tracks the AGENT's compute spend (token cost), which is distinct from
 * the RESEARCH cost per session (incentives + recruiting + researcher time)
 * used to compute savings. In demo mode no model is called, so the per-
 * iteration cost is *estimated* as if it had run live (opus worker + sonnet
 * verifier) — this keeps the budget meter meaningful and shows what a live run
 * would roughly spend.
 */

import type { Theme, Transcript } from './types.js';

// USD per 1M tokens (matches the live-seam model choices).
const RATES = {
  opus: { input: 5, output: 25 }, // claude-opus-4-8 (extractor)
  sonnet: { input: 3, output: 15 }, // claude-sonnet-4-6 (verifier)
} as const;

function transcriptTokens(t: Transcript): number {
  const chars = t.lines.reduce((s, l) => s + l.speaker.length + l.text.length + 2, 0);
  return Math.ceil(chars / 4); // ~4 chars/token
}

/**
 * Estimate what one iteration would cost live: opus reads the transcript and
 * emits themes; sonnet re-reads the transcript and grades faithfulness.
 */
export function estimateIterationCostUsd(t: Transcript, themes: Theme[]): number {
  const tx = transcriptTokens(t);
  const extractIn = tx + 400; // transcript + extraction instructions
  const extractOut = themes.length * 90; // ~90 tokens/theme (label, summary, quotes)
  const verifyIn = tx + themes.length * 120 + 300;
  const verifyOut = 160;

  const usd =
    (extractIn * RATES.opus.input + extractOut * RATES.opus.output) / 1e6 +
    (verifyIn * RATES.sonnet.input + verifyOut * RATES.sonnet.output) / 1e6;
  return Math.round(usd * 10000) / 10000;
}

export class BudgetTracker {
  private spentUsd = 0;
  constructor(readonly capUsd: number) {}

  add(costUsd: number): void {
    this.spentUsd += costUsd;
  }

  get spent(): number {
    return Math.round(this.spentUsd * 10000) / 10000;
  }

  get remaining(): number {
    return Math.round((this.capUsd - this.spentUsd) * 10000) / 10000;
  }

  exceeded(): boolean {
    return this.spentUsd > this.capUsd;
  }
}
