/** Render a Report as a grounded, citable Markdown findings report. */

import type { Report, Quote } from '../engine/types.js';

const VERDICT_LABEL: Record<string, string> = {
  saturated: 'Saturated',
  quality_halt: 'Quality halt',
  budget_halt: 'Budget halt',
  not_saturated: 'Not saturated',
};

export function reportToMarkdown(report: Report): string {
  const r = report;
  const lines: string[] = [];

  lines.push(`# Atlas — Findings Report`);
  lines.push('');
  lines.push(`**Study:** ${r.studyName} \`${r.studyId}\` · **Run:** \`${r.runId}\``);
  lines.push('');
  lines.push(`## Verdict — ${VERDICT_LABEL[r.verdict.kind] ?? r.verdict.kind}`);
  lines.push('');
  lines.push(`**${r.verdict.headline} of ${r.sessionsAvailable}.** ${r.verdict.action}`);
  lines.push('');

  lines.push(`## Outcome`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Sessions analysed | ${r.sessionsAnalysed} of ${r.sessionsAvailable} |`);
  lines.push(`| Sessions cancelled | ${r.sessionsCancelled} |`);
  lines.push(`| Est. cost per session | $${r.costPerSessionUsd.toLocaleString()} |`);
  lines.push(`| **Estimated savings** | **$${r.estimatedSavingsUsd.toLocaleString()}** |`);
  lines.push(
    `| Verifier floor | ${r.verifierFloorHeld ? 'held' : 'breached'} (min ${r.minVerifierScore}) |`,
  );
  lines.push('');

  lines.push(`## Novelty per session`);
  lines.push('');
  lines.push('```');
  lines.push(sparkline(r.noveltyCurve));
  lines.push('```');
  lines.push('');

  lines.push(`## Findings`);
  lines.push('');
  for (const f of r.findings) {
    lines.push(`### ${f.rank}. ${f.title}`);
    lines.push('');
    const stab =
      f.stabilizedAtSession != null
        ? ` Theme stabilized by session ${f.stabilizedAtSession}.`
        : '';
    lines.push(`${f.detail}${stab}`);
    lines.push('');
    for (const q of f.quotes) {
      lines.push(`> “${q.text}”`);
      lines.push(`> — ${cite(q)}`);
      lines.push('');
    }
  }

  if (r.pendingApprovals.length > 0) {
    lines.push(`## Pending approvals`);
    lines.push('');
    lines.push(
      `_Writes against the research platform are never auto-executed — they wait for explicit human approval._`,
    );
    lines.push('');
    for (const a of r.pendingApprovals) {
      lines.push(`- **${a.action}** — ${a.rationale} _(${a.status}; tool \`${a.tool}\`)_`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `_Every finding above cites a verbatim quote traceable to its source session and timestamp. Extraction and verification were performed by separate components — the worker never grades its own work._`,
  );
  lines.push('');
  return lines.join('\n');
}

export function cite(q: Quote): string {
  return `${q.sessionId.toUpperCase()} · ${q.t}`;
}

/** Compact unicode sparkline of the novelty curve. */
export function sparkline(values: number[]): string {
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(1, ...values);
  const spark = values
    .map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))])
    .join('');
  const labels = values.map((_, i) => `s${i + 1}`).join(' ');
  return `${spark}\n${labels}`;
}
