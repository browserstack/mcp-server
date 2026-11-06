import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchAccessibilityIssues and the account's false-positive memory: the memory is read for
// the rules of every issue in the report, the issues it certainly covers are left out of
// the answer and said to be, and the rest of the memory comes with the issues that remain.

const m = vi.hoisted(() => ({
  getReportLink: vi.fn(),
  parse: vi.fn(),
  memoryForReport: vi.fn(),
}));

vi.mock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
  AccessibilityReportFetcher: class {
    setAuth = vi.fn();
    getReportLink = m.getReportLink;
    reportStatus = vi.fn().mockResolvedValue("completed");
    resolveBuild = vi.fn(async (source: unknown) => source);
  },
  EXPORT_WAIT_MS: 45_000,
  ExportPendingError: class extends Error {},
}));
vi.mock("../../src/tools/accessiblity-utils/report-parser.js", () => ({
  parseAccessibilityReportFromCSV: m.parse,
  loadMainIssues: vi.fn(),
  compareIssues: vi.fn(),
}));
vi.mock(
  "../../src/tools/accessiblity-utils/fp-memory.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    memoryForReport: m.memoryForReport,
  }),
);
vi.mock("../../src/lib/get-auth.js", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/index.js", () => ({
  trackMCP: vi.fn(),
  PackageJsonVersion: "0.0.0",
}));

import addAccessibilityTools from "../../src/tools/accessibility.js";
import { FP_APPLY_NOTE } from "../../src/tools/accessiblity-utils/fp-memory.js";

function fetchIssues() {
  let handler: (...args: any[]) => any = () => undefined;
  const server: any = {
    tool: vi.fn((...args: any[]) => {
      if (args[0] === "fetchAccessibilityIssues")
        handler = args[args.length - 1];
    }),
    server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
  };
  addAccessibilityTools(server, {
    "browserstack-username": "fake-user",
    "browserstack-access-key": "fake-key",
  } as any);
  return (args: Record<string, unknown>) =>
    handler(args, { sendNotification: vi.fn(), _meta: {} });
}

const text = (result: any) =>
  result.content.map((c: { text: string }) => c.text).join("\n");

const PAGE = "https://www.sbb.ch/de/angebote/halbtax";
const issue = (issue_type: string, HTML_snippet: string) => ({
  issue_type,
  HTML_snippet,
  affected_page: PAGE,
  component: "sbb#",
  severity: "serious",
});
const ISSUES = [
  issue("role-required", '<sbb-button tabindex="0">'),
  issue("role-required", '<sbb-breadcrumb slot="li-3">'),
  issue("image-alt", '<img alt=" " src="/a.jpg">'),
];

const SBB_MEMORY = {
  truncated: false,
  rules: [
    {
      ruleCode: "role-required",
      docsUrl: "https://www.browserstack.com/docs/role-required/",
      entryCount: 1,
      entries: [
        {
          id: 3,
          site: "www.sbb.ch",
          global: false,
          verdict: "false_positive",
          matchScope: "component_family",
          rootCause:
            "SBB Lyne components set their role through ElementInternals, not a role attribute.",
          pattern: {
            predicate:
              "Custom elements with tag prefix 'sbb-'. Does not cover sbb-breadcrumb.",
            tagPrefix: "sbb-",
          },
          userStatement: "this sbb component is a false positive",
        },
      ],
    },
  ],
};

/** The parser as the handler drives it: asks what to leave out of every issue read. */
function parseLeavingOut() {
  m.parse.mockImplementation(
    async (
      _link: string,
      { leaveOut }: { leaveOut: (i: unknown[]) => Promise<Set<unknown>> },
    ) => {
      const leftOut = await leaveOut(ISSUES);
      const records = ISSUES.filter((i) => !leftOut.has(i));
      return {
        records,
        rules: Object.fromEntries(
          records.map((r) => [
            r.issue_type,
            { description: r.issue_type, how_to_fix: "fix" },
          ]),
        ),
        page_length: records.length,
        total_issues: records.length,
        next_page: null,
        remaining: 0,
        duplicate_issues: null,
        unlinked_duplicates: 0,
        hidden_issues: null,
      };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getReportLink.mockResolvedValue("https://csv");
  parseLeavingOut();
});

describe("fetchAccessibilityIssues with a false-positive memory", () => {
  it("reads the memory for every rule in the report and leaves out what it certainly covers", async () => {
    m.memoryForReport.mockResolvedValue(SBB_MEMORY);

    const answer = text(
      await fetchIssues()({ scanId: "4304785", scanRunId: "2425482" }),
    );

    expect(m.memoryForReport).toHaveBeenCalledWith(
      { username: "fake-user", password: "fake-key" },
      ["role-required", "image-alt"],
    );
    expect(answer).toContain("left out 1 issue the account's saved");
    expect(answer).toContain('"entry":3');
    const issues = answer.slice(answer.indexOf("Issues:"));
    expect(issues).not.toContain("<sbb-button");
    // Excluded by the entry, so it stays for the agent, with the memory to judge it by.
    expect(issues).toContain("<sbb-breadcrumb");
    expect(answer).toContain(FP_APPLY_NOTE);
  });

  it("answers as before when the account has no memory", async () => {
    m.memoryForReport.mockResolvedValue(undefined);

    const answer = text(
      await fetchIssues()({ scanId: "4304785", scanRunId: "2425482" }),
    );

    expect(answer).not.toMatch(/False-positive memory/);
    expect(answer).toContain("<sbb-button");
  });
});
