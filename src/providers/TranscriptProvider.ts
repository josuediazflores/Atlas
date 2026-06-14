/**
 * Transcript provider — the loop's only view of the research platform.
 *
 * The engine never knows whether transcripts come from the bundled mock MCP
 * server or from Great Question's real MCP. Each call also returns ToolCall
 * metadata so the loop can stream the MCP tool-call log.
 */

import type { Transcript, StudyRef, ToolCall } from '../engine/types.js';

export interface TranscriptProvider {
  readonly id: string;
  connect(): Promise<void>;
  searchStudies(query?: string): Promise<{ studies: StudyRef[]; call: ToolCall }>;
  listRepoSessions(studyId: string): Promise<{ sessions: string[]; call: ToolCall }>;
  getTranscript(sessionId: string): Promise<{ transcript: Transcript; call: ToolCall }>;
  close(): Promise<void>;
}

export type { Transcript, StudyRef, ToolCall };
