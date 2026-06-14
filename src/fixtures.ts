/**
 * Fixture loader (shared by the mock MCP server and the demo extractor).
 *
 * Each session fixture holds BOTH the transcript (what the research platform's
 * MCP serves) and gold theme annotations (what an LLM would extract). The two
 * are consumed through different views:
 *   - the mock MCP `get_transcript` returns only the transcript lines, matching
 *     Great Question's real surface;
 *   - the demo Extractor reads the `themes` annotations as its deterministic
 *     stand-in for an LLM extraction, pulling quote text from the transcript.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export interface RawTheme {
  key: string;
  label: string;
  summary: string;
  /** Quote references into the transcript; `claim` overrides the line text. */
  quotes: { line: number; claim?: string }[];
}

export interface RawSession {
  id: string;
  studyId: string;
  participant: { id: string; role: string; segment: string };
  durationSec: number;
  transcript: { line: number; t: string; speaker: string; text: string }[];
  themes: RawTheme[];
}

export interface RawStudy {
  id: string;
  name: string;
  description: string;
  /** Ordered session ids. */
  sessions: string[];
}

/** Resolve the fixtures directory: env override, else nearest ancestor `fixtures/`. */
export function fixturesRoot(): string {
  const env = process.env.ATLAS_FIXTURES_DIR;
  if (env && existsSync(env)) return env;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'fixtures');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate the fixtures/ directory. Set ATLAS_FIXTURES_DIR.',
  );
}

function studyDir(studyId: string): string {
  return join(fixturesRoot(), 'studies', studyId);
}

export function listStudies(): RawStudy[] {
  const root = join(fixturesRoot(), 'studies');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadStudy(e.name))
    .filter((s): s is RawStudy => s !== null);
}

export function loadStudy(studyId: string): RawStudy | null {
  const file = join(studyDir(studyId), 'study.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as RawStudy;
}

export function loadSession(studyId: string, sessionId: string): RawSession {
  const file = resolve(studyDir(studyId), 'sessions', `${sessionId}.json`);
  if (!existsSync(file)) {
    throw new Error(`Unknown session "${sessionId}" in study "${studyId}"`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as RawSession;
}
