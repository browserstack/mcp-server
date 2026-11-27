import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolSpec } from "../harness/cases.js";
import { EU_HOST } from "../harness/cases.js";
import { L3_UPLOAD_DIR } from "../harness/server.js";

/** Any host of a kind (US, EU, IN), so one stub serves the region case too. */
const host = (re: string) => (path: string) =>
  new RegExp(`^${re}${path}(\\?.*)?$`);
/** Automate / App Automate REST: api, api-eu-only, api-aps-only. */
const api = host(
  String.raw`https://api(-eu-only|-aps-only)?\.browserstack\.com`,
);
/** App Automate uploads and builds: api-cloud (US), api-eu-only, api-aps-only. */
const cloud = host(
  String.raw`https://api(-cloud|-eu-only|-aps-only)\.browserstack\.com`,
);
/** Test Reporting & Analytics (automationApi). */
const automation = host(
  String.raw`https://api-automation(-eu|-in)?\.browserstack\.com`,
);
/** Observability API (RCA). */
const o11y = host(
  String.raw`https://api-observability(-eu|-in)?\.browserstack\.com`,
);

/**
 * The public device lists (src/lib/device-cache.ts). One host for every region, no auth.
 * The cache lives in L3_HOME and keeps a product's list for the rest of the run, so only
 * the first row that needs a product fetches it. No row asserts this call.
 */
const deviceList = (product: string) => ({
  method: "GET" as const,
  url: `https://www.browserstack.com/list-of-browsers-and-platforms/${product}.json`,
});
const WWW_HOST = /^www\.browserstack\.com$/;

const LIVE_DEVICES = {
  ...deviceList("live"),
  body: {
    desktop: [
      {
        os: "Windows",
        os_version: "11",
        browsers: [
          { browser: "chrome", browser_version: "125.0" },
          { browser: "chrome", browser_version: "126.0" },
        ],
      },
    ],
    mobile: [],
  },
};
const APP_LIVE_DEVICES = {
  ...deviceList("app_live"),
  body: {
    mobile: [
      {
        os: "android",
        devices: [
          {
            device: "Google Pixel 8",
            display_name: "Google Pixel 8",
            os_version: "14.0",
          },
        ],
      },
    ],
  },
};
const APP_AUTOMATE_DEVICES = {
  ...deviceList("app_automate"),
  body: {
    mobile: [
      {
        os: "android",
        devices: [
          {
            device: "Google Pixel 8",
            display_name: "Google Pixel 8",
            os_version: "14.0",
            real_mobile: true,
          },
          {
            device: "Samsung Galaxy S24",
            display_name: "Samsung Galaxy S24",
            os_version: "14.0",
            real_mobile: true,
          },
        ],
      },
    ],
  },
};

/** Files the upload tools send. MCP_UPLOAD_BASE_DIR is L3_UPLOAD_DIR in every profile. */
const upload = (name: string) => {
  const path = join(L3_UPLOAD_DIR, name);
  writeFileSync(path, "l3 fake binary");
  return path;
};
const APP_APK = upload("app.apk");
const SUITE_APK = upload("suite.apk");

const HASHED_BUILD = "a".repeat(40);
const TRA_BUILD = "tra9build7x";
const SESSION = "sess1e2e";

/** Screenshot assets come from the URL in the session log, not from a region host. */
const SHOT_URL = "https://bs-shots-7f1.s3.amazonaws.com/shot-1.png";
const S3_HOST = /\.s3\.amazonaws\.com$/;

/**
 * runBrowserLiveSession's only HTTP call is the public device list. The happy row caches
 * it, so later rows make no call at all: a 401/500 cannot reach the tool, and no call
 * goes to a regional host.
 */
const LIVE_ONLY_PUBLIC =
  "n/a: the only HTTP call is the public, unauthenticated device list, which the happy row caches for the run";

/**
 * webdriverio's remote() sends WebDriver calls through undici's own fetch
 * (node_modules/webdriver/build/node.js), which MSW does not intercept: a trial run reached
 * the real hub.browserstack.com. So no row may get past the upload.
 */
const WEBDRIVER_NETWORK =
  "n/a: webdriverio calls the hub through undici's own fetch, which MSW does not intercept (a trial run reached the real hub)";

