/**
 * The Atlas loop. One pass per session: fetch → extract → score novelty →
 * verify → decide. Yields a stream of events (the CLI renders them; a future
 * dashboard can consume the same stream). Ends with exactly one verdict and a
 * grounded report.
 */

import type {
  RunConfig,
  RunEvent,
  Iteration,
  Theme,
  AccumulatedTheme,
  StudyRef,
  Phase,
} from './types.js';
import { decide, thresholdStreak } from './decide.js';
import { BudgetTracker, estimateIterationCostUsd } from './budget.js';
import { ApprovalGate } from './approval.js';
import {
  LocalLexicalEmbeddings,
  scoreNovelty,
  themeText,
  type EmbeddingProvider,
  type EmbeddingVector,
} from './novelty.js';
import { DeterministicExtractor, type Extractor } from './extract.js';
import { DeterministicVerifier, type Verifier } from './verify.js';
import { McpTranscriptProvider } from '../providers/McpTranscriptProvider.js';
import type { TranscriptProvider } from '../providers/TranscriptProvider.js';
import { buildReport, type ThemeAccumulation } from '../report/buildReport.js';

export interface EngineDeps {
  provider: TranscriptProvider;
  extractor: Extractor;
  verifier: Verifier;
  embedder: EmbeddingProvider;
}

function defaultDeps(): EngineDeps {
  return {
    provider: new McpTranscriptProvider(),
    extractor: new DeterministicExtractor(),
    verifier: new DeterministicVerifier(),
    embedder: new LocalLexicalEmbeddings(),
  };
}

let runCounter = 0;

export async function* runLoop(
  config: RunConfig,
  overrides: Partial<EngineDeps> = {},
): AsyncGenerator<RunEvent> {
  const deps = { ...defaultDeps(), ...overrides };
  const { provider, extractor, verifier, embedder } = deps;

  // Trust: the worker that extracts is never the one that grades.
  if (extractor.id === verifier.id) {
    throw new Error(
      `Worker and verifier must differ (got "${extractor.id}" for both) — the worker never grades its own work.`,
    );
  }

  const runId = `run-${++runCounter}-${config.studyId}`;
  const budget = new BudgetTracker(config.budgetCapUsd);
  const gate = new ApprovalGate(config.approveWrites);

  await provider.connect();
  try {
    // Resolve the study and its sessions.
    const search = await provider.searchStudies();
    const study: StudyRef | undefined = search.studies.find(
      (s) => s.id === config.studyId,
    );
    if (!study) {
      throw new Error(
        `Study "${config.studyId}" not found. Available: ${search.studies
          .map((s) => s.id)
          .join(', ')}`,
      );
    }
    yield { type: 'run_started', runId, config, study };
    yield { type: 'tool_call', iteration: 0, call: search.call };

    const sessionList = await provider.listRepoSessions(study.id);
    yield { type: 'tool_call', iteration: 0, call: sessionList.call };
    const sessions = sessionList.sessions;
    const sessionsAvailable = sessions.length;

    // Run state.
    const accumulatedVectors: { key: string; vector: EmbeddingVector }[] = [];
    const repo = new Map<string, ThemeAccumulation>();
    const iterations: Iteration[] = [];
    const noveltyHistory: number[] = [];

    for (let i = 1; i <= sessionsAvailable; i++) {
      const sessionId = sessions[i - 1]!;
      const toolCalls = [];

      // ── Phase 1: fetch ──────────────────────────────────────────────────
      yield phase(i, sessionId, 'fetching');
      const fetched = await provider.getTranscript(sessionId);
      toolCalls.push(fetched.call);
      yield { type: 'tool_call', iteration: i, call: fetched.call };
      const transcript = fetched.transcript;

      // ── Phase 2: extract ────────────────────────────────────────────────
      yield phase(i, sessionId, 'extracting');
      const themes: Theme[] = await extractor.extract(transcript);

      // ── Phase 3: compare (novelty) ──────────────────────────────────────
      yield phase(i, sessionId, 'comparing');
      const { novelty, matches } = scoreNovelty(
        themes,
        accumulatedVectors,
        embedder,
      );
      // Fold this session's themes into the accumulated set + theme repository.
      for (let t = 0; t < themes.length; t++) {
        const theme = themes[t]!;
        const match = matches[t]!;
        accumulatedVectors.push({
          key: theme.key,
          vector: embedder.embed(themeText(theme)),
        });
        mergeTheme(repo, theme, i, match.novelty);
      }

      // ── Phase 4: verify ─────────────────────────────────────────────────
      yield phase(i, sessionId, 'verifying');
      const verifierResult = await verifier.verify(transcript, themes);

      // ── Cost accounting ─────────────────────────────────────────────────
      const costUsd = estimateIterationCostUsd(transcript, themes);
      budget.add(costUsd);

      const iteration: Iteration = {
        index: i,
        sessionId,
        phase: 'complete',
        toolCalls,
        themes,
        matches,
        novelty,
        verifier: verifierResult,
        costUsd,
      };
      iterations.push(iteration);
      noveltyHistory.push(novelty);

      yield phase(i, sessionId, 'complete');
      yield {
        type: 'iteration_complete',
        iteration,
        thresholdStreak: thresholdStreak(noveltyHistory, config.noveltyThreshold),
        runningCostUsd: budget.spent,
      };

      // ── Phase 5: decide ─────────────────────────────────────────────────
      const verdict = decide({
        index: i,
        sessionsAvailable,
        noveltyHistory,
        verifierScore: verifierResult.score,
        budgetExceeded: budget.exceeded(),
        noveltyThreshold: config.noveltyThreshold,
        kConsecutive: config.kConsecutive,
        qualityFloor: config.qualityFloor,
      });

      if (verdict) {
        // A saturated run proposes a write — gated, never auto-executed.
        if (verdict.kind === 'saturated') {
          const cancelled = sessionsAvailable - i;
          const approval = gate.propose({
            action: `Pause recruiting on "${study.name}"`,
            tool: 'pause_recruiting',
            args: { study_id: study.id },
            rationale:
              `Saturation reached at session ${i} of ${sessionsAvailable}; ` +
              `${cancelled} remaining sessions can be cancelled, ` +
              `saving ≈ $${(cancelled * config.costPerSessionUsd).toLocaleString()}.`,
          });
          yield { type: 'pending_approval', approval };
        }

        const report = buildReport({
          runId,
          config,
          study,
          verdict,
          iterations,
          themes: [...repo.values()],
          approvals: gate.all(),
          sessionsAvailable,
        });
        yield { type: 'verdict', verdict, report };
        return;
      }
    }
  } finally {
    await provider.close();
  }
}

function phase(index: number, sessionId: string, p: Phase): RunEvent {
  return { type: 'phase', iteration: index, sessionId, phase: p };
}

function mergeTheme(
  repo: Map<string, ThemeAccumulation>,
  theme: Theme,
  index: number,
  noveltyContribution: number,
): void {
  const existing = repo.get(theme.key);
  if (existing) {
    existing.theme.quotes.push(...theme.quotes);
    if (!existing.theme.sessions.includes(theme.sessionId)) {
      existing.theme.sessions.push(theme.sessionId);
    }
    existing.occurrences.push({ index, contribution: noveltyContribution });
  } else {
    const acc: AccumulatedTheme = {
      key: theme.key,
      label: theme.label,
      summary: theme.summary,
      quotes: [...theme.quotes],
      sessions: [theme.sessionId],
      stabilizedAtIndex: null,
    };
    repo.set(theme.key, {
      theme: acc,
      occurrences: [{ index, contribution: noveltyContribution }],
    });
  }
}
