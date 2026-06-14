/**
 * Theme extraction (step 2 of the loop).
 *
 * The loop depends only on the `Extractor` interface. In demo mode the
 * `DeterministicExtractor` reads gold theme annotations from the fixture and
 * grounds each quote in the transcript it was handed — fully offline, no API
 * key, no cost.
 *
 * LIVE SEAM: a `ClaudeExtractor` would call claude-opus-4-8 with structured
 * output (output_config.format) and adaptive thinking to extract themes +
 * verbatim supporting quotes. It must be a DIFFERENT model from the verifier
 * (see verify.ts) — the worker never grades its own work.
 */

import type { Theme, Transcript, Quote } from './types.js';
import { loadSession } from '../fixtures.js';

export interface Extractor {
  readonly id: string;
  /** Whether this extractor calls a model (affects budget accounting). */
  readonly callsModel: boolean;
  extract(transcript: Transcript): Promise<Theme[]>;
}

export class DeterministicExtractor implements Extractor {
  readonly id = 'demo-deterministic-extractor';
  readonly callsModel = false;

  async extract(transcript: Transcript): Promise<Theme[]> {
    const raw = loadSession(transcript.studyId, transcript.sessionId);
    const byLine = new Map(transcript.lines.map((l) => [l.line, l]));

    return raw.themes.map((t) => {
      const quotes: Quote[] = t.quotes.map((q) => {
        const line = byLine.get(q.line);
        if (!line) {
          throw new Error(
            `Theme "${t.key}" in ${transcript.sessionId} cites missing line ${q.line}`,
          );
        }
        return {
          sessionId: transcript.sessionId,
          line: q.line,
          t: line.t,
          // `claim` lets a fixture stage an unfaithful quote the verifier catches.
          text: q.claim ?? line.text,
        };
      });
      return {
        key: t.key,
        label: t.label,
        summary: t.summary,
        quotes,
        sessionId: transcript.sessionId,
      };
    });
  }
}
