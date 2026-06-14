#!/usr/bin/env node
/**
 * Atlas CLI. Streams a saturation run to the terminal — phases, the MCP
 * tool-call log, a live halt-condition tracker, and the novelty-vs-threshold
 * "money shot" chart — then prints the verdict and grounded findings and writes
 * the report to out/.
 *
 *   atlas run --study pricing-study [--threshold 0.15] [--k 3]
 *             [--quality-floor 0.6] [--budget 100000] [--cost-per-session 300]
 *             [--approve] [--out out] [--json]
 */

import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLoop } from './engine/runLoop.js';
import type { RunConfig, Report, Iteration, Verdict } from './engine/types.js';
import { reportToMarkdown, cite } from './report/markdown.js';

// ─── Colors ─────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const gold = wrap('38;5;179');
const dim = wrap('2');
const bold = wrap('1');
const green = wrap('32');
const red = wrap('38;5;174');
const ink = wrap('38;5;223');

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function usage(): void {
  process.stdout.write(
    `${gold('Atlas')} — an agent loop that knows when research is done.\n\n` +
      `Usage:\n` +
      `  atlas run --study <id> [options]\n\n` +
      `Options:\n` +
      `  --study <id>            study to synthesize (e.g. pricing-study)\n` +
      `  --threshold <n>         novelty saturation threshold (default ${num('ATLAS_NOVELTY_THRESHOLD', 0.15)})\n` +
      `  --k <n>                 consecutive low-novelty sessions to saturate (default ${num('ATLAS_K_CONSECUTIVE', 3)})\n` +
      `  --quality-floor <n>     verifier faithfulness floor (default ${num('ATLAS_QUALITY_FLOOR', 0.6)})\n` +
      `  --budget <usd>          hard agent-spend cap (default ${num('ATLAS_BUDGET_CAP', 100000)})\n` +
      `  --cost-per-session <usd> research cost per session (default ${num('ATLAS_COST_PER_SESSION', 300)})\n` +
      `  --approve               record approval of proposed writes (still never auto-executed)\n` +
      `  --out <dir>             output directory for the report (default out)\n` +
      `  --json                  print the report JSON to stdout at the end\n`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd !== 'run') {
    usage();
    process.exit(cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 1);
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      study: { type: 'string' },
      threshold: { type: 'string' },
      k: { type: 'string' },
      'quality-floor': { type: 'string' },
      budget: { type: 'string' },
      'cost-per-session': { type: 'string' },
      approve: { type: 'boolean', default: false },
      out: { type: 'string', default: 'out' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const config: RunConfig = {
    studyId: values.study ?? 'pricing-study',
    noveltyThreshold: values.threshold
      ? Number(values.threshold)
      : num('ATLAS_NOVELTY_THRESHOLD', 0.15),
    kConsecutive: values.k ? Number(values.k) : num('ATLAS_K_CONSECUTIVE', 3),
    qualityFloor: values['quality-floor']
      ? Number(values['quality-floor'])
      : num('ATLAS_QUALITY_FLOOR', 0.6),
    budgetCapUsd: values.budget
      ? Number(values.budget)
      : num('ATLAS_BUDGET_CAP', 100000),
    costPerSessionUsd: values['cost-per-session']
      ? Number(values['cost-per-session'])
      : num('ATLAS_COST_PER_SESSION', 300),
    approveWrites: values.approve === true,
  };

  let report: Report | null = null;
  let verdict: Verdict | null = null;

  for await (const ev of runLoop(config)) {
    switch (ev.type) {
      case 'run_started': {
        const w = process.stdout.write.bind(process.stdout);
        w('\n');
        w(`  ${gold('ATLAS')}  ${dim('· an agent loop that knows when research is done')}\n`);
        w(`  ${dim('study')}    ${ink(ev.study.name)} ${dim(`(${ev.study.id}, ${ev.study.sessionCount} sessions)`)}\n`);
        w(
          `  ${dim('config')}   threshold ${gold(String(config.noveltyThreshold))} · ` +
            `k=${gold(String(config.kConsecutive))} · floor ${gold(String(config.qualityFloor))} · ` +
            `budget $${gold(config.budgetCapUsd.toLocaleString())}\n`,
        );
        w(`  ${dim('mcp')}      ${dim('search_studies → list_repo_sessions → get_transcript')}\n\n`);
        break;
      }
      case 'tool_call': {
        if (ev.iteration === 0) {
          process.stdout.write(
            `  ${dim('→')} ${dim('mcp')} ${ev.call.tool}${statusMark(ev.call.status)} ${dim(`${ev.call.durationMs}ms`)}\n`,
          );
        }
        break;
      }
      case 'iteration_complete': {
        renderIteration(ev.iteration, ev.thresholdStreak, ev.runningCostUsd, config);
        break;
      }
      case 'verdict': {
        report = ev.report;
        verdict = ev.verdict;
        break;
      }
      default:
        break;
    }
  }

  if (!report || !verdict) {
    process.stderr.write(red('Run produced no verdict.\n'));
    process.exit(1);
  }

  renderChart(report.noveltyCurve, config.noveltyThreshold, verdict.haltedAtIndex);
  renderVerdict(report, verdict);

  // Write artifacts.
  const outDir = values.out ?? 'out';
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, report.runId);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(`${base}.md`, reportToMarkdown(report));
  process.stdout.write(
    `\n  ${dim('wrote')} ${base}.json ${dim('and')} ${base}.md\n\n`,
  );

  if (values.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

function statusMark(status: 'ok' | 'error'): string {
  return status === 'ok' ? green(' ✓') : red(' ✗');
}

function bar(value: number, width = 12): string {
  const filled = Math.round(value * width);
  return gold('▇'.repeat(filled)) + dim('░'.repeat(width - filled));
}

function renderIteration(
  it: Iteration,
  streak: number,
  spend: number,
  config: RunConfig,
): void {
  const w = process.stdout.write.bind(process.stdout);
  const sat = `${Math.min(streak, config.kConsecutive)}/${config.kConsecutive}`;
  const quality = it.verifier.score >= config.qualityFloor ? green('ok') : red('LOW');
  const verErr = it.verifier.unsupported.length;
  w(
    `  ${gold('●')} ${bold(it.sessionId.padEnd(3))} ` +
      `${dim('·')} ${it.themes.length} themes  ` +
      `nov ${ink(it.novelty.toFixed(3))} ${bar(it.novelty)}  ` +
      `ver ${ink(it.verifier.score.toFixed(2))}${verErr ? red(` (${verErr} unsupported)`) : ''}\n`,
  );
  w(
    `      ${dim('halt:')} saturation ${streak >= config.kConsecutive ? gold(sat) : sat} · ` +
      `quality ${quality} · budget ${green('ok')} ${dim(`· spend $${spend.toFixed(2)}`)}\n`,
  );
}

/** The novelty-vs-threshold chart — the visual moment saturation is called. */
function renderChart(
  curve: number[],
  threshold: number,
  haltedAt: number,
): void {
  const w = process.stdout.write.bind(process.stdout);
  const H = 11;
  const max = Math.max(1, ...curve);
  const thRow = Math.round((threshold / max) * (H - 1));

  w(`\n  ${dim('novelty per session')}\n`);
  for (let row = H - 1; row >= 0; row--) {
    const yLabel =
      row === H - 1 ? '1.0' : row === 0 ? '0.0' : row === thRow ? threshold.toFixed(2) : '   ';
    let line = `  ${dim(yLabel.padStart(4))} `;
    line += dim(row === thRow ? '┤' : '│');
    for (let c = 0; c < curve.length; c++) {
      const r = Math.round((curve[c]! / max) * (H - 1));
      if (r === row) {
        line += c + 1 === haltedAt ? gold('◉ ') : gold('● ');
      } else if (row === thRow) {
        line += dim('┄ ');
      } else {
        line += '  ';
      }
    }
    if (row === thRow) line += dim(' threshold');
    w(line + '\n');
  }
  let axis = `  ${dim('    └')}`;
  for (let c = 0; c < curve.length; c++) axis += dim('──');
  w(axis + '\n');
  let xl = '       ';
  for (let c = 0; c < curve.length; c++) xl += dim(`s${c + 1} `.slice(0, 2));
  w(xl + '\n');
}

function renderVerdict(report: Report, verdict: Verdict): void {
  const w = process.stdout.write.bind(process.stdout);
  const color = verdict.kind === 'saturated' ? green : verdict.kind === 'not_saturated' ? gold : red;
  w('\n');
  w(`  ${color('┏━ VERDICT ' + '━'.repeat(40))}\n`);
  w(`  ${color('┃')} ${bold(color(verdict.headline + ' of ' + report.sessionsAvailable))}\n`);
  w(`  ${color('┃')} ${ink(verdict.action)}\n`);
  if (report.sessionsCancelled > 0) {
    w(
      `  ${color('┃')} ${dim(`${report.sessionsCancelled} sessions cancelled ×`)} ` +
        `$${report.costPerSessionUsd} ${dim('=')} ${gold(`≈ $${report.estimatedSavingsUsd.toLocaleString()} saved`)}\n`,
    );
  }
  w(
    `  ${color('┃')} ${dim(`verifier floor ${report.verifierFloorHeld ? 'held' : 'breached'} (min ${report.minVerifierScore})`)}\n`,
  );
  w(`  ${color('┗' + '━'.repeat(50))}\n\n`);

  w(`  ${dim('findings')} ${dim('(every claim cites a quote traceable to its session)')}\n\n`);
  for (const f of report.findings.slice(0, 4)) {
    w(`  ${gold(String(f.rank) + '.')} ${bold(f.title)} ${dim(`· ${f.participantCount} participants`)}\n`);
    const q = f.quotes[0];
    if (q) {
      w(`     ${ink('“' + q.text + '”')}\n`);
      w(`     ${dim('— ' + cite(q))}\n`);
    }
    w('\n');
  }

  if (report.pendingApprovals.length > 0) {
    w(`  ${dim('pending approval')} ${dim('(writes never auto-execute — held for a human)')}\n`);
    for (const a of report.pendingApprovals) {
      w(`  ${gold('⧖')} ${ink(a.action)} ${dim(`[${a.status}]`)}\n`);
      w(`     ${dim(a.rationale)}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`\n${red('Atlas run failed:')} ${err?.message ?? err}\n`);
  process.exit(1);
});
