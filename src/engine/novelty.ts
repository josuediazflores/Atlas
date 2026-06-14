/**
 * Novelty scoring.
 *
 * New themes are embedded and compared against the accumulated theme set; the
 * distance becomes the session's novelty score. Demo mode uses a deterministic
 * local lexical embedding (no API key, no cost) so the curve is fully
 * reproducible. The math is real: novelty emerges from actual text overlap
 * between a session's themes and everything seen so far — it is not scripted.
 *
 * LIVE SEAM: swap `LocalLexicalEmbeddings` for a Voyage-backed implementation
 * (Anthropic has no native embeddings API; Voyage is its recommended partner).
 * The EmbeddingProvider interface is all the loop depends on.
 */

import type { Theme, ThemeMatch } from './types.js';

/** A unit-normalized sparse term-frequency vector. */
export type EmbeddingVector = Map<string, number>;

export interface EmbeddingProvider {
  readonly id: string;
  embed(text: string): EmbeddingVector;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that',
  'these', 'those', 'as', 'at', 'by', 'from', 'into', 'about', 'than', 'then',
  'so', 'too', 'very', 'can', 'cannot', 'cant', 'will', 'would', 'could', 'should',
  'do', 'does', 'did', 'has', 'have', 'had', 'not', 'no', 'they', 'them', 'their',
  'you', 'your', 'we', 'our', 'i', 'me', 'my', 'he', 'she', 'his', 'her',
  'up', 'out', 'if', 'when', 'who', 'what', 'which', 'how', 'all', 'each',
  'more', 'most', 'some', 'any', 'because', 'while', 'before', 'after', 'over',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Deterministic local embedding: L2-normalized term-frequency over content
 * tokens. Cosine similarity of two such vectors is the overlap of their
 * content vocabulary — repeated themes (shared wording) score high similarity
 * and low novelty; genuinely new themes score low similarity and high novelty.
 */
export class LocalLexicalEmbeddings implements EmbeddingProvider {
  readonly id = 'local-lexical-v1';

  embed(text: string): EmbeddingVector {
    const tf = new Map<string, number>();
    for (const tok of tokenize(text)) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    let sumSq = 0;
    for (const v of tf.values()) sumSq += v * v;
    const norm = Math.sqrt(sumSq) || 1;
    const out: EmbeddingVector = new Map();
    for (const [k, v] of tf) out.set(k, v / norm);
    return out;
  }
}

/** Cosine similarity of two unit-normalized sparse vectors, 0..1. */
export function cosine(a: EmbeddingVector, b: EmbeddingVector): number {
  // Iterate the smaller map for efficiency.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) dot += v * w;
  }
  // Vectors are unit-normalized, so the dot product is the cosine. Clamp for
  // floating-point safety.
  return Math.max(0, Math.min(1, dot));
}

/** Text used to represent a theme in embedding space. */
export function themeText(theme: Pick<Theme, 'label' | 'summary'>): string {
  return `${theme.label} ${theme.summary}`;
}

export interface NoveltyResult {
  /** Session novelty score: mean over themes of (1 - max similarity). */
  novelty: number;
  matches: ThemeMatch[];
}

/**
 * Score one session's themes against the accumulated theme vectors.
 *
 * @param sessionThemes themes extracted from the current session
 * @param accumulated   already-seen themes, keyed for match reporting
 * @param embedder      embedding provider
 * @param matchThreshold similarity at/above which a theme is "matched" (display)
 */
export function scoreNovelty(
  sessionThemes: Theme[],
  accumulated: { key: string; vector: EmbeddingVector }[],
  embedder: EmbeddingProvider,
  matchThreshold = 0.6,
): NoveltyResult {
  const matches: ThemeMatch[] = [];
  for (const theme of sessionThemes) {
    const v = embedder.embed(themeText(theme));
    let best = 0;
    let bestKey: string | null = null;
    for (const prior of accumulated) {
      const sim = cosine(v, prior.vector);
      if (sim > best) {
        best = sim;
        bestKey = prior.key;
      }
    }
    matches.push({
      themeKey: theme.key,
      matchedKey: best >= matchThreshold ? bestKey : null,
      similarity: round(best),
      novelty: round(1 - best),
      status: best >= matchThreshold ? 'matched' : 'novel',
    });
  }
  const novelty =
    matches.length === 0
      ? 0
      : matches.reduce((s, m) => s + m.novelty, 0) / matches.length;
  return { novelty: round(novelty), matches };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
