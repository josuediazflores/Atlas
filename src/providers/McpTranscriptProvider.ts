/**
 * MCP-client transcript provider.
 *
 * Connects to the bundled mock Great Question MCP server over the real MCP
 * protocol (in-memory transport — deterministic, no subprocess) and calls the
 * GQ read tools. Because it speaks plain MCP, pointing it at the real Great
 * Question server later means swapping the transport for a Streamable-HTTP one
 * with OAuth (see greatquestion.md) — the loop above it does not change.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGreatQuestionMockServer } from '../mcp/server.js';
import type { TranscriptProvider } from './TranscriptProvider.js';
import type { Transcript, StudyRef, ToolCall } from '../engine/types.js';

export class McpTranscriptProvider implements TranscriptProvider {
  readonly id = 'mcp:greatquestion-mock';
  private client: Client | null = null;

  async connect(): Promise<void> {
    const server = createGreatQuestionMockServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'atlas-engine', version: '0.1.0' });
    await client.connect(clientTransport);
    this.client = client;
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
    const call: ToolCall = {
      tool,
      args,
      durationMs,
      status: isError ? 'error' : 'ok',
    };
    if (isError) throw new Error(`MCP tool ${tool} failed: ${firstText(res)}`);
    const data = ((res as { structuredContent?: Record<string, unknown> })
      .structuredContent ?? {}) as Record<string, unknown>;
    return { data, call };
  }

  async searchStudies(
    query?: string,
  ): Promise<{ studies: StudyRef[]; call: ToolCall }> {
    const { data, call } = await this.call(
      'search_studies',
      query ? { query } : {},
    );
    const raw = (data.studies ?? []) as {
      id: string;
      name: string;
      sessionCount: number;
    }[];
    const studies = raw.map((s) => ({
      id: s.id,
      name: s.name,
      sessionCount: s.sessionCount,
    }));
    return { studies, call };
  }

  async listRepoSessions(
    studyId: string,
  ): Promise<{ sessions: string[]; call: ToolCall }> {
    const { data, call } = await this.call('list_repo_sessions', {
      study_id: studyId,
    });
    return { sessions: (data.sessions ?? []) as string[], call };
  }

  async getTranscript(
    sessionId: string,
  ): Promise<{ transcript: Transcript; call: ToolCall }> {
    const { data, call } = await this.call('get_transcript', {
      session_id: sessionId,
    });
    return { transcript: data.transcript as unknown as Transcript, call };
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}

function firstText(res: unknown): string {
  const content = (res as { content?: { type: string; text?: string }[] })
    .content;
  const block = content?.find((c) => c.type === 'text');
  return block?.text ?? 'unknown error';
}
