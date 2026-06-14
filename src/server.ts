#!/usr/bin/env node
/**
 * Atlas dashboard server.
 *
 * Serves the live-run dashboard (web/) and drives the loop, streaming the same
 * RunEvent stream the CLI renders to the browser over Server-Sent Events. The
 * deterministic demo run completes in milliseconds, so the server paces the
 * stream into a watchable cadence — the novelty curve draws point by point and
 * crosses the threshold live. The engine stays pure; pacing lives here.
 *
 *   npm run dashboard   →   http://localhost:4317
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLoop } from './engine/runLoop.js';
import type { RunConfig, RunEvent } from './engine/types.js';
import { listStudies, loadSession } from './fixtures.js';

const PORT = Number(process.env.ATLAS_PORT ?? 4317);
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pace(type: RunEvent['type'], base: number): number {
  switch (type) {
    case 'phase':
      return base * 0.35;
    case 'tool_call':
      return base * 0.3;
    case 'iteration_complete':
      return base;
    case 'verdict':
      return base * 0.6;
    default:
      return 40;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname === '/api/studies') return sendStudies(res);
    if (url.pathname === '/api/transcript') return sendTranscript(res, url);
    if (url.pathname === '/api/run') return runStream(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (err) {
    res.writeHead(500).end(String((err as Error)?.message ?? err));
  }
});

function sendStudies(res: ServerResponse): void {
  const studies = listStudies().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    sessionCount: s.sessions.length,
  }));
  json(res, { studies });
}

function sendTranscript(res: ServerResponse, url: URL): void {
  const study = url.searchParams.get('study') ?? '';
  const session = url.searchParams.get('session') ?? '';
  try {
    const raw = loadSession(study, session);
    json(res, {
      sessionId: raw.id,
      participant: raw.participant,
      durationSec: raw.durationSec,
      lines: raw.transcript,
    });
  } catch (e) {
    res.writeHead(404).end(String((e as Error)?.message ?? e));
  }
}

async function runStream(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const n = (k: string, d: number) => {
    const v = url.searchParams.get(k);
    const x = v == null ? NaN : Number(v);
    return Number.isFinite(x) ? x : d;
  };
  const config: RunConfig = {
    studyId: url.searchParams.get('study') ?? 'pricing-study',
    noveltyThreshold: n('threshold', 0.15),
    kConsecutive: n('k', 3),
    qualityFloor: n('qualityFloor', 0.6),
    budgetCapUsd: n('budget', 100000),
    costPerSessionUsd: n('costPerSession', 300),
    approveWrites: url.searchParams.get('approve') === '1',
  };
  const base = n('pace', 480);

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    for await (const ev of runLoop(config)) {
      if (closed) break;
      send(ev.type, ev);
      await delay(pace(ev.type, base));
    }
    if (!closed) send('done', {});
  } catch (e) {
    if (!closed) send('error', { message: String((e as Error)?.message ?? e) });
  }
  res.end();
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // Contain to WEB_DIR — reject path traversal.
  const file = normalize(join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

function json(res: ServerResponse, obj: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

server.listen(PORT, () => {
  process.stdout.write(
    `\n  Atlas dashboard → \x1b[38;5;179mhttp://localhost:${PORT}\x1b[0m\n` +
      `  (Ctrl-C to stop)\n\n`,
  );
});
