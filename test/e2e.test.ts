import { describe, it, expect } from 'vitest';
import { runLoop } from '../src/engine/runLoop.js';
import type { RunConfig, Report } from '../src/engine/types.js';
import { DeterministicExtractor } from '../src/engine/extract.js';
import { DeterministicVerifier } from '../src/engine/verify.js';

async function run(overrides: Partial<RunConfig> = {}): Promise<Report> {
  const config: RunConfig = {
    studyId: 'pricing-study',
    noveltyThreshold: 0.15,
    kConsecutive: 3,
    qualityFloor: 0.6,
    budgetCapUsd: 1e9,
    costPerSessionUsd: 300,
    approveWrites: false,
    ...overrides,
  };
  let report: Report | undefined;
  for await (const ev of runLoop(config)) {
    if (ev.type === 'verdict') report = ev.report;
  }
  if (!report) throw new Error('run produced no verdict');
  return report;
}

describe('Atlas end-to-end', () => {
  it('saturates at session 9 of 14 and estimates $1,500 of savings', async () => {
    const r = await run();
    expect(r.verdict.kind).toBe('saturated');
    expect(r.verdict.haltedAtIndex).toBe(9);
    expect(r.sessionsAnalysed).toBe(9);
    expect(r.sessionsAvailable).toBe(14);
    expect(r.sessionsCancelled).toBe(5);
    expect(r.estimatedSavingsUsd).toBe(1500);
    expect(r.verifierFloorHeld).toBe(true);
  });

  it('surfaces the pricing theme as the top finding, grounded in quotes', async () => {
    const r = await run();
    const top = r.findings[0]!;
    expect(top.title).toMatch(/Pricing opacity/);
    expect(top.participantCount).toBe(7);
    expect(top.stabilizedAtSession).toBe(4);
    expect(top.quotes.length).toBeGreaterThan(0);
    // The famous quote from the marketing site is grounded in the run.
    const all = r.findings.flatMap((f) => f.quotes.map((q) => q.text));
    expect(all.some((t) => /couldn't tell my manager/i.test(t))).toBe(true);
  });

  it('proposes a write that stays human-gated (never auto-executed)', async () => {
    const r = await run();
    expect(r.pendingApprovals).toHaveLength(1);
    expect(r.pendingApprovals[0]!.tool).toBe('pause_recruiting');
    expect(r.pendingApprovals[0]!.status).toBe('pending');
  });

  it('halts on budget when the cap is tiny', async () => {
    const r = await run({ budgetCapUsd: 0.05 });
    expect(r.verdict.kind).toBe('budget_halt');
    expect(r.sessionsAnalysed).toBeLessThan(9);
    expect(r.estimatedSavingsUsd).toBe(0);
  });

  it('halts on quality when the floor is above the verifier dip', async () => {
    const r = await run({ qualityFloor: 0.7 });
    expect(r.verdict.kind).toBe('quality_halt');
    expect(r.verdict.haltedAtIndex).toBe(5);
    expect(r.verifierFloorHeld).toBe(false);
  });

  it('reports not_saturated when novelty never settles below threshold', async () => {
    const r = await run({ noveltyThreshold: 0 });
    expect(r.verdict.kind).toBe('not_saturated');
    expect(r.sessionsAnalysed).toBe(14);
    expect(r.sessionsCancelled).toBe(0);
    expect(r.estimatedSavingsUsd).toBe(0);
  });

  it('enforces worker ≠ verifier (separate identities)', () => {
    expect(new DeterministicExtractor().id).not.toBe(new DeterministicVerifier().id);
  });
});
