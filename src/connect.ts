#!/usr/bin/env node
/**
 * `atlas connect` — prove the real Great Question MCP integration end to end.
 *
 * Authorizes once in the browser (OAuth 2.1/PKCE; tokens cached under ~/.atlas),
 * introspects the live tool surface, lists your real studies, and — for one
 * study — lists its sessions and fetches a single real transcript. This is the
 * data-layer half of the loop running against live research data; it does not
 * extract themes or call any model.
 *
 *   npm run connect:gq                 # list studies (+ probe the first one)
 *   npm run connect:gq -- <study-id>   # probe a specific study
 *
 * Honors ATLAS_MCP_URL (defaults to Great Question's hosted endpoint).
 */

import { GreatQuestionMcpProvider } from './providers/GreatQuestionMcpProvider.js';

const ENDPOINT = process.env.ATLAS_MCP_URL ?? 'https://greatquestion.co/api/mcp/v1';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const w = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const gold = w('38;5;179');
const dim = w('2');
const bold = w('1');
const ink = w('38;5;223');
const out = (s: string) => process.stdout.write(s + '\n');

async function main(): Promise<void> {
  const studyArg = process.argv.slice(2).find((a) => !a.startsWith('-'));

  out('');
  out(`  ${gold('ATLAS')} ${dim('· connecting to the real Great Question MCP')}`);
  out(`  ${dim('endpoint')} ${ink(ENDPOINT)}`);

  const provider = new GreatQuestionMcpProvider(ENDPOINT);
  await provider.connect(); // interactive OAuth on first run; logs to stderr

  // 1) Studies ───────────────────────────────────────────────────────────────
  const { studies } = await provider.searchStudies();
  out('');
  out(`  ${bold('studies')} ${dim(`(${studies.length})`)}`);
  if (studies.length === 0) {
    out(`  ${dim('— no studies returned for this account.')}`);
    await provider.close();
    return;
  }
  for (const s of studies.slice(0, 25)) {
    out(`  ${gold('•')} ${bold(s.id)} ${dim('·')} ${ink(s.name)} ${dim(`(${s.sessionCount} sessions)`)}`);
  }

  // 2) Probe one study: sessions + one real transcript ─────────────────────────
  const target = studyArg
    ? studies.find((s) => s.id === studyArg)
    : studies.find((s) => s.sessionCount > 0) ?? studies[0];
  if (studyArg && !target) {
    out('');
    out(`  ${dim(`study "${studyArg}" not in the list above.`)}`);
    await provider.close();
    return;
  }
  if (!target) {
    await provider.close();
    return;
  }

  out('');
  out(`  ${bold('probing')} ${ink(target.name)} ${dim(`(${target.id})`)}`);
  const { sessions } = await provider.listRepoSessions(target.id);
  out(`  ${dim('sessions:')} ${sessions.length}`);
  if (sessions.length === 0) {
    out(`  ${dim('— no sessions; nothing to fetch.')}`);
    await provider.close();
    return;
  }

  const first = sessions[0]!;
  const { transcript } = await provider.getTranscript(first);
  out('');
  out(`  ${bold('transcript')} ${dim(first)}`);
  out(
    `  ${dim('participant')} ${ink(transcript.participant.role)} ` +
      `${dim('·')} ${transcript.lines.length} lines ` +
      `${dim('·')} ${Math.round(transcript.durationSec / 60)} min`,
  );
  for (const l of transcript.lines.slice(0, 4)) {
    const snippet = l.text.length > 90 ? l.text.slice(0, 89) + '…' : l.text;
    out(`     ${dim(l.t || `L${l.line}`)} ${ink(l.speaker)}: ${snippet}`);
  }

  out('');
  out(`  ${gold('✓')} real MCP data flowing: studies → sessions → transcript.`);
  out(
    `  ${dim('the full saturation loop additionally needs the live extractor seam')}`,
  );
  out(`  ${dim('(opus-4-8); the demo extractor is bound to local fixtures.')}`);
  out('');
  await provider.close();
}

main().catch((err) => {
  process.stderr.write(`\n  connect failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
