/**
 * Smoke test the standalone mock MCP server over real stdio transport — the
 * path an external MCP client (Claude Desktop, the real engine pointed at a
 * subprocess) would use. Spawns `tsx src/mcp/server.ts`, lists tools, and calls
 * each GQ read tool.  Run:  npx tsx scripts/smokeMcp.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.ts');

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', serverPath],
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

const studies = await client.callTool({ name: 'search_studies', arguments: {} });
console.log('search_studies →', JSON.stringify((studies as any).structuredContent.studies.map((s: any) => `${s.id}(${s.sessionCount})`)));

const sessions = await client.callTool({ name: 'list_repo_sessions', arguments: { study_id: 'pricing-study' } });
console.log('list_repo_sessions →', (sessions as any).structuredContent.sessions.join(' '));

const tx = await client.callTool({ name: 'get_transcript', arguments: { session_id: 's4' } });
const t = (tx as any).structuredContent.transcript;
console.log(`get_transcript s4 → ${t.lines.length} lines, participant ${t.participant.id} (${t.participant.role}); themes field present:`, 'themes' in t);

await client.close();
console.log('stdio MCP smoke test OK');
