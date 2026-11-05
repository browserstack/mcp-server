#!/usr/bin/env node
/**
 * Standalone remote MCP with per-user login (Streamable HTTP).
 *
 * The stdio entrypoint (index.ts) serves one user from environment
 * credentials. This one serves many: every MCP session logs in with its OWN
 * BrowserStack credentials (`Authorization: Basic base64(username:access_key)`),
 * which are verified against BrowserStack before a server instance is built
 * for that user alone. Later requests on the session must present the same
 * credentials, so a leaked session id is not enough to use someone's session.
 *
 * Nothing is stored beyond the live session, and credentials are never logged.
 * Swapping Basic for BrowserStack OAuth bearer tokens is the follow-up the
 * planned follow-up; the per-session wiring here stays the same.
 */
import "./http-bootstrap.js";
import "dotenv/config";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { BrowserStackMcpServer } from "./server-factory.js";
import { apiClient } from "./lib/apiClient.js";
import logger from "./logger.js";

const HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
const PORT = Number(process.env.MCP_HTTP_PORT || 8931);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_IDLE_MS = 60 * 60 * 1000;

interface Session {
  transport: StreamableHTTPServerTransport;
  credentialHash: string;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

export interface Credentials {
  username: string;
  accessKey: string;
}

export function parseBasicAuth(
  header: string | undefined,
): Credentials | undefined {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
  if (!m) return undefined;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep <= 0 || sep === decoded.length - 1) return undefined;
  return { username: decoded.slice(0, sep), accessKey: decoded.slice(sep + 1) };
}

export const credentialHash = (c: Credentials) =>
  createHash("sha256").update(`${c.username}\0${c.accessKey}`).digest("hex");

/**
 * True only on a definitive 2xx. 401/403 is a rejected login; anything else
 * (429, 5xx, a proxy page) throws, so the caller answers 502 and never opens
 * a session on an unverified credential.
 */
export async function verifyCredentials(c: Credentials): Promise<boolean> {
  const res = await apiClient.get({
    url: "https://api-cloud.browserstack.com/app-automate/plan.json",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${c.username}:${c.accessKey}`).toString("base64"),
    },
    timeout: 15_000,
    raise_error: false,
  });
  if (res.status === 401 || res.status === 403) return false;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`BrowserStack verification returned HTTP ${res.status}`);
  }
  return true;
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const unauthorized = (res: http.ServerResponse, message: string) =>
  send(
    res,
    401,
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { "WWW-Authenticate": 'Basic realm="BrowserStack MCP"' },
  );

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

export async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz")
    return send(res, 200, { ok: true, sessions: sessions.size });
  if (url.pathname !== "/mcp") return send(res, 404, { error: "not found" });

  const creds = parseBasicAuth(req.headers.authorization);
  if (!creds) {
    return unauthorized(
      res,
      "Log in with your BrowserStack credentials: Authorization: Basic base64(username:access_key).",
    );
  }
  const hash = credentialHash(creds);
  const sessionId = req.headers["mcp-session-id"];

  let body: unknown;
  if (req.method === "POST") {
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Invalid JSON body" },
        id: null,
      });
    }
  }

  if (typeof sessionId === "string" && sessionId) {
    const s = sessions.get(sessionId);
    if (!s)
      return send(res, 404, {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unknown or expired session" },
        id: null,
      });
    if (s.credentialHash !== hash)
      return unauthorized(res, "These credentials do not own this session.");
    s.lastSeen = Date.now();
    return s.transport.handleRequest(req, res, body);
  }

  if (req.method !== "POST" || !isInitializeRequest(body)) {
    return send(res, 400, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Start with an initialize request (no session id).",
      },
      id: null,
    });
  }

  let ok = false;
  try {
    ok = await verifyCredentials(creds);
  } catch (error) {
    logger.error(
      "credential check failed: %s",
      error instanceof Error ? error.message : String(error),
    );
    return send(res, 502, {
      jsonrpc: "2.0",
      error: {
        code: -32002,
        message: "Could not reach BrowserStack to verify the login.",
      },
      id: null,
    });
  }
  if (!ok) return unauthorized(res, "BrowserStack rejected these credentials.");

  // One server instance per logged-in user session: tools run with that user's credentials only.
  const server = new BrowserStackMcpServer({
    "browserstack-username": creds.username,
    "browserstack-access-key": creds.accessKey,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, {
        transport,
        credentialHash: hash,
        lastSeen: Date.now(),
      });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  await server.getInstance().connect(transport);
  return transport.handleRequest(req, res, body);
}

export function startHttpServer(port = PORT, host = HOST) {
  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      logger.error(
        "request failed: %s",
        error instanceof Error ? error.message : String(error),
      );
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  });
  const sweep = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, s] of sessions) {
      if (s.lastSeen < cutoff) {
        sessions.delete(id);
        s.transport.close().catch(() => undefined);
      }
    }
  }, 60_000);
  sweep.unref();
  httpServer.listen(port, host, () => {
    process.stderr.write(
      `BrowserStack MCP (HTTP, per-user login) on http://${host}:${port}/mcp\n`,
    );
  });
  return httpServer;
}

const isMain = process.argv[1] && /http-server\.(js|ts)$/.test(process.argv[1]);
if (isMain) startHttpServer();
