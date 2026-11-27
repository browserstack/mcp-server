import type { ToolSpec } from "../harness/cases.js";
import { EU_HOST } from "../harness/cases.js";

/** The four discovery tools read the bundled capability/*.json index only. */
const LOCAL_INDEX = "n/a: reads the local index, no HTTP call";

/**
 * devicecontrol `get_plan`: GET /automate/plan.json on its `api` host, HTTP Basic auth.
 * US: api.browserstack.com. EU: api-eu-only.browserstack.com (regional-host.ts automateApi).
 */
const AUTOMATE_API = String.raw`https://api(-eu-only)?\.browserstack\.com`;
const automateApi = (path: string) =>
  new RegExp(`^${AUTOMATE_API}${path}(\\?.*)?$`);

/** askBrowserStackAI defaults (ask-browserstack/config.ts); the harness clears the overrides. */
const ASK_TOKEN_URL = "https://auth.browserstack.com/oauth2/v2/token";
const ASK_AGENT_URL = "https://workflows.browserstack.com/agent";

/** L3 specs: Capability registry tools, askBrowserStackAI and submitFeedback. */
export const capabilityMiscSpecs: ToolSpec[] = [
  {
    tool: "listProducts",
    args: {},
    http: [],
    happy: {
      isError: false,
      textMatches: [/"name":"devicecontrol"/, /"title":"Test Management"/],
      noHttp: true,
    },
    auth: LOCAL_INDEX,
    serverError: LOCAL_INDEX,
    region: LOCAL_INDEX,
  },
  {
    tool: "describeEntity",
    args: { product: "devicecontrol", entity: "browser_session" },
    http: [],
    happy: {
      isError: false,
      textMatches: [/"product":"devicecontrol"/, /"entity":"browser_session"/],
      noHttp: true,
    },
    auth: LOCAL_INDEX,
    serverError: LOCAL_INDEX,
    region: LOCAL_INDEX,
  },
  {
    tool: "searchCapability",
    // A browse query ('*') skips the product-routing gate, so the row does not depend on it.
    args: { query: "*", product: "devicecontrol", entity: "plan" },
    http: [],
    happy: {
      isError: false,
      textMatches: [/"name":"get_plan"/],
      noHttp: true,
    },
    auth: LOCAL_INDEX,
    serverError: LOCAL_INDEX,
    region: LOCAL_INDEX,
  },
  {
    tool: "describeCapability",
    // `get_plan` is in devicecontrol and mobiledevicecontrol, so the product is needed.
    args: { name: "get_plan", product: "devicecontrol" },
    http: [],
    happy: {
      isError: false,
      textMatches: [/"product":"devicecontrol"/, /"name":"get_plan"/],
      noHttp: true,
    },
    auth: LOCAL_INDEX,
    serverError: LOCAL_INDEX,
    region: LOCAL_INDEX,
  },
  {
    tool: "invokeCapability",
    args: { name: "get_plan", product: "devicecontrol" },
    http: [
      {
        method: "GET",
        url: automateApi("/automate/plan.json"),
        body: { automate_plan: "Remote plan 9d2", parallel_sessions_max: 5 },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/"ok":true/, /"status":200/],
      untrusted: ["Remote plan 9d2"],
      calls: [{ method: "GET", url: automateApi("/automate/plan.json") }],
    },
    region: { hosts: [EU_HOST] },
    knownIssues: {
      auth: "upstream 401 returns ok:false without isError (register.ts invokeCapability)",
      "server-error":
        "upstream 500 returns ok:false without isError (register.ts invokeCapability)",
    },
  },
  {
    tool: "askBrowserStackAI",
    args: { product: "tm", query: "How many test cases are in project PR-1?" },
    http: [
      {
        method: "POST",
        url: ASK_TOKEN_URL,
        body: { access_token: "e2e-jwt", expires_in: 3600 },
      },
      {
        method: "POST",
        url: ASK_AGENT_URL,
        body: { ok: true, status: "ok", answer: "Remote answer 5e7" },
      },
    ],
    happy: {
      isError: false,
      // The answer is wrapped, then JSON-encoded into the result, so the marker newline
      // is the two characters "\n" and the harness `untrusted` check cannot see the block.
      textMatches: [
        /"status":"ok"/,
        /«UNTRUSTED BrowserStack AI answer [0-9a-f]{12}»\\nRemote answer 5e7\\n«END UNTRUSTED [0-9a-f]{12}»/,
      ],
      calls: [
        {
          method: "POST",
          url: /^https:\/\/workflows\.browserstack\.com\/agent$/,
        },
      ],
    },
    // US-only (server-factory.ts usOnly): an EU account is refused before any call.
    region: {
      hosts: [EU_HOST],
      expect: {
        isError: true,
        textMatches: [
          /BrowserStack AI isn't available for your BrowserStack account's region/,
        ],
        noHttp: true,
        hosts: undefined,
      },
    },
  },
  {
    tool: "submitFeedback",
    args: {
      message: "listTestCases returned no rows for a project with cases.",
      category: "tool_error",
      toolName: "listTestCases",
    },
    http: [],
    // Sent through trackMCP (instrumentation), which tools.e2e.test.ts mocks: no HTTP here.
    happy: {
      isError: false,
      textMatches: [/^Recorded\./],
      noHttp: true,
    },
    auth: "n/a: sends through trackMCP (mocked in L3), no HTTP call of its own",
    serverError:
      "n/a: sends through trackMCP (mocked in L3), no HTTP call of its own",
    // Listed at startup (no region scope yet); each EU call is refused (feedback-hint.ts).
    region: {
      hosts: [EU_HOST],
      expect: {
        isError: false,
        textMatches: [/Feedback can't be sent from this account/],
        noHttp: true,
        hosts: undefined,
      },
    },
  },
];
