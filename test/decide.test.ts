import { describe, it, expect } from 'vitest';
import { decide, thresholdStreak, type DecisionState } from '../src/engine/decide.js';

const base: Omit<DecisionState, 'index' | 'noveltyHistory' | 'verifierScore'> = {
  sessionsAvailable: 14,
  noveltyThreshold: 0.15,
  kConsecutive: 3,
  qualityFloor: 0.6,
  budgetExceeded: false,
};

describe('thresholdStreak', () => {
  it('counts only the trailing below-threshold run', () => {
    expect(thresholdStreak([0.5, 0.2, 0.1, 0.05], 0.15)).toBe(2);
    expect(thresholdStreak([0.1, 0.1, 0.1], 0.15)).toBe(3);
    expect(thresholdStreak([0.05, 0.2, 0.1], 0.15)).toBe(1);
    expect(thresholdStreak([], 0.15)).toBe(0);
  });
});

describe('decide', () => {
  const declining = [1, 0.8, 0.45, 0.37, 0.31, 0.29, 0.12, 0.0, 0.0];

  it('saturates when k consecutive sessions fall below threshold', () => {
    const v = decide({ ...base, index: 9, noveltyHistory: declining, verifierScore: 1 });
    expect(v?.kind).toBe('saturated');
    expect(v?.haltedAtIndex).toBe(9);
  });

  it('does not saturate one session early (k-1 streak)', () => {
    const v = decide({
      ...base,
      index: 8,
      noveltyHistory: declining.slice(0, 8),
      verifierScore: 1,
    });
    expect(v).toBeNull();
  });

  it('quality_halt takes precedence over saturation', () => {
    const v = decide({ ...base, index: 9, noveltyHistory: declining, verifierScore: 0.5 });
    expect(v?.kind).toBe('quality_halt');
  });

  it('budget_halt fires when spend exceeds the cap', () => {
    const v = decide({
      ...base,
      index: 3,
      noveltyHistory: [1, 0.8, 0.45],
      verifierScore: 1,
      budgetExceeded: true,
    });
    expect(v?.kind).toBe('budget_halt');
  });

  it('not_saturated when sessions run out with novelty still high', () => {
    const v = decide({
      ...base,
      index: 14,
      noveltyHistory: Array(14).fill(0.5),
      verifierScore: 1,
    });
    expect(v?.kind).toBe('not_saturated');
  });

  it('continues mid-run when no condition is met', () => {
    const v = decide({ ...base, index: 3, noveltyHistory: [1, 0.8, 0.45], verifierScore: 1 });
    expect(v).toBeNull();
  });
});
