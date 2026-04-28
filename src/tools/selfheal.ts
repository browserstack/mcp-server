import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getSelfHealSelectors,
  fetchSelfHealingReportByBuild,
} from "./selfheal-utils/selfheal.js";
import {
  fetchTestCodeForSessions,
  formatTestCodeAsContext,
  describeTestCodeFetchIssues,
  TestCodeEntry,
  SessionTestCode,
} from "./selfheal-utils/fetch-test-code.js";
import logger from "../logger.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";

// Local helper: merges per-call credential overrides (when the user pastes
// credentials in chat) with the server-configured pair, returning null when
// neither source has a usable username/accessKey. Lives here because the
// self-heal tools are the only callers that need to degrade gracefully —
// `getBrowserStackAuth` throws, which is wrong for these flows.
function resolveBrowserStackAuth(
  config: BrowserStackConfig,
  overrides: { username?: string; accessKey?: string } = {},
): { config: BrowserStackConfig } | null {
  const username = (
    overrides.username?.trim() || config["browserstack-username"] || ""
  ).trim();
  const accessKey = (
    overrides.accessKey?.trim() || config["browserstack-access-key"] || ""
  ).trim();
  if (!username || !accessKey) return null;
  return {
    config: {
      ...config,
      "browserstack-username": username,
      "browserstack-access-key": accessKey,
    },
  };
}

type SessionType = "automate" | "app-automate";

interface CredsArgs {
  username?: string;
  accessKey?: string;
}

interface FetchArgs extends CredsArgs {
  sessionId?: string;
  sessionType?: SessionType;
  buildUuid?: string;
}

const CREDS_PROMPT_TEXT =
  "BrowserStack credentials are required to call this API. " +
  "Please ask the user for their BrowserStack username and access key " +
  "(https://www.browserstack.com/accounts/profile/details) and re-invoke " +
  "this tool with the `username` and `accessKey` arguments, or configure " +
  "BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY on the server.";

function credsMissingResult(): CallToolResult {
  return {
    content: [{ type: "text", text: CREDS_PROMPT_TEXT }],
  };
}

function friendlyApiError(error: unknown, context: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b|Unauthorized/i.test(message)) {
    return `Authentication with BrowserStack failed while ${context}. The username/access key is incorrect or the user does not have access to this resource. Ask the user to re-check the credentials.`;
  }
  if (/\b404\b|Not Found/i.test(message)) {
    return `BrowserStack returned 404 while ${context}. The identifier is likely invalid or the build/session has no self-healing data. Ask the user to verify the ID.`;
  }
  if (/\b403\b|Forbidden/i.test(message)) {
    return `BrowserStack returned 403 while ${context}. The provided credentials do not have permission to access this resource.`;
  }
  return `Error ${context}: ${message}`;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Wraps per-status guidance in a HEAD-OF-RESPONSE banner the LLM is unlikely
 * to paraphrase away. The banner must come BEFORE the plan JSON so the model
 * anchors on it when composing its user-facing reply.
 */
function buildWarningBanner(body: string): string {
  return [
    "## ATTENTION — test code fetch did not return usable source",
    "",
    "Read this block BEFORE composing your reply to the user. When relaying " +
      "this to the user, quote the provided phrasings below as closely as " +
      "possible — do NOT compress multiple statuses into a generic " +
      "'credentials or session issue' message. If the status below is " +
      "`non_sdk_build`, it is definitely NOT a credentials problem.",
    "",
    body,
    "",
    "---",
    "",
  ].join("\n");
}

/**
 * Emits the same warning banner for the fetch-selectors tool (session and
 * build modes) when any session's test code came back unusable.
 */
function buildTestCodeFetchBanner(testCodeResults: SessionTestCode[]): string {
  const problematic = testCodeResults.filter((t) => t.status !== "ok");
  if (problematic.length === 0) return "";
  return buildWarningBanner(describeTestCodeFetchIssues(problematic));
}

type AnyRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined<T>(...values: T[]): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * Normalizes a locator reference to the canonical `{ strategy, value }` shape.
 * Accepts alternate keys used by the BrowserStack healing report and common
 * LLM/user mistakes (`type`, `using`). Passes the value through untouched if
 * it is not an object so zod can still produce a clear error later.
 */
function normalizeLocatorRef(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const strategy = firstDefined(
    input.strategy,
    input.type,
    input.using,
    input.locatorType,
    input.by,
  );
  const value = firstDefined(input.value, input.selector, input.locator);
  return { strategy, value };
}

