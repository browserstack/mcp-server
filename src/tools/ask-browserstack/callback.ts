/**
 * The loopback listener Atlas calls back on (CONTRACT §1-2).
 *
 * Transport is A2: Atlas makes the OUTBOUND request and blocks on its response, which is
 * what dissolves the affinity problem that dominates PLAN.md — the decision returns on the
 * same connection to the same pod, so there is no Redis nudge and no single-replica limit.
 *
 * THE THREAT MODEL IS LOCAL. This binds a port on the developer's own machine, so every
 * other process on that machine can reach it. A stray one must never be able to make a
 * confirmation prompt appear, because a human trained to approve prompts is the exploit.
 * Hence: a fresh 256-bit bearer per run, compared in constant time, checked BEFORE the body
 * is even parsed, and 401 with no elicitation attempted on any mismatch.
 *
 * Everything ambiguous is a deny. A body we cannot parse, a `perm_id` that is not Atlas's
 * shape, a blank description, a handler that throws — none of them produce an approval, and
 * each answers in a way CONTRACT's fail-closed rule already maps to deny on Atlas's side.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo, Socket } from "node:net";

import logger from "../../logger.js";
import { PermissionAsk, PermissionDecision } from "./types.js";

/** The path half of `callback_url`. The port half is whatever the OS hands us. */
export const CALLBACK_PATH = "/atlas-permission";

/** Atlas's `f"perm-{uuid.uuid4().hex}"`, and nothing else. */
export const PERM_ID_PATTERN = /^perm-[0-9a-f]{32}$/;

/** An ask is four short fields. Anything larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

export type AskHandler = (ask: PermissionAsk) => Promise<PermissionDecision>;

export interface CallbackListener {
  /** Derived from the port actually bound, never a hardcoded one. */
  url: string;
  /** Minted for this run alone. */
  token: string;
  close(): Promise<void>;
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  // The token's length is fixed and public, so leaking it costs nothing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(header: string | undefined): string {
  if (!header) return "";
  const match = /^bearer[ \t]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

function respond(response: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Read an ask out of a parsed body, or return null.
 *
 * A blank description is rejected rather than relayed: the description IS the whole of what
 * the human is shown, so an empty one is a prompt asking a person to approve nothing.
 */
export function parseAsk(body: unknown): PermissionAsk | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const permId = record.perm_id;
  const description = record.description;
  if (typeof permId !== "string" || !PERM_ID_PATTERN.test(permId)) return null;
  if (typeof description !== "string" || !description.trim()) return null;
  return {
    perm_id: permId,
    product: typeof record.product === "string" ? record.product : "",
    mode: typeof record.mode === "string" ? record.mode : "",
    description,
  };
}

/**
 * Start one listener for one tool call.
 *
 * Per call, not per process: two concurrent calls get two ports and two tokens, so a
 * callback for one run can never be answered by the other's elicitation. Port 0 lets the OS
 * pick, which is also why the URL is read back off the bound address.
 */
export async function startCallbackListener(
  onAsk: AskHandler,
): Promise<CallbackListener> {
  const token = randomBytes(32).toString("hex");
  const sockets = new Set<Socket>();

  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const path = (request.url || "").split("?")[0];
      if (request.method !== "POST" || path !== CALLBACK_PATH) {
        request.resume();
        respond(response, 404, { error: "not found" });
        return;
      }

      // AUTH FIRST, before the body is read or parsed. A caller that cannot present the
      // token gets no elicitation, no prompt, and nothing back that describes the run.
      if (!tokenMatches(bearer(request.headers.authorization), token)) {
        request.resume();
        logger.warn(
          "askBrowserstackAI: rejected a permission callback with a bad or missing token",
        );
        respond(response, 401, { error: "unauthorized" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(request));
      } catch {
        // No usable `perm_id` to echo, so there is no valid 200 to send. A non-200 is a
        // deny on Atlas's side, which is the right answer to a body we cannot read.
        respond(response, 400, { error: "malformed body" });
        return;
      }

      const ask = parseAsk(parsed);
      if (!ask) {
        respond(response, 400, { error: "malformed permission ask" });
        return;
      }

      const decision = await onAsk(ask);
      respond(response, 200, {
        // Echoed exactly. Atlas treats a mismatch as a deny, and so should it.
        perm_id: ask.perm_id,
        decision: decision.decision,
        reason: decision.reason,
      });
    } catch (error) {
      logger.error(
        "askBrowserstackAI: permission callback failed: %s",
        error instanceof Error ? error.message : String(error),
      );
      // Fail closed. Atlas maps a non-200 to a deny and records `error_relay`.
      if (!response.headersSent) respond(response, 500, { error: "relay failed" });
      else response.end();
    }
  }

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  // A callback is held open for as long as the human takes to answer. Node's default
  // 300s `requestTimeout` would cut that off at almost exactly the elicitation budget, so
  // the request timeout is disabled and the elicitation's own 270s is the only clock.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // LOOPBACK ONLY. Binding 0.0.0.0 would publish an approval prompt to the network.
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    token,
    close(): Promise<void> {
      return new Promise<void>((resolve) => {
        // Destroy first: `close()` alone waits out idle keep-alive connections, and this
        // runs in a `finally` that must not be able to hang the tool call.
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => resolve());
      });
    },
  };
}
