/**
 * `askBrowserStackAI` — one tool call in, one tool result out, with a human's approval
 * relayed through the middle of it.
 *
 * The shape, and why:
 *
 *   1. NEGOTIATE FIRST. `relayMode()` is consulted BEFORE Atlas is called, so Atlas learns
 *      whether a human is reachable before it starts rather than discovering it at the gate.
 *      Anything other than "offered" means `permission_relay` is omitted entirely and Atlas
 *      runs read-only — today's exact behaviour, and the path opencode and goose stay on.
 *      That also covers the hosted `REMOTE_MCP` deployment, where the relay cannot work at
 *      all; see `relayMode` for why. Nothing here depends on `sampling`, which Claude Code
 *      does not declare.
 *   2. LISTEN ON LOOPBACK. Transport is A2, so Atlas calls US back; because it initiates,
 *      the decision returns on the same connection to the same pod and PLAN.md's affinity
 *      problem never arises for this stdio deployment.
 *   3. ELICIT, ONCE. Atlas's `description` is the message, nothing is requested in the form,
 *      and the ACTION is mapped by CONTRACT §7 with no second chances.
 *   4. RETURN THE TRAIL. `approvals` and `applied_before_stop` are what let a caller tell
 *      "nothing happened" from "some steps applied, then stopped".
 *
 * FAIL CLOSED THROUGHOUT. A decline, a cancel, a timeout, a bad token, a body we cannot
 * parse, a handler that throws — every one of them denies. An unattended run cannot approve
 * itself because a headless client returns `cancel`, which is a deny.
 */

