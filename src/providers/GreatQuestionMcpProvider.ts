/**
 * Great Question transcript provider — the REAL MCP integration.
 *
 * Connects an MCP client to Great Question's hosted server
 * (https://greatquestion.co/api/mcp/v1, Streamable HTTP + OAuth 2.1/PKCE) and
 * drives the three reads the saturation loop needs. It implements the exact
 * same `TranscriptProvider` interface as the bundled mock, so the loop above it
 * (novelty, verify, decide, budget, report) is byte-for-byte identical whether
 * Atlas is pointed at fixtures or at a live research repository.
 *
 * Great Question exposes ~80 tools; their precise names and parameter keys are
 * documented but not contractually frozen, so on connect we introspect the live
 * `tools/list` and resolve the read tools we need (preferring the
 * session-keyed transcript tool). Response payloads are richer than the mock's,
 * so each is mapped defensively into Atlas's `Transcript` / `StudyRef` types.
 *
 * Read-only: this provider never calls a write tool. Pausing recruiting on a
 * saturated study stays a `PendingApproval` held for a human (see runLoop).
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectWithOAuth } from './oauth.js';
import type { TranscriptProvider } from './TranscriptProvider.js';
import type {
  Transcript,
  TranscriptLine,
  StudyRef,
  ToolCall,
} from '../engine/types.js';

const log = (msg: string) => process.stderr.write(`${msg}\n`);
const debug = process.env.ATLAS_DEBUG === '1';

/** A resolved live tool: its real name and the input key it expects. */
interface ResolvedTool {
  name: string;
  /** The parameter key carrying the id, e.g. "study_id" or "session_id". */
  idKey: string;
}

interface ToolInfo {
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

export class GreatQuestionMcpProvider implements TranscriptProvider {
  readonly id: string;
  private client: Client | null = null;
  private studies!: ResolvedTool & { queryKey?: string };
  private sessions!: ResolvedTool;
  private transcript!: ResolvedTool;
  private loggedRawTranscript = false;

  constructor(private readonly serverUrl: string) {
    this.id = `mcp:greatquestion(${new URL(serverUrl).host})`;
  }

  async connect(): Promise<void> {
    this.client = await connectWithOAuth(this.serverUrl, {
      clientName: 'Atlas — research saturation loop',
    });
    await this.resolveTools();
  }

  /** Introspect the live tool surface and bind the three reads we need. */
  private async resolveTools(): Promise<void> {
    const { tools } = (await this.client!.listTools()) as { tools: ToolInfo[] };
    const byName = new Map(tools.map((t) => [t.name, t]));
    log(`  Connected to Great Question — ${tools.length} tools available.`);
    if (debug) log(`  tools: ${tools.map((t) => t.name).join(', ')}`);

    const studiesTool = firstPresent(byName, ['search_studies', 'list_studies']);
    const sessionsTool = firstPresent(byName, [
      'list_repo_sessions',
      'search_repo_sessions',
    ]);
    // Prefer the session-keyed transcript tool — it pairs with list_repo_sessions.
    const transcriptTool = firstPresent(byName, [
      'get_repo_session_transcript',
      'get_transcript',
      'get_repo_session',
    ]);

    if (!studiesTool || !sessionsTool || !transcriptTool) {
      throw new Error(
        'Great Question MCP is missing an expected read tool ' +
          `(studies=${studiesTool?.name}, sessions=${sessionsTool?.name}, ` +
          `transcript=${transcriptTool?.name}). Available: ${[...byName.keys()].join(', ')}`,
      );
    }

    this.studies = {
      name: studiesTool.name,
      idKey: 'id',
      queryKey: paramKey(studiesTool, ['query', 'q', 'search', 'term']),
    };
    this.sessions = {
      name: sessionsTool.name,
      idKey: paramKey(sessionsTool, ['study_id', 'studyId', 'study', 'id']) ?? 'study_id',
    };
    this.transcript = {
      name: transcriptTool.name,
      idKey:
        paramKey(transcriptTool, [
          'session_id',
          'sessionId',
          'repo_session_id',
          'id',
        ]) ?? 'session_id',
    };
    log(
      `  Using: ${this.studies.name} → ${this.sessions.name} → ${this.transcript.name}`,
    );
  }

  private async call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; call: ToolCall }> {
    if (!this.client) throw new Error('Provider not connected — call connect()');
    const started = performance.now();
    const res = await this.client.callTool({ name: tool, arguments: args });
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const isError = (res as { isError?: boolean }).isError === true;
    const call: ToolCall = { tool, args, durationMs, status: isError ? 'error' : 'ok' };
    if (isError) throw new Error(`MCP tool ${tool} failed: ${firstText(res)}`);
    return { data: dataOf(res), call };
  }

  async searchStudies(
    query?: string,
  ): Promise<{ studies: StudyRef[]; call: ToolCall }> {
    const args: Record<string, unknown> =
      query && this.studies.queryKey ? { [this.studies.queryKey]: query } : {};
    const { data, call } = await this.call(this.studies.name, args);
    const raw = asArray(data, ['studies', 'results', 'data', 'items']);
    const studies: StudyRef[] = raw.map((s) => ({
      id: String(pick(s, ['id', 'uuid', 'slug', 'study_id']) ?? ''),
      name: String(pick(s, ['name', 'title', 'label']) ?? '(untitled study)'),
      sessionCount: Number(
        pick(s, ['sessionCount', 'session_count', 'sessions_count', 'sessionsCount']) ?? 0,
      ),
    }));
    return { studies, call };
  }