export const automateLiveSpecs: ToolSpec[] = [
  // ——— Live / App Live ———
  {
    tool: "runBrowserLiveSession",
    args: {
      platformType: "desktop",
      desiredURL: "https://example.com",
      desiredOS: "Windows",
      desiredOSVersion: "11",
      desiredBrowser: "chrome",
      desiredBrowserVersion: "latest",
    },
    http: [LIVE_DEVICES],
    // No remote free text: the result is a URL built from the device list.
    happy: {
      isError: false,
      textMatches: [
        /https:\/\/live\.browserstack\.com\/dashboard#.*browser_version=126\.0/,
      ],
    },
    auth: LIVE_ONLY_PUBLIC,
    serverError: LIVE_ONLY_PUBLIC,
    region: LIVE_ONLY_PUBLIC,
  },
  {
    tool: "runAppLiveSession",
    // appPath, not browserstackAppUrl: the upload is the authenticated call, and it runs
    // even when the device list is cached.
    args: {
      desiredPhone: "Google Pixel 8",
      desiredPlatformVersion: "latest",
      desiredPlatform: "android",
      appPath: APP_APK,
    },
    http: [
      APP_LIVE_DEVICES,
      {
        method: "POST",
        url: cloud("/app-live/upload"),
        body: { app_url: "bs://applive5d3" },
      },
    ],
    // No remote free text: the result is a URL built from the device and app_url.
    happy: {
      isError: false,
      textMatches: [
        /https:\/\/app-live\.browserstack\.com\/dashboard#.*app_hashed_id=applive5d3/,
      ],
      calls: [{ method: "POST", url: cloud("/app-live/upload") }],
    },
    region: { hosts: [EU_HOST, WWW_HOST] },
    knownIssues: {
      region:
        "the App Live upload URL is fixed to api-cloud.browserstack.com (applive-utils/upload-app.ts)",
    },
  },

  // ——— App Automate ———
  {
    tool: "takeAppScreenshot",
    args: {
      desiredPhone: "Google Pixel 8",
      desiredPlatformVersion: "latest",
      desiredPlatform: "android",
      appPath: APP_APK,
    },
    http: [
      APP_AUTOMATE_DEVICES,
      {
        method: "POST",
        url: cloud("/app-automate/upload"),
        body: { app_url: "bs://shotapp2a7" },
      },
    ],
    // auth and server-error stop at the device list or the upload, before WebDriver.
    happy: WEBDRIVER_NETWORK,
    region: WEBDRIVER_NETWORK,
  },
  {
    tool: "runAppTestsOnBrowserStack",
    // devices: [] uses the default device and does not read the device list.
    args: {
      appPath: APP_APK,
      testSuitePath: SUITE_APK,
      devices: [],
      detectedAutomationFramework: "espresso",
    },
    http: [
      {
        method: "POST",
        url: cloud("/app-automate/espresso/v2/app"),
        body: { app_url: "bs://espapp1b2" },
      },
      {
        method: "POST",
        url: cloud("/app-automate/espresso/v2/test-suite"),
        body: { test_suite_url: "bs://espsuite3c4" },
      },
      {
        method: "POST",
        url: cloud("/app-automate/espresso/v2/build"),
        body: { build_id: "espbuild5d6" },
      },
    ],
    // No remote free text: only the build id.
    happy: {
      isError: false,
      textMatches: [/Espresso run started successfully/, /espbuild5d6/],
      calls: [
        { method: "POST", url: cloud("/app-automate/espresso/v2/app") },
        { method: "POST", url: cloud("/app-automate/espresso/v2/test-suite") },
        { method: "POST", url: cloud("/app-automate/espresso/v2/build") },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "setupBrowserStackAppAutomateTests",
    // webdriverio uploads appPath (appium-sdk/utils.ts getAppUploadInstruction), so the
    // authenticated call runs even when the device list is cached.
    args: {
      detectedFramework: "appium",
      detectedTestingFramework: "webdriverio",
      detectedLanguage: "nodejs",
      appPath: APP_APK,
    },
    http: [
      APP_AUTOMATE_DEVICES,
      {
        method: "POST",
        url: cloud("/app-automate/upload"),
        body: { app_url: "bs://setupapp3c1" },
      },
    ],
    // No remote free text: only the app_url.
    happy: {
      isError: false,
      textMatches: [/\*\*Step 1:\*\*/, /bs:\/\/setupapp3c1/],
      calls: [{ method: "POST", url: cloud("/app-automate/upload") }],
    },
    region: { hosts: [EU_HOST, WWW_HOST] },
  },

  // ——— Automate sessions ———
  {
    tool: "getFailureLogs",
    args: {
      sessionType: "automate",
      sessionId: SESSION,
      logTypes: ["sessionLogs"],
    },
    http: [
      {
        method: "GET",
        url: api(`/automate/sessions/${SESSION}/logs`),
        text: [
          "2024-05-01 10:00:00:100 REQUEST [x] POST /session/s1/element",
          '2024-05-01 10:00:00:200 RESPONSE {"error":"remote failure 6d0 element not found"}',
          "2024-05-01 10:00:00:300 DEBUG all good",
        ].join("\n"),
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Session Failures \(1 found\)/],
      untrusted: ["remote failure 6d0"],
      calls: [
        { method: "GET", url: api(`/automate/sessions/${SESSION}/logs`) },
      ],
    },
    region: { hosts: [EU_HOST] },
    knownIssues: {
      auth: "401 returns 'please check your credentials' with isError false (failurelogs-utils/utils.ts validateLogResponse)",
      "server-error":
        "500 returns 'Unable to fetch session logs at this time' with isError false (failurelogs-utils/utils.ts validateLogResponse)",
    },
  },
  {
    tool: "fetchAutomationScreenshots",
    args: { sessionId: SESSION, sessionType: "automate" },
    http: [
      {
        method: "GET",
        url: api(`/automate/sessions/${SESSION}/logs`),
        text: `2024-05-01 10:00:00:100 DEBUG ${SHOT_URL}`,
      },
      { method: "GET", url: SHOT_URL, text: "PNG-BYTES" },
    ],
    // Screenshots come back as images; no remote text is returned.
    happy: {
      isError: false,
      textMatches: [/Retrieved 1 screenshot\(s\)/],
      calls: [
        { method: "GET", url: api(`/automate/sessions/${SESSION}/logs`) },
        { method: "GET", url: /^https:\/\/bs-shots-7f1\.s3\.amazonaws\.com\// },
      ],
    },
    region: { hosts: [EU_HOST, S3_HOST] },
  },
  {
    tool: "listSessions",
    args: { sessionType: "automate", buildId: HASHED_BUILD },
    http: [
      {
        method: "GET",
        url: api(`/automate/builds/${HASHED_BUILD}/sessions.json`),
        body: [
          {
            automation_session: {
              hashed_id: "s1hash",
              name: "Remote session 5e1",
              status: "failed",
              os: "Windows",
              os_version: "11",
              browser: "chrome",
            },
          },
        ],
      },
    ],
    happy: {
      isError: false,
      textMatches: [/s1hash/],
      untrusted: ["Remote session 5e1"],
      calls: [
        {
          method: "GET",
          url: api(`/automate/builds/${HASHED_BUILD}/sessions.json`),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },

  // ——— Self-heal ———
  {
    tool: "fetchSelfHealedSelectors",
    args: { sessionId: SESSION },
    http: [
      {
        method: "GET",
        url: api(`/automate/sessions/${SESSION}/logs`),
        text: [
          '2024-05-01 10:00:00:100 REQUEST [x] POST /session/s1/element {"using":"css selector","value":"#old-btn"}',
          '2024-05-01 10:00:00:200 SELFHEAL {"status":"true","data":{"using":"css selector","value":"#healed-btn-7d2"}}',
        ].join("\n"),
      },
      {
        method: "GET",
        url: automation(`/ext/v1/sessions/${SESSION}/testCode`),
        body: {
          sessionId: SESSION,
          tests: [
            {
              testRunId: 1,
              code: "driver.find('#old-btn') // remote code 3a9",
              filename: "login.spec.js",
              url: null,
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Self-heal selectors fetched successfully/],
      untrusted: ["#healed-btn-7d2", "remote code 3a9"],
      calls: [
        { method: "GET", url: api(`/automate/sessions/${SESSION}/logs`) },
        {
          method: "GET",
          url: automation(`/ext/v1/sessions/${SESSION}/testCode`),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "prepareSelfHealingPlan",
    args: {
      sessions: [
        {
          sessionId: SESSION,
          locators: [
            {
              original: { strategy: "css selector", value: "#old-btn" },
              healed: { strategy: "css selector", value: "#new-btn-8c4" },
            },
          ],
        },
      ],
    },
    http: [
      {
        method: "GET",
        url: automation(`/ext/v1/sessions/${SESSION}/testCode`),
        body: {
          sessionId: SESSION,
          tests: [
            {
              testRunId: 1,
              code: "driver.find('#old-btn') // remote plan code 1f5",
              filename: "login.spec.js",
              url: null,
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/## Plan/],
      untrusted: ["remote plan code 1f5", "#new-btn-8c4"],
      calls: [
        {
          method: "GET",
          url: automation(`/ext/v1/sessions/${SESSION}/testCode`),
        },
      ],
    },
    // An upstream 401/500 must be an error (decision: same rule as every other tool).
    // Today the tool returns isError false with a warning banner (selfheal.ts).
    auth: {
      expect: { isError: true, textMatches: [/Unauthorized \(HTTP 401\)/] },
    },
    serverError: {
      expect: { isError: true, textMatches: [/Transport error/] },
    },
    knownIssues: {
      auth: "isError false on an upstream 401 (plan returned with a banner)",
      "server-error":
        "isError false on an upstream 500 (plan returned with a banner)",
    },
    region: { hosts: [EU_HOST] },
  },

  // ——— Test Reporting & Analytics / RCA ———
  {
    tool: "fetchBuildInsights",
    args: { buildId: TRA_BUILD },
    http: [
      {
        method: "GET",
        url: automation(`/ext/v1/builds/${TRA_BUILD}`),
        body: {
          name: "Remote build 9f3",
          status: "failed",
          hashed_id: HASHED_BUILD,
          status_stats: { passed: 3, failed: 1 },
        },
      },
      {
        method: "GET",
        url: automation(`/ext/v1/quality-gates/${TRA_BUILD}`),
        body: {
          quality_gate_result: "failed",
          quality_profiles: [{ name: "Remote profile 0c2", result: "failed" }],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Build insights:/],
      untrusted: ["Remote build 9f3", "Remote profile 0c2"],
      calls: [
        { method: "GET", url: automation(`/ext/v1/builds/${TRA_BUILD}`) },
        {
          method: "GET",
          url: automation(`/ext/v1/quality-gates/${TRA_BUILD}`),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "fetchRCA",
    args: { testId: [101] },
    http: [
      {
        method: "GET",
        url: o11y("/ext/v1/testRun/101/testRca"),
        body: {
          state: "completed",
          rcaData: {
            root_cause: "Remote root cause 2b8",
            failure_type: "assertion",
            description: "Remote analysis 4e7",
            possible_fix: "Remote fix 6a1",
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Root Cause Analysis Report/],
      untrusted: [
        "Remote root cause 2b8",
        "Remote analysis 4e7",
        "Remote fix 6a1",
      ],
      calls: [{ method: "GET", url: o11y("/ext/v1/testRun/101/testRca") }],
    },
    region: { hosts: [EU_HOST] },
    knownIssues: {
      auth: "a 401 becomes an RCA report row 'HTTP 401: Failed to start RCA analysis' with isError false (rca-agent-utils/rca-data.ts fetchInitialRCA)",
      "server-error":
        "a 500 becomes an RCA report row with isError false (rca-agent-utils/rca-data.ts fetchInitialRCA)",
    },
  },
  {
    tool: "getBuildId",
    args: { browserStackProjectName: "Proj", browserStackBuildName: "Nightly" },
    http: [
      {
        method: "GET",
        url: automation("/ext/v1/builds/latest"),
        body: { build_id: "trab1d9x" },
      },
    ],
    // The tool returns only the build id, not wrapped (an id, not free text).
    happy: {
      isError: false,
      textMatches: [/trab1d9x/],
      calls: [
        {
          method: "GET",
          url: /\/ext\/v1\/builds\/latest\?.*user_name=e2e-user/,
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "listBuildId",
    args: { browserStackProjectName: "Proj", browserStackBuildName: "Nightly" },
    http: [
      {
        method: "GET",
        url: automation("/ext/v1/builds/latest"),
        body: { build_id: "trab2c4y" },
      },
    ],
    // The tool returns only the build id, not wrapped (an id, not free text).
    happy: {
      isError: false,
      textMatches: [/trab2c4y/],
      calls: [
        {
          method: "GET",
          url: /\/ext\/v1\/builds\/latest\?project_name=Proj&build_name=Nightly$/,
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "listTestIds",
    args: { buildId: TRA_BUILD },
    http: [
      {
        method: "GET",
        url: automation(`/ext/v1/builds/${TRA_BUILD}/testRuns`),
        body: {
          hierarchy: [
            {
              display_name: "Remote test name 4b2",
              details: {
                status: "failed",
                observability_url:
                  "https://observability.browserstack.com/builds/x?details=777",
                session_id: "s1hash",
              },
            },
          ],
          pagination: { has_next: false },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/"test_id": "777"/],
      untrusted: ["Remote test name 4b2"],
      calls: [
        {
          method: "GET",
          url: automation(`/ext/v1/builds/${TRA_BUILD}/testRuns`),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
];
