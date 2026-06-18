/**
 * File-persisted OAuth 2.1 / PKCE client for connecting Atlas to a real MCP
 * server (Great Question).
 *
 * Implements the SDK's `OAuthClientProvider` with credentials persisted under
 * ~/.atlas, so that after ONE interactive browser authorization, subsequent
 * runs reconnect non-interactively via the stored refresh token. The client is
 * registered dynamically (RFC 7591) — there is no API key or client secret to
 * manage, exactly as Great Question's docs describe.
 *
 * The interactive half — opening the browser and catching the redirect on a
 * loopback HTTP server — follows the SDK's canonical `simpleOAuthClient`
 * example, adapted for durable, file-backed credential storage.
 *
 * All progress is logged to STDERR so a caller's STDOUT stays clean for data.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const log = (msg: string) => process.stderr.write(`${msg}\n`);

/** Persisted OAuth state for a single MCP server. */
interface StoredState {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

function credPath(serverUrl: string): string {
  const host = new URL(serverUrl).host.replace(/[^a-z0-9.-]/gi, '_');
  const dir = process.env.ATLAS_CRED_DIR ?? join(homedir(), '.atlas');
  return join(dir, `oauth-${host}.json`);
}

/**
 * OAuthClientProvider backed by a JSON file under ~/.atlas. Tokens, the
 * dynamically-registered client, and the in-flight PKCE verifier all survive
 * across process runs.
 */
export class FileOAuthClientProvider implements OAuthClientProvider {
  private store: StoredState;
  private readonly file: string;

  constructor(
    private readonly serverUrl: string,
    private readonly _redirectUrl: string,
    private readonly _clientMetadata: OAuthClientMetadata,
  ) {
    this.file = credPath(serverUrl);
    this.store = this.load();
  }

  private load(): StoredState {
    if (process.env.ATLAS_OAUTH_RESET === '1') return {};
    try {
      if (existsSync(this.file)) {
        return JSON.parse(readFileSync(this.file, 'utf8')) as StoredState;
      }
    } catch {
      /* corrupt or unreadable — start clean */
    }
    return {};
  }

  private persist(): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    // Tokens are sensitive — keep the file owner-only.
    writeFileSync(this.file, JSON.stringify(this.store, null, 2), { mode: 0o600 });
  }

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this.store.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    this.store.clientInformation = info;
    this.persist();
  }

  tokens(): OAuthTokens | undefined {
    return this.store.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.tokens = tokens;
    this.persist();
  }

  saveCodeVerifier(verifier: string): void {
    this.store.codeVerifier = verifier;
    this.persist();
  }

  codeVerifier(): string {
    if (!this.store.codeVerifier) throw new Error('No PKCE code verifier saved');
    return this.store.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    const url = authorizationUrl.toString();
    log('');
    log('  ┏━ Great Question authorization required');
    log('  ┃ Opening your browser to sign in and authorize Atlas (read-only).');
    log('  ┃ If it does not open, paste this URL:');
    log(`  ┃   ${url}`);
    log('  ┗━ Waiting for you to approve…');
    log('');
    openBrowser(url);
  }

  /** Let the SDK clear bad credentials instead of forcing manual cleanup. */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): void {
    if (scope === 'all') this.store = {};
    if (scope === 'client') delete this.store.clientInformation;
    if (scope === 'tokens') delete this.store.tokens;
    if (scope === 'verifier') delete this.store.codeVerifier;
    this.persist();
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {
      /* headless / no browser — the URL was printed above */
    });
    child.unref();
  } catch {
    /* ignore — the URL was printed above */
  }
}

/** Run a one-shot loopback HTTP server and resolve with the OAuth `code`. */
function waitForCallback(port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url || req.url === '/favicon.ico') {
        res.writeHead(404).end();
        return;
      }
      const parsed = new URL(req.url, 'http://localhost');
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      res.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><meta charset=utf-8><title>Atlas</title>` +
          `<body style="font:16px -apple-system,sans-serif;background:#161310;color:#e9dcc3;padding:3rem">` +
          (code
            ? `<h1 style="color:#c9a227">Authorized ✓</h1><p>Atlas is connected to Great Question. You can close this tab and return to the terminal.</p>`
            : `<h1 style="color:#c98b8b">Authorization failed</h1><p>${error ?? 'No code returned.'}</p>`) +
          `<script>setTimeout(()=>window.close(),2500)</script></body>`,
      );
      if (code) {
        clearTimeout(timer);
        setTimeout(() => server.close(), 1500);
        resolve(code);
      } else if (error) {
        clearTimeout(timer);
        server.close();
        reject(new Error(`OAuth authorization failed: ${error}`));
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for browser authorization`));
    }, timeoutMs);
    server.on('error', (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not start OAuth callback server on port ${port}: ${(e as Error).message}. ` +
            `Set ATLAS_OAUTH_PORT to a free port.`,
        ),
      );
    });
    server.listen(port, () => log(`  (listening for the OAuth redirect on http://localhost:${port})`));
  });
}

export interface ConnectOptions {
  clientName?: string;
  /** Loopback port for the OAuth redirect (must be free + stable across runs). */
  callbackPort?: number;
  /** How long to wait for the user to finish the browser authorization. */
  authTimeoutMs?: number;
}

/**
 * Connect an MCP `Client` to a real server over Streamable HTTP with OAuth 2.1.
 *
 * On the first run this opens the browser for interactive authorization; once
 * tokens are stored under ~/.atlas, later runs reconnect silently. Returns the
 * connected client (caller owns `client.close()`).
 */
export async function connectWithOAuth(
  serverUrl: string,
  opts: ConnectOptions = {},
): Promise<Client> {
  const callbackPort = opts.callbackPort ?? Number(process.env.ATLAS_OAUTH_PORT ?? 8123);
  const callbackUrl = `http://localhost:${callbackPort}/callback`;
  const authTimeoutMs =
    opts.authTimeoutMs ?? Number(process.env.ATLAS_OAUTH_TIMEOUT_MS ?? 10 * 60 * 1000);

  const provider = new FileOAuthClientProvider(serverUrl, callbackUrl, {
    client_name: opts.clientName ?? 'Atlas — research saturation loop',
    redirect_uris: [callbackUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    // Atlas only calls tools (read-only) — request least privilege. The server
    // advertises mcp:tools mcp:resources mcp:prompts; we ask for tools alone.
    scope: process.env.ATLAS_MCP_SCOPE ?? 'mcp:tools',
    // Public client + PKCE: no secret to store. The server may override this
    // at registration; the SDK adapts to whatever it returns.
    token_endpoint_auth_method: 'none',
  });

  const client = new Client({ name: 'atlas-engine', version: '0.1.0' });
  const url = new URL(serverUrl);

  // Mirror the SDK's reference flow: try to connect; on the first 401 the
  // provider has already opened the browser, so catch the code on loopback,
  // finish the token exchange, then reconnect with a fresh transport.
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
    try {
      await client.connect(transport);
      return client;
    } catch (err) {
      if (err instanceof UnauthorizedError && attempt < MAX_ATTEMPTS) {
        const code = await waitForCallback(callbackPort, authTimeoutMs);
        await transport.finishAuth(code);
        log('  Authorization complete — reconnecting…');
        continue; // fresh transport on the next loop, now holding tokens
      }
      throw err;
    }
  }
  throw new UnauthorizedError('Authorization did not complete');
}