/**
 * Normalizes a single locator pair. Accepts:
 *   - `{ original, healed, thought }` (canonical)
 *   - `{ original_locator, healed_locator, healing_thought }` (report-native)
 *   - `{ from, to, reason }` (occasional LLM variant)
 */
function normalizeLocatorPair(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const original = normalizeLocatorRef(
    firstDefined(input.original, input.original_locator, input.from),
  );
  const healed = normalizeLocatorRef(
    firstDefined(input.healed, input.healed_locator, input.to),
  );
  const thought = firstDefined(
    input.thought,
    input.healing_thought,
    input.reason,
    input.note,
  );
  const out: AnyRecord = { original, healed };
  if (thought !== undefined) out.thought = thought;
  return out;
}

/**
 * Normalizes a single session object. Accepts snake_case session ids and
 * the healing-report-native `healed_selectors` array as an alias for
 * `locators`.
 */
function normalizeSession(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const sessionId = firstDefined(
    input.sessionId,
    input.session_id,
    input.id,
    input.session_uuid,
    input.sessionUuid,
  );
  const sessionName = firstDefined(
    input.sessionName,
    input.session_name,
    input.name,
  );
  const rawLocators = Array.isArray(input.locators)
    ? input.locators
    : Array.isArray(input.healed_selectors)
      ? input.healed_selectors
      : Array.isArray(input.selectors)
        ? input.selectors
        : [];
  const locators = rawLocators.map(normalizeLocatorPair);
  const out: AnyRecord = { locators };
  if (sessionId !== undefined) out.sessionId = sessionId;
  if (sessionName !== undefined) out.sessionName = sessionName;
  return out;
}

/**
 * Normalizes the `sessions` argument. Accepts:
 *   - an array of sessions (canonical)
 *   - a single session object (wrapped in an array)
 *   - an envelope like `{ action, sessions: [...] }` (unwrap)
 *   - the raw healing report shape `{ healing_logs: [...] }` (map to sessions)
 */
function normalizeSessionsInput(input: unknown): unknown {
  if (input === undefined || input === null) return input;

  if (Array.isArray(input)) {
    return input.map(normalizeSession);
  }

  if (isPlainObject(input)) {
    if (Array.isArray(input.sessions)) {
      return (input.sessions as unknown[]).map(normalizeSession);
    }
    if (Array.isArray(input.healing_logs)) {
      return (input.healing_logs as unknown[]).map(normalizeSession);
    }
    // Looks like a lone session payload — wrap it.
    if (
      "locators" in input ||
      "healed_selectors" in input ||
      "sessionId" in input ||
      "session_id" in input
    ) {
      return [normalizeSession(input)];
    }
  }

  // Unknown shape — let zod surface a descriptive error.
  return input;
}

