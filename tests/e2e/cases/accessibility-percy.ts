import type { HttpStub, ToolSpec } from "../harness/cases.js";
import { EU_HOST } from "../harness/cases.js";

/** Any Accessibility API host (US, EU, IN), so a stub serves the region case too. */
const A11Y = String.raw`https://api-accessibility(-eu|-in)?\.browserstack\.com`;
const a11y = (path: string) => new RegExp(`^${A11Y}${path}(\\?.*)?$`);
const SCANNER = "/api/website-scanner/v1";

/** The presigned CSV link the export API hands back. It is not a BrowserStack host. */
const CSV_LINK = "https://a11y-exports.s3.amazonaws.com/scan-77-run-88.csv";
const CSV_HOST = /^a11y-exports\.s3\.amazonaws\.com$/;

/** The Percy tools are served from US hosts only: an EU account gets this refusal. */
const US_ONLY_REGION = {
  hosts: [EU_HOST],
  expect: {
    isError: true,
    textMatches: [
      /Percy isn't available for your BrowserStack account's region/,
    ],
    noHttp: true,
    // The refusal makes no call, so there is no host to check.
    hosts: undefined,
  },
};

const NO_HTTP = "n/a: no HTTP call (instructions built from the arguments)";

/** Percy setup arguments. The two test files are not read: only their paths are used. */
const PERCY_SETUP_ARGS = {
  projectName: "shop-web",
  detectedLanguage: "nodejs",
  detectedBrowserAutomationFramework: "selenium",
  detectedTestingFramework: "mocha",
  integrationType: "web",
  filePaths: ["/repo/tests/home.spec.js", "/repo/tests/cart.spec.js"],
};

const CSV_REPORT = [
  "Issue type,Component,Issue description,HTML snippet,How to fix this issue,Severity,Affected page",
  'image-alt,img,Remote a11y issue 5e2,"<img src=""logo.png"">",Add an alt attribute,critical,https://example.com/',
].join("\n");

/** fetchAccessibilityIssues for a Website Scanner run: status, logs, export, CSV, score, memory. */
const FETCH_ISSUES_HTTP: HttpStub[] = [
  {
    method: "GET",
    url: a11y(`${SCANNER}/scans/77/scan_runs/88/status`),
    body: { success: true, data: { status: "completed" } },
  },
  {
    method: "GET",
    url: a11y(`${SCANNER}/scans/77/scan_runs/88/scan_logs`),
    body: { success: true, data: { scanLogs: [] } },
  },
  // MSW matches the path only, so the export start and its poll are a sequence.
  {
    method: "GET",
    url: a11y(`${SCANNER}/scans/77/scan_runs/issues`),
    body: { success: true, data: { task_id: "task-1" } },
    once: true,
  },
  {
    method: "GET",
    url: a11y(`${SCANNER}/scans/77/scan_runs/issues`),
    body: { success: true, data: { reportLink: CSV_LINK } },
  },
  { method: "GET", url: CSV_LINK, text: CSV_REPORT },
  {
    method: "GET",
    url: a11y(`${SCANNER}/scans/77/scan_runs/88`),
    body: { success: true, data: {} },
  },
  {
    method: "GET",
    url: a11y("/api/fp-memory/v1/memory"),
    body: { success: true, data: { rules: [], nextCursor: null } },
  },
];

/** fetchPercyChanges: project token, builds, changed build items, one snapshot's diff. */
const PERCY_CHANGES_HTTP: HttpStub[] = [
  {
    method: "GET",
    url: "https://api.browserstack.com/api/app_percy/get_project_token",
    body: { success: true, token: "percy-token-1" },
  },
  {
    method: "GET",
    url: "https://percy.io/api/v1/builds",
    body: {
      data: [
        {
          id: "b2",
          relationships: { browsers: { data: [{ id: "chrome-1" }] } },
        },
        { id: "b1" },
      ],
      included: [
        {
          type: "projects",
          relationships: { organization: { data: { id: "org-1" } } },
        },
      ],
    },
  },
  {
    method: "GET",
    url: "https://percy.io/api/v1/build-items",
    body: { data: [{ attributes: { "snapshot-ids": [55] } }] },
  },
  {
    method: "GET",
    url: "https://percy.io/api/v1/snapshots/55",
    body: {
      data: { attributes: { name: "Home page" } },
      included: [
        {
          type: "comparisons",
          attributes: {
            "applied-regions": [
              {
                id: 1,
                change_title: "Header moved",
                change_description: "Remote diff 9b3",
              },
            ],
          },
        },
      ],
    },
  },
];

