/**
 * Builds the findings report a finished run hands back: one verdict, a savings
 * estimate, and findings where every claim cites quotes traceable to their
 * source sessions. Nothing renders as an unattributed claim.
 */

import type {
  AccumulatedTheme,
  Finding,
  Quote,
  Report,
  RunConfig,
  StudyRef,
  Verdict,
  Iteration,
  PendingApproval,
} from '../engine/types.js';

export interface ThemeAccumulation {
  theme: AccumulatedTheme;
  occurrences: { index: number; contribution: number }[];
}

export interface BuildReportInput {
  runId: string;
  config: RunConfig;
  study: StudyRef;
  verdict: Verdict;
  iterations: Iteration[];
  themes: ThemeAccumulation[];
  approvals: PendingApproval[];
  sessionsAvailable: number;
}

/** A theme is "stabilized" after its last materially-new occurrence. */
const NEW_ANGLE = 0.3;
const MAX_FINDINGS = 5;
const QUOTES_PER_FINDING = 3;

export function buildReport(input: BuildReportInput): Report {
  const { config, study, verdict, iterations } = input;
  const sessionsAnalysed = iterations.length;
  const sessionsCancelled =
    verdict.kind === 'saturated'
      ? input.sessionsAvailable - sessionsAnalysed
      : 0;
  const estimatedSavingsUsd = sessionsCancelled * config.costPerSessionUsd;

  const verifierScores = iterations.map((it) => it.verifier.score);
  const minVerifierScore =
    verifierScores.length === 0 ? 1 : Math.min(...verifierScores);

  const findings = rankFindings(input.themes, sessionsAnalysed);

  return {
    runId: input.runId,
    studyId: study.id,
    studyName: study.name,
    verdict,
    sessionsAnalysed,
    sessionsAvailable: input.sessionsAvailable,
    sessionsCancelled,
    costPerSessionUsd: config.costPerSessionUsd,
    estimatedSavingsUsd,
    verifierFloorHeld: minVerifierScore >= config.qualityFloor,
    minVerifierScore: Math.round(minVerifierScore * 1000) / 1000,
    noveltyCurve: iterations.map((it) => it.novelty),
    findings,
    pendingApprovals: input.approvals,
  };
}

function rankFindings(
  themes: ThemeAccumulation[],
  sessionsAnalysed: number,
): Finding[] {
  const scored = themes.map((acc) => {
    const occ = [...acc.occurrences].sort((a, b) => a.index - b.index);
    let stabilizedAtIndex = occ[0]?.index ?? null;
    for (const o of occ) {
      if (o.contribution >= NEW_ANGLE) stabilizedAtIndex = o.index;
    }
    acc.theme.stabilizedAtIndex = stabilizedAtIndex;
    return { acc, stabilizedAtIndex };
  });

  // Rank by reach (distinct sessions), then by support (quotes).
  scored.sort(
    (a, b) =>
      b.acc.theme.sessions.length - a.acc.theme.sessions.length ||
      b.acc.theme.quotes.length - a.acc.theme.quotes.length,
  );

  return scored.slice(0, MAX_FINDINGS).map((s, i) => {
    const t = s.acc.theme;
    return {
      rank: i + 1,
      title: t.label,
      detail: `${describeReach(t.sessions.length, sessionsAnalysed)} ${t.summary}`,
      participantCount: t.sessions.length,
      stabilizedAtSession: s.stabilizedAtIndex,
      quotes: pickQuotes(t.quotes),
    };
  });
}

function describeReach(reach: number, analysed: number): string {
  return `Raised by ${reach} of ${analysed} participants —`;
}

/** Up to N quotes, in session order, deduped by both location and wording. */
function pickQuotes(quotes: Quote[]): Quote[] {
  const seenLoc = new Set<string>();
  const seenText = new Set<string>();
  const unique: Quote[] = [];
  for (const q of [...quotes].sort(
    (a, b) => a.sessionId.localeCompare(b.sessionId, undefined, { numeric: true }) || a.line - b.line,
  )) {
    const loc = `${q.sessionId}:${q.line}`;
    const text = q.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenLoc.has(loc) || seenText.has(text)) continue;
    seenLoc.add(loc);
    seenText.add(text);
    unique.push(q);
    if (unique.length >= QUOTES_PER_FINDING) break;
  }
  return unique;
}