export async function fetchSelfHealSelectorTool(
  args: FetchArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const sessionId = trimOrUndefined(args.sessionId);
  const buildUuid = trimOrUndefined(args.buildUuid);

  if ((sessionId && buildUuid) || (!sessionId && !buildUuid)) {
    return {
      content: [
        {
          type: "text",
          text:
            "Please provide exactly one of `sessionId` or `buildUuid`. " +
            "Use `buildUuid` when the user shares a build UUID (the tool will " +
            "fetch the full self-healing report and test code for every " +
            "session in the build). Use `sessionId` when the user wants to " +
            "inspect a single Automate/App-Automate session.",
        },
      ],
    };
  }

  const resolved = resolveBrowserStackAuth(config, {
    username: args.username,
    accessKey: args.accessKey,
  });
  if (!resolved) return credsMissingResult();
  const effectiveConfig = resolved.config;

  try {
    if (sessionId) {
      const [selectors, testCodeResults] = await Promise.all([
        getSelfHealSelectors(
          sessionId,
          effectiveConfig,
          args.sessionType ?? "automate",
        ),
        fetchTestCodeForSessions([sessionId], effectiveConfig),
      ]);

      const testCodeContext = formatTestCodeAsContext(testCodeResults);
      const banner = buildTestCodeFetchBanner(testCodeResults);

      return {
        content: [
          {
            type: "text",
            text:
              banner +
              "Self-heal selectors fetched successfully (sessionId log-parse mode):\n" +
              JSON.stringify(selectors, null, 2) +
              (testCodeContext
                ? "\n\nThe following test code was found for this session. " +
                  "Use it to understand the test intent and make more accurate " +
                  "selector replacements:\n" +
                  testCodeContext
                : ""),
          },
        ],
      };
    }

    const report = await fetchSelfHealingReportByBuild(
      buildUuid!,
      effectiveConfig,
    );

    // Extract unique session IDs from the healing report and fetch test code
    const sessionIds = Array.from(
      new Set(
        (report.healing_logs ?? [])
          .map((log) => log.session_id)
          .filter(Boolean),
      ),
    );
    const testCodeResults =
      sessionIds.length > 0
        ? await fetchTestCodeForSessions(sessionIds, effectiveConfig)
        : [];
    const testCodeContext = formatTestCodeAsContext(testCodeResults);
    const banner = buildTestCodeFetchBanner(testCodeResults);

    return {
      content: [
        {
          type: "text",
          text:
            banner +
            "Self-healing report fetched successfully (buildUuid mode). " +
            "Work session-by-session: for each entry in `healing_logs[]`, " +
            "pass `healed_selectors[]` to `prepareSelfHealingPlan` so the " +
            "calling LLM can apply the edits with its own file-editing " +
            "tools (this server never writes files).\n" +
            JSON.stringify(report, null, 2) +
            (testCodeContext
              ? "\n\nThe following test code was found for sessions in this build. " +
                "Use it to understand the test intent, locate the exact files " +
                "containing the selectors, and make more accurate replacements:\n" +
                testCodeContext
              : ""),
        },
      ],
    };
  } catch (error) {
    logger.error("Error fetching self-heal selector suggestions", error);
    throw error;
  }
}

interface SessionLocator {
  original: { strategy: string; value: string };
  healed: { strategy: string; value: string };
  thought?: string;
}

interface SessionPayload {
  sessionId: string;
  sessionName?: string;
  locators: SessionLocator[];
}

interface PlanArgs extends CredsArgs {
  sessions: SessionPayload[];
}

interface PlannedLocator {
  original: { strategy: string; value: string };
  healed: { strategy: string; value: string };
  thought?: string;
}

interface PlannedSession {
  sessionId?: string;
  sessionName?: string;
  locators: PlannedLocator[];
  tests: TestCodeEntry[];
}

const PLAN_INSTRUCTIONS = [
  "## How to use this plan",
  "",
  "This tool does NOT modify any files. It returns the healed-locator plan",
  "and per-session test source code so that YOU (the calling LLM) can make",
  "surgical edits with your own file-editing tools.",
  "",
  "For each session in the plan:",
  "  1. Read each `tests[].code` to understand the test intent — especially",
  "     the step the healed locator belongs to.",
  "  2. Locate the exact call site(s) in the user's local project that",
  "     correspond to the original locator. Use `tests[].filename` as the",
  "     first place to look.",
  "  3. Edit ONLY the call sites that belong to this session's failing step.",
  "     A single id / class value may appear in many places; do NOT blindly",
  "     find/replace across the repo (e.g. two different elements both using",
  '     id="foo" must be resolved individually).',
  "  4. The healing report speaks in CSS/xpath, but the source often uses",
  "     `By.id(...)`, `By.name(...)`, `By.css(...)` wrappers. Translate as",
  "     needed — e.g. `*[id=\"email-field\"]` → `By.id('email-field')`, or",
  '     `input[id="user-email-input"]` → `By.css(\'input[id="user-email-input"]\')`.',
  "  5. Confirm ambiguous file paths with the user before editing.",
  "",
  "If `tests[]` is empty for a session, the BrowserStack API did not return",
  "test code (credentials missing, or the session has no associated test",
  "runs). Ask the user to point you at the right file before editing.",
].join("\n");

