# The real Great Question MCP integration

The engine depends only on the `TranscriptProvider` interface
(`TranscriptProvider.ts`). The bundled mock (`McpTranscriptProvider.ts`) serves
fixtures over an in-memory transport; `GreatQuestionMcpProvider.ts` connects the
same client to Great Question's hosted MCP over OAuth. **Which one runs is a
single config switch — the loop above it is identical either way.**

## Switching

```bash
# Real server (interactive browser OAuth on first run; tokens cached in ~/.atlas)
ATLAS_MCP_URL=https://greatquestion.co/api/mcp/v1 npm run demo -- --study <real-study-id>

# One-shot proof: authorize, list studies, fetch one real transcript
npm run connect:gq                 # or: npm run connect:gq -- <study-id>

# Unset ATLAS_MCP_URL → the offline mock (default; the deterministic demo)
npm run demo
```

`defaultProvider()` in `runLoop.ts`: `ATLAS_MCP_URL` set → real, unset → mock.

## The real server (verified live)

- **Endpoint:** `https://greatquestion.co/api/mcp/v1` (Streamable HTTP).
- **Auth:** OAuth 2.1 + PKCE. The server returns RFC 9728 protected-resource
  metadata and supports **dynamic client registration** (RFC 7591) at
  `…/api/mcp/v1/oauth/register`, so there is no API key or client secret — the
  client registers itself and the user authorizes in the browser. Scopes:
  `mcp:tools mcp:resources mcp:prompts`; Atlas needs only reads.
- **Tools:** ~80 across the research workflow. Atlas calls three reads:
  `search_studies` → `list_repo_sessions` → `get_repo_session_transcript`
  (falls back to `get_transcript`). The provider introspects `tools/list` on
  connect and resolves the real tool names + parameter keys, so it adapts if the
  surface shifts.

## How it works (`GreatQuestionMcpProvider` + `oauth.ts`)

1. **Transport + auth.** `connectWithOAuth()` builds a
   `StreamableHTTPClientTransport` with a file-backed `OAuthClientProvider`. On
   the first 401 the SDK discovers metadata, registers the client, and opens the
   browser; a loopback server on `:8123` (`ATLAS_OAUTH_PORT`) catches the code,
   `transport.finishAuth(code)` exchanges it, and we reconnect. Tokens persist
   to `~/.atlas/oauth-<host>.json` (mode 0600), so later runs are silent.
2. **Tool resolution.** `tools/list` on connect; bind the three reads above.
3. **Response mapping.** Real payloads are richer than the mock's, so
   `toTranscript()` maps defensively into the `Transcript` type (line numbers,
   timestamps, speakers, participant) with fallbacks. `ATLAS_DEBUG=1` logs the
   live tool list and raw transcript keys to refine the mapping against real data.

## Writes stay gated

Atlas only *reads* through the provider. The one write it contemplates —
pausing recruiting on a saturated study — is recorded as a `PendingApproval` and
never executed. Against the real server that would be a separate, explicit call
to a write tool, made only after a human approves. Keep that gate when wiring writes.

## Still a demo seam: extraction

The data layer is real, but `DeterministicExtractor` reads gold themes from the
local fixtures (keyed by study/session id) and will throw on real ids. A full
saturation run over **real** transcripts needs the documented live extractor
(`ClaudeExtractor`, claude-opus-4-8) — a different model from the verifier. The
`DeterministicVerifier` is model-free and already works on real transcript text.
