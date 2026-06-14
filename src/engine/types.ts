/**
 * Atlas data model.
 *
 * These types mirror the entities the program is built around: a Run advances
 * one Iteration per interview session; each Iteration extracts Themes (each
 * grounded in citable Quotes), scores novelty, and is graded by a verifier.
 * A Run ends with exactly one Verdict and produces a Report. Any write the
 * agent wants to make against the research platform is a PendingApproval —
 * recorded, surfaced, and never auto-executed.
 */

// ─── Source data (as served by the MCP transcript provider) ─────────────────

export interface StudyRef {
  id: string;
  name: string;
  sessionCount: number;
}

export interface TranscriptLine {
  line: number;
  /** Timestamp, e.g. "00:18:22". */
  t: string;
  speaker: string;
  text: string;
}

/** A claimed supporting quote: what the extractor says was said, and where. */
export interface Quote {
  sessionId: string;
  line: number;
  t: string;
  text: string;
}

export interface Transcript {
  sessionId: string;
  studyId: string;
  participant: { id: string; role: string; segment: string };
  durationSec: number;
  lines: TranscriptLine[];
}

// ─── Themes ─────────────────────────────────────────────────────────────────

/** A theme as extracted from a single session. */
export interface Theme {
  /** Canonical concept key, used to merge the same theme across sessions. */
  key: string;
  label: string;
  summary: string;
  quotes: Quote[];
  /** Session this extraction came from. */
  sessionId: string;
}

/** A theme accumulated across the run, with every session that surfaced it. */
export interface AccumulatedTheme {
  key: string;
  label: string;
  summary: string;
  quotes: Quote[];
  /** Sessions in which this theme appeared. */
  sessions: string[];
  /** Session index at which this theme stopped producing materially new angles. */
  stabilizedAtIndex: number | null;
}

// ─── Per-iteration verifier result ──────────────────────────────────────────

export interface VerifierResult {
  /** Faithfulness of the extraction to the transcript, 0..1. */
  score: number;
  supportedQuotes: number;
  totalQuotes: number;
  /** Human-readable reasoning shown in the iteration inspector. */
  reasoning: string;
  unsupported: Quote[];
}

// ─── Iteration ──────────────────────────────────────────────────────────────

export type Phase =
  | 'fetching'
  | 'extracting'
  | 'comparing'
  | 'verifying'
  | 'complete';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  status: 'ok' | 'error';
}

export interface Iteration {
  index: number; // 1-based
  sessionId: string;
  phase: Phase;
  toolCalls: ToolCall[];
  themes: Theme[];
  /** Per-theme novelty match decisions (which existing theme each matched). */
  matches: ThemeMatch[];
  /** Session novelty score, 0..1. */
  novelty: number;
  verifier: VerifierResult;
  costUsd: number;
}

export interface ThemeMatch {
  themeKey: string;
  /** Closest accumulated theme by embedding similarity, or null if none yet. */
  matchedKey: string | null;
  similarity: number; // 0..1
  /** Contribution to novelty: 1 - similarity. */
  novelty: number;
  status: 'novel' | 'matched';
}

// ─── Verdicts ───────────────────────────────────────────────────────────────

export type VerdictKind =
  | 'saturated'
  | 'quality_halt'
  | 'budget_halt'
  | 'not_saturated';

export interface Verdict {
  kind: VerdictKind;
  /** One-line, human-facing explanation. */
  headline: string;
  /** The recommended next action for the research team. */
  action: string;
  /** Session index at which the run halted. */
  haltedAtIndex: number;
}

// ─── Run + Report ───────────────────────────────────────────────────────────

export interface RunConfig {
  studyId: string;
  noveltyThreshold: number;
  kConsecutive: number;
  qualityFloor: number;
  budgetCapUsd: number;
  costPerSessionUsd: number;
  /** If true, surface writes as approved; otherwise they stay pending. */
  approveWrites: boolean;
}

export type RunStatus =
  | 'configuring'
  | 'running'
  | 'paused'
  | 'halted';

export interface PendingApproval {
  id: string;
  /** The write the agent proposes against the research platform. */
  action: string;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface Finding {
  rank: number;
  title: string;
  detail: string;
  /** Number of participants (sessions) that raised this theme. */
  participantCount: number;
  /** Session index by which the theme stabilized. */
  stabilizedAtSession: number | null;
  quotes: Quote[];
}

export interface Report {
  runId: string;
  studyId: string;
  studyName: string;
  verdict: Verdict;
  sessionsAnalysed: number;
  sessionsAvailable: number;
  sessionsCancelled: number;
  costPerSessionUsd: number;
  estimatedSavingsUsd: number;
  verifierFloorHeld: boolean;
  /** Min verifier score observed across the run. */
  minVerifierScore: number;
  noveltyCurve: number[];
  findings: Finding[];
  pendingApprovals: PendingApproval[];
}

// ─── Streamed events (CLI renders these; a future dashboard consumes them) ──

export type RunEvent =
  | { type: 'run_started'; runId: string; config: RunConfig; study: StudyRef }
  | { type: 'tool_call'; iteration: number; call: ToolCall }
  | { type: 'phase'; iteration: number; sessionId: string; phase: Phase }
  | {
      type: 'iteration_complete';
      iteration: Iteration;
      thresholdStreak: number;
      runningCostUsd: number;
    }
  | { type: 'pending_approval'; approval: PendingApproval }
  | { type: 'verdict'; verdict: Verdict; report: Report };