export async function prepareSelfHealingPlanTool(
  args: PlanArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const rawArgs = args as unknown as AnyRecord;

  // Normalize flexible input shapes so bare handler calls are just as lenient
  // as schema-validated MCP calls. The normalizer also looks inside alternate
  // top-level keys (e.g. the user pasted the whole args object into the
  // `sessions` field by accident).
  const sessionsRaw = firstDefined(
    args.sessions,
    rawArgs.healing_logs,
    rawArgs.sessionsList,
  );
  const normalized = normalizeSessionsInput(sessionsRaw);
  const sessions = (
    Array.isArray(normalized) ? normalized : []
  ) as SessionPayload[];
  if (sessions.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "No sessions provided. Pass `sessions: [{ sessionId, locators: " +
            "[{ original, healed, thought? }] }]` — typically copied from the " +
            "self-healing report returned by `fetchSelfHealedSelectors`.",
        },
      ],
    };
  }

  // Keep only locator pairs where both sides are non-empty and distinct; the
  // rest are surfaced as `skipped` so the caller can see what was ignored.
  const plannedSessions: PlannedSession[] = [];
  const skipped: Array<{ reason: string; sessionId?: string }> = [];
  for (const session of sessions) {
    const locators = Array.isArray(session?.locators) ? session.locators : [];
    const validLocators: PlannedLocator[] = [];
    for (const loc of locators) {
      const originalValue = loc?.original?.value?.trim?.();
      const healedValue = loc?.healed?.value?.trim?.();
      if (!originalValue || !healedValue) {
        skipped.push({
          reason: "missing original.value or healed.value",
          sessionId: session?.sessionId,
        });
        continue;
      }
      if (originalValue === healedValue) {
        skipped.push({
          reason: "original and healed values are identical",
          sessionId: session?.sessionId,
        });
        continue;
      }
      validLocators.push({
        original: {
          strategy: loc.original.strategy,
          value: loc.original.value,
        },
        healed: {
          strategy: loc.healed.strategy,
          value: loc.healed.value,
        },
        ...(loc.thought ? { thought: loc.thought } : {}),
      });
    }
    if (validLocators.length > 0) {
      plannedSessions.push({
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        locators: validLocators,
        tests: [],
      });
    }
  }

  if (plannedSessions.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "No applicable locator pairs found in the provided sessions. " +
            "Every entry was missing values or had identical original/healed " +
            "locators.\n" +
            JSON.stringify({ skipped }, null, 2),
        },
      ],
    };
  }

  // Try to enrich the plan with test code per session. Missing credentials
  // are not fatal — the plan is still useful to the caller.
  const resolved = resolveBrowserStackAuth(config, {
    username: args.username,
    accessKey: args.accessKey,
  });
  const sessionIds = plannedSessions
    .map((s) => trimOrUndefined(s?.sessionId))
    .filter((id): id is string => Boolean(id));

  let warningBanner = "";
  if (resolved && sessionIds.length > 0) {
    try {
      const testCodeResults = await fetchTestCodeForSessions(
        sessionIds,
        resolved.config,
      );
      const resultBySessionId = new Map(
        testCodeResults.map((t) => [t.sessionId, t]),
      );
      for (const session of plannedSessions) {
        if (session.sessionId && resultBySessionId.has(session.sessionId)) {
          session.tests = resultBySessionId.get(session.sessionId)?.tests ?? [];
        }
      }
      const problematic = testCodeResults.filter((t) => t.status !== "ok");
      if (problematic.length > 0) {
        warningBanner = buildWarningBanner(
          describeTestCodeFetchIssues(problematic),
        );
      }
    } catch (error) {
      logger.warn("Failed to fetch test code during plan preparation", error);
      warningBanner = buildWarningBanner(
        `### Transport error while fetching test code\n\nDiagnosis: ${
          error instanceof Error ? error.message : String(error)
        }. This is not an auth issue.\n\nSay this to the user: "I hit a transport error fetching test code from BrowserStack. Want me to retry, or would you rather share the local test file directly so I can apply the healed locators?"`,
      );
    }
  } else if (!resolved && sessionIds.length > 0) {
    warningBanner = buildWarningBanner(
      [
        "### BrowserStack credentials not provided",
        "",
        "Diagnosis: no credentials were available to fetch test code — the " +
          "plan was still generated from the locator pairs you sent.",
        "",
        "Say this to the user: \"I don't have BrowserStack credentials on " +
          "hand, so I couldn't pull the test source automatically. Want to " +
          "share a username + access key for me to retry, or would you " +
          'rather point me at the local test file directly?"',
      ].join("\n"),
    );
  }

  const skippedNote =
    skipped.length > 0
      ? `\n\n## Skipped locator pairs\n\n${JSON.stringify(skipped, null, 2)}`
      : "";

  return {
    content: [
      {
        type: "text",
        text:
          warningBanner +
          `${PLAN_INSTRUCTIONS}\n\n## Plan\n\n${JSON.stringify(plannedSessions, null, 2)}` +
          skippedNote,
      },
    ],
  };
}

