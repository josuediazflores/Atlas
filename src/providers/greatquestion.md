# Swapping in the real Great Question MCP

The engine depends only on the `TranscriptProvider` interface
(`TranscriptProvider.ts`). Today the default implementation
(`McpTranscriptProvider.ts`) connects an MCP client to the bundled mock server
over an in-memory transport. Pointing at Great Question's real server is a
change to **how the client connects** — the loop above it does not change.

## The real server

- **Endpoint:** `https://greatquestion.co/api/mcp/v1` (Streamable HTTP transport)
- **Auth:** OAuth 2.1 with PKCE — browser-based, no API keys to manage
- **Access:** gated. Requires an active Great Question account with MCP access
  enabled (enterprise early-access by request). The advertised
  `npx @greatquestion/mcp-server` package does **not** exist — do not wire it up.
- **Surface:** ~80 tools across the research workflow, read and write. Atlas's
  loop needs only three reads: `search_studies`, `list_repo_sessions`,
  `get_transcript`. The mock exposes exactly these (plus `get_study`).

## What changes

1. **Transport.** Replace the in-memory pair in `McpTranscriptProvider.connect()`
   with the SDK's Streamable-HTTP client transport pointed at the endpoint:

   ```ts
   import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
   const transport = new StreamableHTTPClientTransport(
     new URL('https://greatquestion.co/api/mcp/v1'),
     { authProvider /* OAuth 2.1 / PKCE */ },
   );
   await client.connect(transport);
   ```

   (Confirm the exact transport export and OAuth provider hook against the
   installed `@modelcontextprotocol/sdk` version before wiring.)

2. **Auth.** Implement the OAuth 2.1/PKCE flow with the SDK's auth provider
   helper. Tokens are obtained interactively in the browser; the engine never
   handles a static key.

3. **Response shape.** The mock returns `structuredContent` shaped as
   `{ transcript: { sessionId, studyId, participant, durationSec, lines } }`. Map
   the real `get_transcript` response into the `Transcript` type in
   `getTranscript()`. The real payload is richer; take the fields the loop uses.

4. **Nothing else.** `runLoop.ts`, novelty, verify, decide, budget, approval,
   and the report are all provider-agnostic.

## Writes stay gated

Atlas's loop only *reads* through the provider. The one write it contemplates —
pausing recruiting on a saturated study — is recorded as a `PendingApproval` and
never executed here. Against the real server that would be a separate, explicit
call to a Great Question write tool (e.g. a study-update tool), made only after a
human approves the pending action. Keep that human gate when you wire writes.

## Suggested shape

Add a `GreatQuestionMcpProvider implements TranscriptProvider` alongside the mock
provider and select it via config (e.g. `ATLAS_MCP_URL` set → real provider,
unset → mock). The interface guarantees the loop is identical either way.
