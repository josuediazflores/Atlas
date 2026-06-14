/**
 * Verification (step 4 of the loop) — the maker/checker split.
 *
 * A separate verifier re-reads the transcript and grades the extraction for
 * faithfulness: every claimed quote must actually be supported by the
 * transcript. This is a genuine grounding check, not a rubber stamp — the
 * demo verifier independently re-derives support from the transcript text and
 * does not trust the extractor's claimed quote strings.
 *
 * The model that does the work is never the model that grades it. In demo mode
 * the extractor and verifier are distinct components; in the live seam they
 * MUST be different models (e.g. opus worker / sonnet verifier), asserted at
 * startup.
 *
 * LIVE SEAM: a `ClaudeVerifier` would call claude-sonnet-4-6 to grade
 * faithfulness, with an assertion that its model id !== the extractor's.
 */

import type { Theme, Transcript, VerifierResult, Quote } from './types.js';
import { tokenize } from './novelty.js';

export interface Verifier {
  readonly id: string;
  readonly callsModel: boolean;
  verify(transcript: Transcript, themes: Theme[]): Promise<VerifierResult>;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Jaccard overlap of content tokens. */
function tokenOverlap(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / new Set([...sa, ...sb]).size;
}

export class DeterministicVerifier implements Verifier {
  readonly id = 'demo-deterministic-verifier';
  readonly callsModel = false;

  async verify(
    transcript: Transcript,
    themes: Theme[],
  ): Promise<VerifierResult> {
    const byLine = new Map(transcript.lines.map((l) => [l.line, l]));
    let supported = 0;
    let total = 0;
    const unsupported: Quote[] = [];

    for (const theme of themes) {
      for (const q of theme.quotes) {
        total++;
        if (this.isSupported(q, byLine)) supported++;
        else unsupported.push(q);
      }
    }

    const score = total === 0 ? 1 : supported / total;
    const reasoning =
      unsupported.length === 0
        ? `All ${total} cited quotes are supported verbatim by the transcript.`
        : `${supported}/${total} cited quotes supported; ${unsupported.length} could not be grounded ` +
          `(e.g. line ${unsupported[0]!.line}: "${truncate(unsupported[0]!.text)}").`;

    return {
      score: Math.round(score * 1000) / 1000,
      supportedQuotes: supported,
      totalQuotes: total,
      reasoning,
      unsupported,
    };
  }

  /** A quote is supported if its claimed text matches the transcript near its citation. */
  private isSupported(
    q: Quote,
    byLine: Map<number, { line: number; text: string }>,
  ): boolean {
    const claim = normalize(q.text);
    if (!claim) return false;
    // Check the cited line and a small window around it.
    for (let l = q.line - 2; l <= q.line + 2; l++) {
      const line = byLine.get(l);
      if (!line) continue;
      const src = normalize(line.text);
      if (src.includes(claim) || claim.includes(src)) return true;
      if (tokenOverlap(q.text, line.text) >= 0.8) return true;
    }
    return false;
  }
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
