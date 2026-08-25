/**
 * `askBrowserstackAI` — one tool call in, one tool result out, with a human's approval
 * relayed through the middle of it.
 *
 * The shape, and why:
 *
 *   1. NEGOTIATE FIRST. `getClientCapabilities()?.elicitation` is checked BEFORE Atlas is
 *      called, so Atlas learns whether a human is reachable before it starts rather than
 *      discovering it at the gate. No capability means `permission_relay` is omitted
 *      entirely and Atlas runs read-only — today's exact behaviour, and the path opencode
 *      and goose stay on. Nothing here depends on `sampling`, which Claude Code does not
 *      declare.
 *   2. LISTEN ON LOOPBACK. Transport is A2, so Atlas calls US back; because it initiates,
 *      the decision returns on the same connection to the same pod and PLAN.md's affinity
 *      problem never arises for this stdio deployment.
 *   3. ELICIT, ONCE. Atlas's `description` is the message, `{ confirm: boolean }` the
 *      schema, and the answer is mapped by CONTRACT §7 with no second chances.
 *   4. RETURN THE TRAIL. `approvals` and `applied_before_stop` are what let a caller tell
 *      "nothing happened" from "some steps applied, then stopped".
 *
 * FAIL CLOSED THROUGHOUT. Only `accept` plus `confirm: true` is an allow. Everything else —
 * a decline, a cancel, a timeout, a bad token, a body we cannot parse, a handler that throws
 * — denies.
 */

import { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolResult,
  ElicitResult,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { trackMCP } from "../../lib/instrumentation.js";
import { BrowserStackConfig } from "../../lib/types.js";
import logger from "../../logger.js";
import {
  AskError,
  ELICITATION_TIMEOUT_MS,
  agentUrl,
  authTokenUrl,
  isEnabled,
} from "./config.js";
import { fetchTokenTransport, mintCentralToken } from "./central-oauth.js";
import {
  AgentTransport,
  Credentials,
  agentHeaders,
  fetchAgentTransport,
} from "./egress.js";
import {
  CallbackListener,
  startCallbackListener,
} from "./callback.js";
import { buildResult, decide, elicitationMessage, errorResult } from "./relay.js";
import {
  AgentRequest,
  ApprovalRecord,
  AskResult,
  PermissionAsk,
  PermissionDecision,
  PRODUCTS,
} from "./types.js";

export interface AskDeps {
  /** Resolved per call: a deployment's host is configuration, not a constructor argument. */
  agentUrl: () => string;
  /**
   * Sign in and return a bearer for `POST /agent`. Cached behind this, not minted per call.
   *
   * A function rather than a value because it is resolved per call for the same reason the
   * host is, and because it can fail in ways a caller needs told apart.
   */
  mintToken: () => Promise<string>;
  /**
   * Read per call, not captured: the remote server rebuilds config per session, so a
   * captured credential would outlive the session it belongs to.
   *
   * These are now THE AUTH CREDENTIAL, not merely attribution: the access key is exchanged
   * for a user-attested central JWT, which is what lets Atlas run the approved product call
   * as the human rather than as a shared service account.
   */
  credentialsFor: () => Credentials;
  transport?: AgentTransport;
  /** The seam the tests bind a fake listener to. */
  startListener?: typeof startCallbackListener;
}

const DESCRIPTION =
  "Ask a question or request a change in plain language about a BrowserStack product. " +
  "BrowserStack's agent decides which calls to make and returns its answer plus the steps " +
  "it took. Anything that would change data pauses and asks you to confirm it first, in " +
  "your own client; deletes are refused outright. If your client cannot show you a prompt, " +
  "the run is read-only and everything it wanted to change comes back in `needs_approval` " +
  "instead. One task per call.";

const CONFIRM_TITLE = "Approve this change";
const CONFIRM_DESCRIPTION =
  "Yes, make this change. Anything else — including dismissing this prompt — refuses it.";

/**
 * `isError` marks a call that FAILED, not one that was refused.
 *
 * A `blocked` run is the feature working: the agent asked, a human said no, and the trail
 * says so. Flagging that as a tool error makes a client render a correct refusal in red and
 * — worse — invites it to retry, which is exactly the "retry forever" loop the distinct
 * `permission_relay` reasons exist to prevent. `ok` still means `status === "ok"`.
 */
function toResult(payload: AskResult): CallToolResult {
  const failed = payload.status === "error" || payload.status === "rate_limited";
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(failed ? { isError: true } : {}),
  };
}

function isTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/**
 * Relay one ask to the human and record what they said.
 *
 * The elicitation is NEVER retried. A client that timed out or errored has told us it
 * cannot get an answer, and asking again only produces a second prompt for the same action.
 */
async function relayOneAsk(
  server: McpServer,
  ask: PermissionAsk,
  approvals: ApprovalRecord[],
): Promise<PermissionDecision> {
  let answer: ElicitResult;
  try {
    answer = await server.server.elicitInput(
      {
        mode: "form",
        // Framed with the PRODUCT and nothing else (v1.1 §G): a bare sentence with no
        // attribution is a worse prompt than a framed one, and `product` is all the
        // callback carries — the route, method, path and op_key never reach this side by
        // design. The description itself goes through VERBATIM: paraphrasing it would mean
        // the human approves something other than what the model actually said. Atlas
        // route-checks it first (v1.1 §A), so one that quoted an internal path arrives as a
        // withheld-placeholder sentence, which reads correctly after the prefix.
        message: elicitationMessage(ask.product, ask.description),
        requestedSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              title: CONFIRM_TITLE,
              description: CONFIRM_DESCRIPTION,
            },
          },
          // NEITHER `required` NOR `default: false`, and this is not the loosening it looks
          // like. Both were here so that a form submitted untouched would refuse rather than
          // approve — but "form" is the only elicitation mode the SDK has, so a client
          // renders this as an unchecked checkbox, and pressing APPROVE sent
          // `accept` + `confirm: false`. That made the approve path literally unreachable:
          // a human who approved got back "refused: a human said no".
          //
          // The guard against an unattended run was never this boolean. It is that a
          // headless client returns `cancel`, which is measured (HANDOFF.md) and unchanged,
          // and `accept` means the protocol itself says a human accepted. The cost of the
          // old shape was not caution, it was a FALSE DENIAL — indistinguishable in the
          // result from a real refusal, which is the exact confusion D3 and N1 existed to
          // remove.
          //
          // The field stays so a client that does render it still offers an explicit tick,
          // and an explicit untick is still honoured as a refusal. Only ABSENCE is consent.
        },
      },
      // The inner rung of CONTRACT §4's ladder, strictly shorter than Atlas's 300s gate.
      { timeout: ELICITATION_TIMEOUT_MS },
    );
  } catch (error) {
    if (isTimeout(error)) {
      approvals.push({
        description: ask.description,
        decision: "deny",
        reason: "timeout",
      });
      return { perm_id: ask.perm_id, decision: "deny", reason: "timeout" };
    }
    // An unexpected failure has no honest `reason` in CONTRACT §2's vocabulary, so it is
    // not given one: rethrowing makes the callback answer 500, which Atlas's fail-closed
    // rule already reads as a deny and records as `error_relay`.
    approvals.push({
      description: ask.description,
      decision: "deny",
      reason: "error",
    });
    throw error;
  }

  const { decision, reason } = decide(answer);
  approvals.push({ description: ask.description, decision, reason });
  return { perm_id: ask.perm_id, decision, reason };
}

