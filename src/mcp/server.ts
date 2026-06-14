/**
 * Mock Great Question MCP server.
 *
 * This is the workaround for not yet having access to Great Question's real MCP
 * (https://greatquestion.co/api/mcp/v1, OAuth 2.1/PKCE, gated early-access).
 * It speaks the real Model Context Protocol and exposes Great Question's real
 * READ tool surface, backed by local fixtures:
 *
 *   search_studies      → studies the agent can synthesize
 *   list_repo_sessions  → ordered session ids for a study
 *   get_transcript      → one session's transcript (lines only — no theme labels)
 *   get_study           → study metadata (read-only stub, for realism)
 *
 * The loop talks to this over the MCP protocol exactly as it would talk to the
 * real server, so swapping in Great Question later is a transport/URL/auth
 * change, not a rewrite (see src/providers/greatquestion.md).
 *
 * Run standalone (any MCP client can connect over stdio):  npm run mcp
 * Or embed in-process via createGreatQuestionMockServer() + InMemoryTransport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  listStudies,
  loadStudy,
  loadSession,
  type RawStudy,
} from '../fixtures.js';

function studyOf(sessionId: string): RawStudy | null {
  for (const study of listStudies()) {
    if (study.sessions.includes(sessionId)) return study;
  }
  return null;
}

export function createGreatQuestionMockServer(): McpServer {
  const server = new McpServer({
    name: 'greatquestion-mock',
    version: '0.1.0',
  });

  server.registerTool(
    'search_studies',
    {
      title: 'Search studies',
      description:
        'Search research studies in the repository. Returns id, name and session count.',
      inputSchema: { query: z.string().optional() },
    },
    async ({ query }) => {
      const q = (query ?? '').toLowerCase();
      const studies = listStudies()
        .filter(
          (s) =>
            !q ||
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q),
        )
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          sessionCount: s.sessions.length,
        }));
      return jsonResult({ studies });
    },
  );

  server.registerTool(
    'list_repo_sessions',
    {
      title: 'List repository sessions',
      description: 'List the interview sessions for a study, in order.',
      inputSchema: { study_id: z.string() },
    },
    async ({ study_id }) => {
      const study = loadStudy(study_id);
      if (!study) return errorResult(`Unknown study "${study_id}"`);
      return jsonResult({ studyId: study.id, sessions: study.sessions });
    },
  );

  server.registerTool(
    'get_transcript',
    {
      title: 'Get transcript',
      description:
        'Fetch the full transcript for an interview session (speaker-attributed, line-referenced, timestamped).',
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      const study = studyOf(session_id);
      if (!study) return errorResult(`Unknown session "${session_id}"`);
      const raw = loadSession(study.id, session_id);
      // Return transcript lines only — never the gold theme annotations.
      const transcript = {
        sessionId: raw.id,
        studyId: raw.studyId,
        participant: raw.participant,
        durationSec: raw.durationSec,
        lines: raw.transcript,
      };
      return jsonResult({ transcript });
    },
  );

  server.registerTool(
    'get_study',
    {
      title: 'Get study',
      description: 'Fetch metadata for a single study.',
      inputSchema: { study_id: z.string() },
    },
    async ({ study_id }) => {
      const study = loadStudy(study_id);
      if (!study) return errorResult(`Unknown study "${study_id}"`);
      return jsonResult({
        study: {
          id: study.id,
          name: study.name,
          description: study.description,
          sessionCount: study.sessions.length,
        },
      });
    },
  );

  return server;
}

function jsonResult(obj: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
    structuredContent: obj as Record<string, unknown>,
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

// Run as a standalone stdio MCP server when invoked directly.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const server = createGreatQuestionMockServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout carries the MCP protocol.
  process.stderr.write('[greatquestion-mock] MCP server ready on stdio\n');
}
