import { describe, it, expect } from 'vitest';
import {
  LocalLexicalEmbeddings,
  cosine,
  scoreNovelty,
} from '../src/engine/novelty.js';
import type { Theme } from '../src/engine/types.js';

const emb = new LocalLexicalEmbeddings();

function theme(key: string, label: string, summary: string): Theme {
  return { key, label, summary, quotes: [], sessionId: 's' };
}

describe('cosine', () => {
  it('is 1 for identical content', () => {
    const a = emb.embed('pricing opacity budget finance manager');
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });

  it('is 0 for disjoint vocabulary', () => {
    const a = emb.embed('pricing budget finance manager quarter');
    const b = emb.embed('mobile offline phone travelling notification');
    expect(cosine(a, b)).toBe(0);
  });

  it('is between for partial overlap', () => {
    const a = emb.embed('pricing budget finance');
    const b = emb.embed('pricing budget mobile');
    const s = cosine(a, b);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('scoreNovelty', () => {
  it('treats the first session as fully novel', () => {
    const r = scoreNovelty([theme('a', 'Pricing opacity', 'cost predictability')], [], emb);
    expect(r.novelty).toBe(1);
    expect(r.matches[0]!.status).toBe('novel');
  });

  it('scores a near-exact repeat as low novelty and matched', () => {
    const t = theme('a', 'Pricing opacity', 'buyers cannot predict cost next quarter finance');
    const acc = [
      { key: 'a', vector: emb.embed('Pricing opacity buyers cannot predict cost next quarter finance') },
    ];
    const r = scoreNovelty([t], acc, emb);
    expect(r.novelty).toBeLessThan(0.05);
    expect(r.matches[0]!.status).toBe('matched');
  });

  it('averages per-theme novelty across a session', () => {
    const novel = theme('b', 'Mobile offline access', 'reviewing on a phone without connection breaks');
    const repeat = theme('a', 'Pricing opacity', 'buyers cannot predict cost next quarter');
    const acc = [
      { key: 'a', vector: emb.embed('Pricing opacity buyers cannot predict cost next quarter') },
    ];
    const r = scoreNovelty([novel, repeat], acc, emb);
    // one fully-novel (~1) + one repeat (~0) => mean around 0.5
    expect(r.novelty).toBeGreaterThan(0.4);
    expect(r.novelty).toBeLessThan(0.6);
  });
});