export function addAskBrowserstackAITool(
  server: McpServer,
  deps: AskDeps,
  config?: BrowserStackConfig,
): Record<string, RegisteredTool> {
  const transport = deps.transport || fetchAgentTransport();
  const startListener = deps.startListener || startCallbackListener;
  const tools: Record<string, RegisteredTool> = {};

  /** Instrumentation in the house style, and never fatal to the call it wraps. */
  const track = (name: string) => {
    try {
      trackMCP(name, server.server.getClientVersion()!, undefined, config);
    } catch {
      // Telemetry must not decide whether a tool call succeeds.
    }
  };

  tools.askBrowserstackAI = server.tool(
    "askBrowserstackAI",
    DESCRIPTION,
    {
      product: z
        .enum(PRODUCTS)
        .describe(
          "Which product to work in: tm (Test Management), a11y (Accessibility), " +
            "tra (Test Reporting & Analytics).",
        ),
      query: z
        .string()
        .describe("What you want, in plain language. One thing per call."),
    },
    {
      // It can write now, which is the whole point of the relay. Destructive operations
      // stay refused, so `destructiveHint` is false for the same reason invokeEndpoint
      // sets it false: consent is not a licence to delete.
      readOnlyHint: false,
      destructiveHint: false,
      title: "Ask BrowserStack AI",
    },
    async ({ product, query }): Promise<CallToolResult> => {
      track("askBrowserstackAI");
      const approvals: ApprovalRecord[] = [];
      // Negotiated before anything else so the failure paths below report the mode they
      // would have run in.
      const canElicit = Boolean(
        server.server.getClientCapabilities()?.elicitation,
      );
      let listener: CallbackListener | undefined;

      try {
        const url = deps.agentUrl();
        // Signed in BEFORE the listener is opened and before the run starts. Minting
        // lazily mid-call would put a token round-trip inside the window where a human is
        // being prompted, and a mint that failed there would strand an open port.
        const headers = agentHeaders(await deps.mintToken());
        const body: AgentRequest = { task: query, product };

        // Attribution, and now belt-and-braces rather than the source of truth: the minted
        // JWT is user-attested, so Atlas sets `principal_verified=True` and takes the acting
        // user from signed claims instead of this field. It is still sent because it is part
        // of the frozen wire format (CONTRACT v1.2 §3) and dropping it would be a one-sided
        // change — but nothing should trust it, and Atlas no longer does.
        // Omitted ENTIRELY when unset, never sent as "".
        const username = (deps.credentialsFor().username || "").trim();
        if (username) body.user_id = username;

        if (canElicit) {
          listener = await startListener((ask) =>
            relayOneAsk(server, ask, approvals),
          );
          body.permission_relay = {
            callback_url: listener.url,
            token: listener.token,
          };
        } else {
          // Omitted ENTIRELY, not sent empty: its absence is what selects Atlas's
          // read-only HeadlessGate.
          logger.info(
            "askBrowserstackAI: client declares no elicitation capability; running " +
              "read-only without a permission relay",
          );
        }

        return toResult(buildResult(await transport(url, headers, body), approvals, canElicit));
      } catch (error) {
        const message =
          error instanceof AskError || error instanceof Error
            ? error.message
            : String(error);
        logger.error("askBrowserstackAI failed: %s", message);
        // No `canElicit` argument: the request never left this process, so whether the
        // client could have been prompted is not what the reader needs to know.
        return toResult(errorResult(message, approvals));
      } finally {
        // Torn down here so it cannot leak across calls or survive an error, and awaited
        // so the port is released before the tool result is handed back.
        if (listener) {
          await listener.close().catch((error) => {
            logger.warn(
              "askBrowserstackAI: permission callback listener did not close cleanly: %s",
              error instanceof Error ? error.message : String(error),
            );
          });
        }
      }
    },
  );

  return tools;
}

/** The tool-adder the server factory calls. */
export function addAskBrowserstackAIToolFromConfig(
  server: McpServer,
  config: BrowserStackConfig,
): Record<string, RegisteredTool> {
  if (!isEnabled()) {
    logger.info("askBrowserstackAI disabled by ASK_BROWSERSTACK_DISABLED");
    return {};
  }
  const credentials = () => ({
    username: config["browserstack-username"],
    accessKey: config["browserstack-access-key"],
  });
  const tokenTransport = fetchTokenTransport();
  return addAskBrowserstackAITool(
    server,
    {
      // Both resolved per call. An unconfigured host surfaces as a named error from the
      // tool rather than as a missing tool, so the cause is visible to whoever hits it.
      agentUrl,
      mintToken: () =>
        mintCentralToken(authTokenUrl(), credentials(), tokenTransport),
      credentialsFor: credentials,
    },
    config,
  );
}

export default addAskBrowserstackAIToolFromConfig;