// Registers the fetchSelfHealSelector tool with the MCP server
export default function addSelfHealTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchSelfHealedSelectors = server.tool(
    "fetchSelfHealedSelectors",
    "Fetch BrowserStack self-healed selectors plus the test source code for " +
      "the run. Provide exactly one of `sessionId` (single Automate / " +
      "App-Automate session) or `buildUuid` (full self-healing report for a " +
      "build). Pass the returned locator pairs to `prepareSelfHealingPlan` " +
      "to plan edits. `username`/`accessKey` are optional — forward them " +
      "when the user shares credentials in chat; otherwise the server " +
      "config is used.",
    {
      sessionId: z
        .string()
        .describe("Session ID. Mutually exclusive with buildUuid.")
        .optional(),
      sessionType: z
        .enum(["automate", "app-automate"])
        .describe("Used with sessionId. Defaults to automate.")
        .optional(),
      buildUuid: z
        .string()
        .describe("Build UUID. Fetches the build's self-healing report.")
        .optional(),
      username: z
        .string()
        .describe("Optional BrowserStack username override.")
        .optional(),
      accessKey: z
        .string()
        .describe("Optional BrowserStack access key override.")
        .optional(),
    },
    async (args) => {
      try {
        trackMCP(
          "fetchSelfHealedSelectors",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await fetchSelfHealSelectorTool(args, config);
      } catch (error) {
        trackMCP(
          "fetchSelfHealedSelectors",
          server.server.getClientVersion()!,
          error,
          config,
        );
        const context = args.sessionId
          ? `fetching self-heal selectors for sessionId=${args.sessionId}`
          : args.buildUuid
            ? `fetching self-healing report for buildUuid=${args.buildUuid}`
            : "fetching self-heal suggestions";
        return {
          content: [
            { type: "text", text: friendlyApiError(error, context) },
          ],
          isError: true,
        };
      }
    },
  );

  const locatorRefSchema = z.object({
    strategy: z
      .string()
      .describe("Locator strategy, e.g. 'css selector', 'xpath'."),
    value: z.string().describe("The locator string itself."),
  });
  const sessionLocatorSchema = z.object({
    original: locatorRefSchema,
    healed: locatorRefSchema,
    thought: z.string().optional(),
  });
  const sessionPayloadSchema = z.object({
    sessionId: z.string().describe("BrowserStack session ID."),
    sessionName: z.string().optional(),
    locators: z
      .array(sessionLocatorSchema)
      .min(1)
      .describe("Healed locator pairs for this session."),
  });

  // Flexible entry point for the `sessions` argument. See normalizers above
  // for the accepted alternate shapes.
  const sessionsFieldSchema = z.preprocess(
    normalizeSessionsInput,
    z.array(sessionPayloadSchema).min(1),
  );

  tools.prepareSelfHealingPlan = server.tool(
    "prepareSelfHealingPlan",
    "Build a self-healing edit plan that bundles locator pairs with test " +
      "source code for the calling LLM to apply with its own editing tools. " +
      "This tool does NOT modify files — it returns structured context so " +
      "the LLM can edit only the relevant call sites (avoids blind " +
      "find/replace across shared ids/classes). `sessions` accepts the " +
      "canonical shape `[{sessionId, locators: [{original, healed, " +
      "thought?}]}]`, a single session object, an envelope `{sessions: " +
      "[...]}`, the raw report `{healing_logs: [...]}` (with " +
      "`healed_selectors` aliasing `locators`), and snake_case keys " +
      "(`session_id`, `original_locator`, `healed_locator`, " +
      "`healing_thought`). `username`/`accessKey` are optional and only " +
      "used to enrich the plan with test code; missing credentials do not " +
      "block plan generation.",
    {
      sessions: sessionsFieldSchema.describe(
        "Sessions to plan edits for. See tool description for accepted shapes.",
      ),
      username: z
        .string()
        .describe("Optional BrowserStack username override.")
        .optional(),
      accessKey: z
        .string()
        .describe("Optional BrowserStack access key override.")
        .optional(),
    },
    async (args) => {
      try {
        trackMCP(
          "prepareSelfHealingPlan",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await prepareSelfHealingPlanTool(args, config);
      } catch (error) {
        trackMCP(
          "prepareSelfHealingPlan",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: friendlyApiError(error, "preparing self-healing plan"),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