import {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolResult,
  ElicitResult,
  ErrorCode,
  McpError,
  RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import appConfig from "../../config.js";
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
import { Credentials, agentHeaders } from "./egress.js";
import {
  EVENT_PERMISSION,
  EVENT_RESULT,
  EVENT_RUN,
  decisionUrl,
  fetchAgentStreamTransport,
  fetchDeferredTransport,
  parseAsk,
} from "./stream.js";
import type { AgentStreamTransport, DeferredTransport } from "./stream.js";
import {
  incompleteResume,
  parkedResult,
  resumeFailed,
  runDeferred,
  runResumed,
} from "./deferred.js";
import {
  buildResult,
  decide,
  elicitationMessage,
  elicitationShape,
  errorResult,
} from "./relay.js";
import {
  AgentRequest,
  ApprovalRecord,
  AskResult,
  PermissionAsk,
  PermissionDecision,
  PRODUCTS,
  RelayMode,
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
  /**
   * The two transport seams, injectable so a test can drive a whole approval round trip
   * — ask, elicit, decide, result — without a socket.
   */
  streamTransport?: AgentStreamTransport;
  /** The deferred START (one request, one JSON response). Substituted in tests. */
  deferredTransport?: DeferredTransport;
}

/**
 * THE FALLBACK POSITIONING IN THE FIRST SENTENCE IS LOAD-BEARING.
 *
 * This server registers 45 tools, most of them hand-written for one endpoint each. Those are
 * faster, cheaper and more predictable than handing a task to an agent that has to work out
 * its own API calls, so they should win whenever one of them actually fits. What this tool
 * covers is the gap: a task nothing here has a tool for, or one where the specific tools were
 * tried and did not get there.
 *
 * A description is the ONLY thing steering that choice — the client picks a tool from these
 * words alone, before any call is made — so the ordering is deliberate: when to reach for it
 * first, what it does second, and the consent behaviour last.
 */
const DESCRIPTION =
  // Alpha status leads, deliberately. The model reads this before deciding to call, and a
  // tool that is not enabled for the account cannot do the job at all — so "there is a
  // per-account gate, fall back to the individual tools" is the most useful thing to say
  // first. Parenthesised so it reads as a status note, not as the tool's purpose.
  "(Alpha, limited availability. Enabled per account and per product; if it is not enabled " +
  "the call returns an entitlement error, nothing runs, and you should complete the task " +
  "with the individual tools instead. To request access, the user should contact their " +
  "BrowserStack account owner.) " +
  "Use this when no other BrowserStack tool here fits the task, or when the ones you tried " +
  "did not get you there. Prefer a specific tool whenever one fits: it is faster and more " +
  "predictable than handing the job to an agent. " +
  "Otherwise, describe what you want in plain language and BrowserStack's agent decides " +
  "which calls to make, then returns its answer plus the steps it took. Anything that would " +
  "change data pauses and asks you to confirm it first, in your own client; deletes are " +
  "refused outright. If your client cannot show you a prompt, the run is read-only and " +
  "everything it wanted to change comes back in `needs_approval` instead. One task per call.";

/**
 * `isError` marks a call that FAILED, not one that was refused.
 *
 * A `blocked` run is the feature working: the agent asked, a human said no, and the trail
 * says so. Flagging that as a tool error makes a client render a correct refusal in red and
 * — worse — invites it to retry, which is exactly the "retry forever" loop the distinct
 * `permission_relay` reasons exist to prevent. `ok` still means `status === "ok"`.
 */
function toResult(payload: AskResult): CallToolResult {
  const failed =
    payload.status === "error" || payload.status === "rate_limited";
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
  relatedRequestId?: RequestId,
): Promise<PermissionDecision> {
  let answer: ElicitResult;
  try {
    // `relatedRequestId` IS LOAD-BEARING OVER HTTP, and its absence fails silently.
    // Streamable HTTP routes a server->client message onto the stream of the request it
    // relates to (`_requestToStreamMapping`). With no id the SDK falls back to the
    // standalone SSE stream, and a host that answers GET /mcp with 405 has none — so the
    // SDK drops the message with "Stream is disconnected", the tool waits out its 270s,
    // and Atlas's gate expires into `reason: "timeout"`. The human is told they did not
    // answer a question they were never shown.
    //
    // Measured exactly that way against the hosted server before this was threaded
    // through. On stdio it is irrelevant — one pipe, nothing to route — which is why no
    // local test could have caught it.
    answer = await server.server.elicitInput(
      {
        mode: "form",
        // Framed with the PRODUCT and nothing else (v1.1 §G): a bare sentence with no
        // attribution is a worse prompt than a framed one, and `product` is all the
        // ask carries — the route, method, path and op_key never reach this side by design,
        // and that is the whole privacy boundary (the ask is four named fields). The
        // description goes through VERBATIM: paraphrasing it would mean the human approves
        // something other than what the model actually said. Atlas no longer rewrites it
        // either — it used to replace a route-shaped one with a placeholder, which asked a
        // person to approve a sentence they could not read; CONTRACT v2 §3 was amended and
        // that guard removed. An older Atlas can still send the placeholder, which is why
        // the framing is tested against it.
        message: elicitationMessage(ask.product, ask.description),
        requestedSchema: {
          // NOTHING IS REQUESTED. The action IS the answer: `accept` already means the human
          // approved, and `decline` already gives them an unambiguous refusal in the same
          // dialog. A `confirm` boolean used to live here and produced a FALSE DENIAL — a
          // user approved on preprod and was told they had refused, because a client renders
          // a form field and submits its unset value. We cannot distinguish that from a
          // deliberate untick, so the field is gone rather than guessed at.
          //
          // Fail-closed is untouched by this and never rested on the boolean: a headless
          // client with nobody at the terminal returns `cancel` (measured, HANDOFF.md), and
          // `cancel` is a deny. That is what stops an unattended run self-approving.
          type: "object",
          properties: {},
        },
      },
      // The inner rung of CONTRACT §4's ladder, strictly shorter than Atlas's 300s gate.
      { timeout: ELICITATION_TIMEOUT_MS, relatedRequestId },
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
    // not given one on the wire: the throw says "this side broke" without claiming a human
    // decided anything. `runStreamed` catches it and sends the explicit deny the throw
    // implies — see the comment there for why A1 cannot let it escape.
    approvals.push({
      description: ask.description,
      decision: "deny",
      reason: "error",
    });
    throw error;
  }

  // The SHAPE of the answer only — a fixed action enum and a boolean, never the description
  // or anything a user typed. Logged so that what a client actually submits can be read next
  // time rather than inferred from a compiled binary.
  logger.info(
    "askBrowserStackAI: elicitation answered %s",
    elicitationShape(answer),
  );

  const { decision, reason } = decide(answer);
  approvals.push({ description: ask.description, decision, reason });
  return { perm_id: ask.perm_id, decision, reason };
}

/**
 * Decide whether to offer the approval channel at all.
 *
 * STDIO ALWAYS. HOSTED ONLY WHEN ITS OPERATOR OPTS IN — and the reason is a property of
 * the HOST, not of this tool.
 *
 * Elicitation is a SERVER-INITIATED message whose answer arrives on a SEPARATE POST. A
 * stateless host builds a fresh `McpServer` per POST, so that answer reaches an instance
 * which never asked anything, while the one actually suspended on `await` waits out its
 * timeout. Nothing in this package can fix that; what it holds is a live Promise resolver
 * and a paused function in the host's heap, and a paused call cannot be moved.
 *
 * This is why `841c6358` was right to remove sessions from the hosted server on the
 * grounds that "we use neither server-initiated messages nor subscriptions/sampling" —
 * this feature is the exception that commit did not have to consider.
 *
 * MEASURED, not assumed: with the host keeping one server per session
 * (browserstack/remote-mcp-server#96), a tool call and its elicitation answer were served
 * by the same instance over hosted Streamable HTTP, and the relay completed. So the
 * refusal below is now conditional rather than absolute.
 *
 * It stays OFF by default because it depends on a deployment property this package cannot
 * observe. A hosted operator turns it on only once their host keeps sessions AND pins a
 * session to a pod — sessions are per-process, so without affinity the answer POST can
 * land on a replica that has never seen it. That failure is intermittent and reads like a
 * client bug, which is exactly why it must not be the default.
 *
 * When refused, Atlas runs read-only — a supported path that already works — and
 * `permission_relay.reason` names the reason so nobody mistakes it for a human's no.
 */
/**
 * CONTRACT v2 (A1) — drive one run over the stream.
 *
 * The loop is the whole orchestration: read events, elicit on each `permission`, POST
 * the decision, hand the `result` to `buildResult`. It decides nothing itself —
 * `relayOneAsk` owns the elicitation and the allow/deny mapping, unchanged from the
 * transport it replaced. That is deliberate: the transport changed, the judgement did
 * not, and the judgement is the part that is dangerous to get wrong.
 *
 * Reading pauses while a human is being prompted, which is correct rather than merely
 * tolerable: Atlas is blocked on that decision and will emit nothing but heartbeats
 * until it arrives, and heartbeats are dropped by the parser.
 *
 * A run that ends with no `result` is an error, not an empty success. A stream that
 * simply stops is indistinguishable from a network drop, and reporting it as a finished
 * run with no answer would be the transport quietly speaking for the agent.
 */
async function runStreamed(
  server: McpServer,
  streamTransport: AgentStreamTransport,
  postTransport: DeferredTransport,
  url: string,
  headers: Record<string, string>,
  body: AgentRequest,
  approvals: ApprovalRecord[],
  mode: RelayMode,
  product: string,
  relatedRequestId?: RequestId,
): Promise<AskResult> {
  let runId = "";
  let result: unknown;
  let sawResult = false;
  // 200 unless the reply was not a stream at all, in which case the transport carries
  // the real status — `relay.ts` needs it to tell 401 from 403 from a plain failure.
  let resultStatus = 200;
  let pending: PermissionAsk | null = null;

  // PHASE 1 — the start, streamed. Kept a stream rather than folded into the decision
  // loop below because a long turn needs the heartbeats: a proxy that gives up
  // mid-thinking looks exactly like a hang.
  for await (const event of streamTransport(url, headers, body)) {
    if (event.event === EVENT_RUN) {
      runId = String((event.data as { run_id?: string })?.run_id || "");
      continue;
    }
    if (event.event === EVENT_RESULT) {
      result = event.data;
      sawResult = true;
      if (typeof event.status === "number") resultStatus = event.status;
      continue;
    }
    if (event.event !== EVENT_PERMISSION) continue;

    // Validated, not cast: a frame missing a usable `perm_id` or carrying a blank
    // description cannot produce an answerable prompt, so it must not produce a prompt.
    const ask = parseAsk(event.data);
    if (!ask) {
      logger.error(
        "askBrowserStackAI: unusable permission ask on the stream; ignoring",
      );
      continue;
    }
    if (!runId) {
      // Atlas emits `run` before any ask precisely so this cannot happen. If it does,
      // there is nowhere to send a decision — so do not prompt a human for an answer
      // that could never be delivered.
      logger.error(
        "askBrowserStackAI: permission ask arrived before run_id; cannot answer",
      );
      continue;
    }
    pending = ask;
  }

  // PHASE 2 — answer, and keep answering. The stream ENDED at the park: Atlas's ask is
  // in its checkpoint, not in a coroutine waiting on this socket, so the run is carried
  // forward by the decision request itself and its reply is either the next ask or the
  // finished run.
  //
  // This is what used to be a POST in the middle of phase 1, whose 204 was acknowledged
  // and whose outcome was expected to arrive on the same stream. That could not survive
  // the ask moving into the checkpoint, and the shape it becomes is the deferred one —
  // the only difference being who supplies the decision.
  while (pending) {
    // `relayOneAsk` RETHROWS on an unexpected elicitation failure. Letting it escape
    // would abandon the run and leave Atlas parked until its gate expires — turning a
    // client hiccup into a five-minute stall — so it is caught and converted into the
    // explicit deny the throw used to imply. `relayOneAsk` has already recorded the
    // approvals entry, so only the wire decision is missing.
    let decision: PermissionDecision;
    try {
      decision = await relayOneAsk(
        server,
        pending,
        approvals,
        relatedRequestId,
      );
    } catch (error) {
      logger.warn(
        "askBrowserStackAI: elicitation failed, denying explicitly: %s",
        error instanceof Error ? error.message : String(error),
      );
      decision = {
        perm_id: pending.perm_id,
        decision: "deny",
        reason: "error",
      };
    }

    const response = await postTransport(decisionUrl(url, runId), headers, {
      perm_id: decision.perm_id,
      decision: decision.decision,
      reason: decision.reason || "",
      product,
    });
    if (response.status === 404) {
      // No such parked run: expired, already answered, or not ours. None of those is
      // an approval and none of them changed anything — but a denial we could not
      // deliver is not a denial either, so say which.
      return resumeFailed(
        "That approval could not be applied (HTTP 404). The run may have expired — " +
          "BrowserStack AI stops waiting after five minutes — or it may already have " +
          "been answered. Nothing was changed beyond any step you already approved.",
      );
    }

    const parked = parkedResult(response.body, product);
    if (parked) {
      // Another ask: the task needs more than one approval, and each one is a separate
      // question for the human.
      pending = {
        perm_id: parked.ask.perm_id,
        description: parked.ask.description,
        product: parked.ask.product,
        mode: parked.ask.mode,
      } as PermissionAsk;
      continue;
    }
    return buildResult(response, approvals, mode, product);
  }

  if (!sawResult) {
    return errorResult(
      "BrowserStack AI ended the run without a result. Nothing was changed " +
        "beyond any step you already approved.",
      approvals,
    );
  }
  // Shaped as an `AgentResponse` so `buildResult` — written for the transport A1 replaced
  // and unchanged — sees exactly what it always saw.
  return buildResult(
    { status: resultStatus, body: result },
    approvals,
    mode,
    product,
  );
}

export function relayMode(server: McpServer): RelayMode {
  // An explicit transport wins over whatever the deployment implies. `REMOTE_MCP`
  // cannot select `deferred` from a local stdio install — that flag makes this
  // entrypoint exit, because the hosted deployment runs remote-mcp-server instead — so
  // without this there is no way to exercise the two-call flow anywhere it can be
  // watched. "elicit" forces the other direction for the same reason.
  const forced = appConfig.ASK_BROWSERSTACK_RELAY_TRANSPORT;
  if (forced === "deferred") return "deferred";
  if (forced !== "elicit" && appConfig.REMOTE_MCP) {
    // DEFERRED, unconditionally, and not because elicitation would be worse here — it
    // would be better. It is what makes this process stateful: a suspended
    // `elicitation/create` pins an McpServer in one pod's heap until the answer
    // arrives, so the hosted deployment would have to keep sessions, pin requests to a
    // pod and cap how many can be alive. Deferred removes the suspension, and with it
    // the reason any of that exists.
    //
    // THERE IS NO OPT-IN ANY MORE. `ASK_BROWSERSTACK_ALLOW_REMOTE_RELAY` gated this
    // while relaying meant elicitation — it was a guard against switching on the
    // stateful thing, and that thing is gone. Two better switches remain: this tool's
    // own `ASK_BROWSERSTACK_DISABLED`, which is read per call and so does not need a
    // pod roll, and Atlas's `delegation.permission_relay`, which turns the relay off
    // for every client at once from a config change.
    return "deferred";
  }
  // stdio keeps elicitation, deliberately: one process, nothing to pin, and the client
  // renders the prompt so the model cannot fabricate the answer. Nothing is gained by
  // making a local install pay the two-call cost.
  //
  // The real gate here: can THIS client be asked? A client that never declared
  // `elicitation` gets a read-only run whatever the deployment.
  return server.server.getClientCapabilities()?.elicitation
    ? "offered"
    : "no_human";
}

export function addAskBrowserStackAITool(
  server: McpServer,
  deps: AskDeps,
  config?: BrowserStackConfig,
): Record<string, RegisteredTool> {
  // A1 (CONTRACT v2) is the only path; A2 is gone. No version flag is needed to talk to
  // an Atlas that predates the stream: such a server answers `POST /agent` with ordinary
  // JSON, the parser sees no `text/event-stream`, and the run degrades to a read-only
  // answer carrying that response's own status.
  const streamTransport = deps.streamTransport || fetchAgentStreamTransport();
  // Resolved here with the others: one place decides which transports this
  // registration uses, so a test substituting one is not surprised by another.
  const deferredTransport = deps.deferredTransport || fetchDeferredTransport();
  const tools: Record<string, RegisteredTool> = {};

  /** Instrumentation in the house style, and never fatal to the call it wraps. */
  const track = (name: string) => {
    try {
      trackMCP(name, server.server.getClientVersion()!, undefined, config);
    } catch {
      // Telemetry must not decide whether a tool call succeeds.
    }
  };

  tools.askBrowserStackAI = server.tool(
    "askBrowserStackAI",
    DESCRIPTION,
    {
      product: z
        .enum(PRODUCTS)
        .describe(
          "Which product to work in: tm (Test Management), " +
            "tra (Test Reporting & Analytics).",
        ),
      query: z
        .string()
        .describe("What you want, in plain language. One thing per call."),
      // --- resuming a parked run (the hosted, deferred path only) ---
      //
      // Both together or neither. They exist because that deployment cannot hold a
      // prompt open mid-run: it returns the pending approval instead, and the caller
      // comes back. On a local stdio install these are never needed — the prompt
      // appears inside the first call — so they are optional and unmentioned in the
      // description's main flow.
      run_id: z
        .string()
        .optional()
        .describe(
          "Only when continuing a previous call that returned " +
            'status "needs_approval": the `run_id` it gave you. Send `decision` too.',
        ),
      perm_id: z
        .string()
        .optional()
        .describe(
          "The `perm_id` the previous call returned, naming WHICH approval this " +
            "answers. Send it with `run_id` and `decision`.",
        ),
      decision: z
        .enum(["allow", "deny"])
        .optional()
        .describe(
          "Your answer to the approval that previous call returned, once the user " +
            "has told you which it is. Requires `run_id` and `perm_id`. " +
            "Never assume allow — ask the user.",
        ),
    },
    {
      // It can write now, which is the whole point of the relay. Destructive operations
      // stay refused, so `destructiveHint` is false for the same reason invokeEndpoint
      // sets it false: consent is not a licence to delete.
      readOnlyHint: false,
      destructiveHint: false,
      // openWorldHint: the agent fans out to product APIs chosen at runtime, so the set of
      // effects is not knowable from this schema. idempotentHint false because a repeated
      // call can create a second record — the relay asks again, it does not dedupe.
      openWorldHint: true,
      idempotentHint: false,
      title: "Ask BrowserStack AI (Alpha)",
    },
    async (
      { product, query, run_id, perm_id, decision },
      extra,
    ): Promise<CallToolResult> => {
      track("askBrowserStackAI");
      const approvals: ApprovalRecord[] = [];
      // Negotiated before anything else so the failure paths below report the mode they
      // would have run in.
      const mode = relayMode(server);

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

        // RESUMING a parked run: no new run, no task — just the decision and the
        // remainder. Checked before anything else because the arguments are mutually
        // exclusive with starting one, and a caller that sent both meant to resume.
        if (run_id) {
          if (!perm_id || !decision) {
            return toResult(incompleteResume());
          }
          return toResult(
            await runResumed(
              url,
              headers,
              run_id,
              perm_id,
              decision,
              // The SAME transport the start uses: since the converged gate both calls
              // POST and read back either a parked run or a finished one.
              deferredTransport,
              mode,
              product,
            ),
          );
        }

        // DEFERRED: the hosted shape. One request, one JSON answer, nothing held open
        // while a human decides — see `deferred.ts` for why that matters here and why
        // stdio does not use it.
        if (mode === "deferred") {
          return toResult(
            await runDeferred(
              url,
              headers,
              body,
              deferredTransport,
              mode,
              product,
            ),
          );
        }

        // A1: asking for a stream costs nothing to set up — no port, no listener, no
        // per-run bearer, because nothing dials in. Which is the whole point: the
        // callback this replaces could never reach a laptop behind NAT, so the feature
        // was read-only for every real user regardless of what was configured.
        if (mode === "offered") {
          body.permission_relay = { mode: "stream" };
        } else {
          // Omitted ENTIRELY, not sent empty: its absence is what selects Atlas's
          // read-only HeadlessGate.
          logger.info(
            "askBrowserStackAI: no permission relay (%s); running read-only",
            mode,
          );
        }

        // `product` reaches the result so an entitlement refusal can name it: the flags
        // are per product, and a bare "not enabled" sends the user to their admin
        // asking about the wrong thing.
        return toResult(
          await runStreamed(
            server,
            streamTransport,
            deferredTransport,
            url,
            headers,
            body,
            approvals,
            mode,
            product,
            // The tool call's own id, so each elicitation is routed onto THIS request's
            // stream. Over Streamable HTTP there is nowhere else for it to go.
            extra?.requestId,
          ),
        );
      } catch (error) {
        const message =
          error instanceof AskError || error instanceof Error
            ? error.message
            : String(error);
        logger.error("askBrowserStackAI failed: %s", message);
        // Error telemetry, in the same never-fatal shape as the success-path `track()`:
        // a failing tool call must not be made worse by a failing analytics call.
        try {
          trackMCP(
            "askBrowserStackAI",
            server.server.getClientVersion()!,
            error,
            config,
          );
        } catch {
          /* ignore */
        }
        // No `canElicit` argument: the request never left this process, so whether the
        // client could have been prompted is not what the reader needs to know.
        return toResult(errorResult(message, approvals));
      }
      // No teardown: A1 opens no port and binds nothing, so there is nothing that can
      // leak across calls or survive an error. The stream is closed by its own
      // iteration ending, and Atlas drops the run when the response completes.
    },
  );

  return tools;
}

/** The tool-adder the server factory calls. */
export function addAskBrowserStackAIToolFromConfig(
  server: McpServer,
  config: BrowserStackConfig,
): Record<string, RegisteredTool> {
  if (!isEnabled()) {
    logger.info("askBrowserStackAI disabled by ASK_BROWSERSTACK_DISABLED");
    return {};
  }
  const credentials = () => ({
    username: config["browserstack-username"],
    accessKey: config["browserstack-access-key"],
  });
  const tokenTransport = fetchTokenTransport();
  return addAskBrowserStackAITool(
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

export default addAskBrowserStackAIToolFromConfig;
