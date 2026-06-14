/** Dev harness: run the loop and print the novelty curve, verifier scores, and verdict. */
import { runLoop } from '../src/engine/runLoop.js';
import type { RunConfig } from '../src/engine/types.js';

const config: RunConfig = {
  studyId: 'pricing-study',
  noveltyThreshold: 0.15,
  kConsecutive: 3,
  qualityFloor: 0.6,
  budgetCapUsd: 1e9,
  costPerSessionUsd: 300,
  approveWrites: false,
};

for await (const ev of runLoop(config)) {
  if (ev.type === 'iteration_complete') {
    const it = ev.iteration;
    const bar = '█'.repeat(Math.round(it.novelty * 40));
    console.log(
      `s${String(it.index).padStart(2)}  nov ${it.novelty.toFixed(3)}  ` +
        `ver ${it.verifier.score.toFixed(2)}  streak ${ev.thresholdStreak}  ${bar}`,
    );
  } else if (ev.type === 'verdict') {
    console.log(
      `\nVERDICT: ${ev.verdict.kind} — ${ev.verdict.headline}` +
        `\nsessions ${ev.report.sessionsAnalysed}/${ev.report.sessionsAvailable}` +
        `  cancelled ${ev.report.sessionsCancelled}  savings $${ev.report.estimatedSavingsUsd}` +
        `  minVerifier ${ev.report.minVerifierScore}`,
    );
    console.log(
      'top findings:',
      ev.report.findings
        .map((f) => `${f.title} (${f.participantCount}p, stab s${f.stabilizedAtSession})`)
        .join(' | '),
    );
  }
}
