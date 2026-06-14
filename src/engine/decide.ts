/**
 * The decision step (step 5). A run never simply stops — it concludes with one
 * of four verdicts, each telling the team something different to do next:
 *
 *   saturated      novelty stayed below threshold for k consecutive sessions
 *   quality_halt   verifier faithfulness dropped below the floor
 *   budget_halt    agent spend exceeded the cap
 *   not_saturated  sessions ran out while novelty was still high
 *
 * Precedence at a given iteration: quality and budget are hard limits checked
 * first, then saturation, then exhaustion. (In a healthy run none of the limits
 * trip and saturation is what fires.)
 */

import type { Verdict, VerdictKind } from './types.js';

export interface DecisionState {
  index: number; // 1-based index of the iteration just completed
  sessionsAvailable: number;
  noveltyHistory: number[]; // novelty per completed iteration, in order
  verifierScore: number; // verifier score of the iteration just completed
  budgetExceeded: boolean;
  noveltyThreshold: number;
  kConsecutive: number;
  qualityFloor: number;
}

/** Count consecutive trailing sessions with novelty below threshold. */
export function thresholdStreak(history: number[], threshold: number): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]! < threshold) streak++;
    else break;
  }
  return streak;
}

/** Returns a Verdict if the run should halt after this iteration, else null. */
export function decide(s: DecisionState): Verdict | null {
  if (s.verifierScore < s.qualityFloor) {
    return verdict('quality_halt', s.index);
  }
  if (s.budgetExceeded) {
    return verdict('budget_halt', s.index);
  }
  if (thresholdStreak(s.noveltyHistory, s.noveltyThreshold) >= s.kConsecutive) {
    return verdict('saturated', s.index);
  }
  if (s.index >= s.sessionsAvailable) {
    return verdict('not_saturated', s.index);
  }
  return null;
}

function verdict(kind: VerdictKind, index: number): Verdict {
  switch (kind) {
    case 'saturated':
      return {
        kind,
        headline: `Saturated at session ${index}`,
        action: 'Stop recruiting — the themes have converged.',
        haltedAtIndex: index,
      };
    case 'quality_halt':
      return {
        kind,
        headline: `Quality halt at session ${index}`,
        action: 'Review the extraction before resuming — synthesis is no longer trustworthy.',
        haltedAtIndex: index,
      };
    case 'budget_halt':
      return {
        kind,
        headline: `Budget halt at session ${index}`,
        action: 'Raise the cap or accept partial synthesis.',
        haltedAtIndex: index,
      };
    case 'not_saturated':
      return {
        kind,
        headline: `Not saturated — sessions exhausted at ${index}`,
        action: 'Keep recruiting — the field is still teaching.',
        haltedAtIndex: index,
      };
  }
}