/** L3 specs: Accessibility, Percy and SDK setup tools. */
export const accessibilityPercySpecs: ToolSpec[] = [
  {
    tool: "startAccessibilityScan",
    // A new scan or a re-run polls its status on a real 5 s interval (scanner.ts
    // waitUntilComplete), past the time one row may take. A re-run whose settings differ
    // from the saved ones stops before it starts a run: one read of the saved scan.
    args: {
      name: "Home",
      pageURL: "https://example.com/",
      scanId: "101",
      wcagVersion: "wcag22aa",
    },
    http: [
      {
        method: "GET",
        url: a11y(`${SCANNER}/scans/101/overview`),
        body: {
          success: true,
          data: {
            urlList: ["https://example.com/"],
            scanConfigInfo: {
              name: "Saved scan 4f2",
              wcagVersion: "wcag21aa",
              authEnabled: false,
              localTestingEnabled: false,
            },
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [
        /Scan 101 was not re-run/,
        /WCAG version: saved WCAG 2\.1 AA, passed WCAG 2\.2 AA/,
      ],
      untrusted: ["Saved scan 4f2"],
      calls: [{ method: "GET", url: a11y(`${SCANNER}/scans/101/overview`) }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "createAccessibilityAuthConfig",
    args: {
      name: "Login",
      type: "basic",
      url: "https://example.com/login",
      username: "site-user",
      password: "site-pass-61c",
    },
    http: [
      {
        method: "POST",
        url: a11y(`${SCANNER}/auth_configs`),
        body: {
          success: true,
          data: {
            id: 43,
            name: "Remote login 8a1",
            type: "basic",
            url: "https://example.com/login",
            username: "site-user",
            password: "site-pass-61c",
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Auth config "Login" created successfully with ID: 43/],
      // The site password never goes back to the client.
      textNotContains: ["site-pass-61c"],
      untrusted: ["Remote login 8a1"],
      calls: [{ method: "POST", url: a11y(`${SCANNER}/auth_configs`) }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "getAccessibilityAuthConfig",
    args: { configId: 42 },
    http: [
      {
        method: "GET",
        url: a11y(`${SCANNER}/auth_configs`),
        body: {
          success: true,
          data: {
            authConfigs: [
              {
                id: 42,
                name: "Remote login 8a1",
                type: "basic",
                type_identifier: "basic",
                authData: {
                  url: "https://example.com/login",
                  username: "site-user",
                  password: "site-pass-61c",
                },
              },
            ],
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Auth config retrieved successfully/],
      textNotContains: ["site-pass-61c"],
      untrusted: ["Remote login 8a1"],
      calls: [{ method: "GET", url: a11y(`${SCANNER}/auth_configs`) }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "fetchAccessibilityIssues",
    args: { scanId: "77", scanRunId: "88" },
    http: FETCH_ISSUES_HTTP,
    happy: {
      isError: false,
      textMatches: [/Retrieved 1 accessibility issues \(Total: 1\)/],
      untrusted: ["Remote a11y issue 5e2"],
      calls: [
        {
          method: "GET",
          url: new RegExp(
            `^${A11Y}${SCANNER}/scans/77/scan_runs/issues\\?scan_run_id=88$`,
          ),
        },
        { method: "GET", url: /^https:\/\/a11y-exports\.s3\.amazonaws\.com\// },
      ],
    },
    // The CSV link is the export API's presigned link, not a BrowserStack host.
    region: { hosts: [EU_HOST, CSV_HOST] },
  },
  // The Percy setup tools save the project and its test files in memory. listTestFiles and
  // addPercySnapshotCommands read them, so these specs stay in this order.
  {
    tool: "percyVisualTestIntegrationAgent",
    args: PERCY_SETUP_ARGS,
    http: [],
    happy: {
      isError: false,
      textMatches: [
        /@percy\/selenium-webdriver/,
        /Step-by-Step Percy Visual Change Simulation/,
      ],
      noHttp: true,
    },
    auth: NO_HTTP,
    serverError: NO_HTTP,
    region: US_ONLY_REGION,
  },
  {
    tool: "expandPercyVisualTesting",
    args: PERCY_SETUP_ARGS,
    http: [],
    happy: {
      isError: false,
      textMatches: [/@percy\/selenium-webdriver/, /Invoke listTestFiles\(\)/],
      noHttp: true,
    },
    auth: NO_HTTP,
    serverError: NO_HTTP,
    region: US_ONLY_REGION,
  },
  {
    tool: "listTestFiles",
    // Reads the files saved by expandPercyVisualTesting (the spec above).
    args: {},
    http: [],
    happy: {
      isError: false,
      textMatches: [/total number of tests files found is 2/],
      noHttp: true,
    },
    badInput: "n/a: takes no arguments",
    auth: "n/a: no HTTP call (lists the files saved in memory)",
    serverError: "n/a: no HTTP call (lists the files saved in memory)",
    region: US_ONLY_REGION,
  },
  {
    tool: "addPercySnapshotCommands",
    // Reads the files saved by listTestFiles (the spec above).
    args: { index: 0 },
    http: [],
    happy: {
      isError: false,
      textMatches: [/\/repo\/tests\/home\.spec\.js/],
      noHttp: true,
    },
    auth: NO_HTTP,
    serverError: NO_HTTP,
    region: US_ONLY_REGION,
  },
  {
    tool: "runPercyScan",
    args: {
      projectName: "other-project",
      integrationType: "web",
      percyRunCommand: "npx percy exec -- npm test",
    },
    http: [],
    happy: {
      isError: false,
      textMatches: [
        /Set the PERCY_TOKEN environment variable/,
        /npx percy exec -- npm test/,
      ],
      noHttp: true,
    },
    auth: NO_HTTP,
    serverError: NO_HTTP,
    region: US_ONLY_REGION,
    knownIssues: {
      happy:
        "percyRunCommand is dropped: run-percy-scan.ts reads args.instruction, which the schema does not have",
    },
  },
  {
    tool: "fetchPercyChanges",
    args: { project_name: "shop-web" },
    http: PERCY_CHANGES_HTTP,
    happy: {
      isError: false,
      textMatches: [/Percy AI visual-diff description/, /Header moved/],
      untrusted: ["Remote diff 9b3"],
      calls: [
        {
          method: "GET",
          url: /^https:\/\/api\.browserstack\.com\/api\/app_percy\/get_project_token\?name=shop-web&type=web$/,
        },
        { method: "GET", url: /^https:\/\/percy\.io\/api\/v1\/snapshots\/55$/ },
      ],
    },
    region: US_ONLY_REGION,
  },
  {
    tool: "managePercyBuildApproval",
    args: { buildId: "123", action: "approve" },
    http: [
      {
        method: "POST",
        url: "https://percy.io/api/v1/reviews",
        body: {
          data: {
            attributes: {
              "review-state": "approved",
              "action-performed-by": { user_name: "Remote user 3d8" },
            },
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Percy build 123 was approved/],
      calls: [
        { method: "POST", url: /^https:\/\/percy\.io\/api\/v1\/reviews$/ },
      ],
    },
    region: US_ONLY_REGION,
  },
  {
    tool: "setupBrowserStackAutomateTests",
    // With no devices, no device list is read. With devices, the list comes from an on-disk
    // cache first, so whether a call is made depends on the machine.
    args: {
      projectName: "shop-web",
      detectedLanguage: "nodejs",
      detectedBrowserAutomationFramework: "selenium",
      detectedTestingFramework: "mocha",
      devices: [],
    },
    http: [],
    happy: {
      isError: false,
      textMatches: [/browserstack-node-sdk/, /browserstack\.yml/],
      noHttp: true,
    },
    auth: NO_HTTP,
    serverError: NO_HTTP,
    region: NO_HTTP,
  },
];