  async listRepoSessions(
    studyId: string,
  ): Promise<{ sessions: string[]; call: ToolCall }> {
    const { data, call } = await this.call(this.sessions.name, {
      [this.sessions.idKey]: studyId,
    });
    const raw = asArray(data, ['sessions', 'results', 'data', 'items']);
    const sessions = raw
      .map((s) =>
        typeof s === 'string'
          ? s
          : String(pick(s, ['id', 'uuid', 'session_id', 'sessionId']) ?? ''),
      )
      .filter(Boolean);
    return { sessions, call };
  }

  async getTranscript(
    sessionId: string,
  ): Promise<{ transcript: Transcript; call: ToolCall }> {
    const { data, call } = await this.call(this.transcript.name, {
      [this.transcript.idKey]: sessionId,
    });
    if (debug && !this.loggedRawTranscript) {
      this.loggedRawTranscript = true;
      log(`  [debug] raw transcript keys: ${JSON.stringify(Object.keys(data))}`);
    }
    return { transcript: toTranscript(data, sessionId), call };
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}

// ─── Tool resolution helpers ─────────────────────────────────────────────────

function firstPresent(
  byName: Map<string, ToolInfo>,
  candidates: string[],
): ToolInfo | undefined {
  for (const name of candidates) {
    const t = byName.get(name);
    if (t) return t;
  }
  return undefined;
}

/** Pick the input parameter key a tool actually declares, preferring `wanted`. */
function paramKey(tool: ToolInfo, wanted: string[]): string | undefined {
  const props = tool.inputSchema?.properties ?? {};
  for (const w of wanted) if (w in props) return w;
  // Fall back to the tool's first required param, then its first param.
  return tool.inputSchema?.required?.[0] ?? Object.keys(props)[0];
}

// ─── Response mapping (real payloads are richer than the mock's) ─────────────

/** MCP results carry `structuredContent`; fall back to parsing a JSON text block. */
function dataOf(res: unknown): Record<string, unknown> {
  const structured = (res as { structuredContent?: Record<string, unknown> })
    .structuredContent;
  if (structured && typeof structured === 'object') return structured;
  const text = firstText(res);
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* not JSON — fall through */
    }
  }
  return {};
}

function firstText(res: unknown): string {
  const content = (res as { content?: { type: string; text?: string }[] }).content;
  return content?.find((c) => c.type === 'text')?.text ?? '';
}

function pick(
  obj: unknown,
  keys: string[],
): string | number | boolean | object | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && v !== '') {
      return v as string | number | boolean | object;
    }
  }
  return undefined;
}

/** Coerce a tool result into an array, unwrapping a likely container key. */
function asArray(data: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const container = pick(data, keys);
  if (Array.isArray(container)) return container as Record<string, unknown>[];
  return [];
}

/** Map a real transcript payload into Atlas's Transcript shape. */
function toTranscript(data: Record<string, unknown>, sessionId: string): Transcript {
  // Unwrap a `{ transcript: {...} }` / `{ session: {...} }` envelope if present.
  const t =
    (pick(data, ['transcript', 'session', 'repo_session', 'data']) as
      | Record<string, unknown>
      | undefined) ?? data;

  const rawLines = asArray(t, [
    'lines',
    'segments',
    'utterances',
    'entries',
    'messages',
    'turns',
    'transcript',
  ]);

  const lines: TranscriptLine[] = rawLines.map((raw, i) => {
    if (typeof raw === 'string') {
      return { line: i + 1, t: '', speaker: 'Speaker', text: raw };
    }
    const lineNo = Number(pick(raw, ['line', 'index', 'n', 'lineNumber']) ?? i + 1);
    return {
      line: Number.isFinite(lineNo) ? lineNo : i + 1,
      t: String(
        pick(raw, ['t', 'timestamp', 'time', 'start', 'startTime', 'start_time']) ?? '',
      ),
      speaker: String(
        pick(raw, ['speaker', 'role', 'participant', 'name', 'author', 'who']) ?? 'Speaker',
      ),
      text: String(pick(raw, ['text', 'content', 'value', 'body', 'transcript']) ?? ''),
    };
  });

  const participantRaw = pick(t, [
    'participant',
    'respondent',
    'candidate',
    'interviewee',
  ]) as Record<string, unknown> | undefined;

  return {
    sessionId: String(pick(t, ['sessionId', 'session_id', 'id']) ?? sessionId),
    studyId: String(pick(t, ['studyId', 'study_id', 'study']) ?? ''),
    participant: {
      id: String(pick(participantRaw, ['id', 'uuid', 'email']) ?? sessionId),
      role: String(pick(participantRaw, ['role', 'title', 'job_title']) ?? 'participant'),
      segment: String(pick(participantRaw, ['segment', 'group', 'cohort']) ?? 'unknown'),
    },
    durationSec: Number(
      pick(t, ['durationSec', 'duration_sec', 'duration', 'length_sec']) ?? 0,
    ),
    lines,
  };
}
