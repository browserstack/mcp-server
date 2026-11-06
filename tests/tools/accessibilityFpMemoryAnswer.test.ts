import { beforeEach, describe, expect, it, vi } from "vitest";

// An agent asked to "fetch the issues from this report" was handed the saved false
// positives as one note among many, and reported the report's own list and totals without
// removing them. What has to hold: when saved entries cover issues in the answer, the
// answer opens by saying to remove them before giving any list or count, marks each issue
// they may cover, labels its totals as before that removal, and closes by saying how to
// report what is left. Without saved entries, the answer is what it always was.

const m = vi.hoisted(() => ({
  parse: vi.fn(),
  memoryForReport: vi.fn(),
}));

vi.mock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
  AccessibilityReportFetcher: class {
    setAuth = vi.fn();
    getReportLink = vi.fn(async () => "https://exports.example/report.csv");
    reportStatus = vi.fn(async () => "completed");
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

const texts = (result: any): string[] =>
  result.content.map((c: { text: string }) => c.text);

const PAGE = "https://www.shop.example/checkout";
const issue = (issue_type: string, component: string) => ({
  issue_type,
  component,
  HTML_snippet: `<${component.replace("#", "")}>`,
  severity: "serious",
  affected_page: PAGE,
});

const REPORT = {
  records: [
    issue("role-required", "acme-header-button#"),
    issue("role-required", "acme-menu-trigger#"),
    issue("image-alt", "img#"),
  ],
  rules: {
    "role-required": { description: "Interactive elements need a role" },
    "image-alt": { description: "Images need alt text" },
  },
  summary: {
    by_severity: { serious: 3 },
    by_rule: [
      { issue_type: "role-required", count: 2 },
      { issue_type: "image-alt", count: 1 },
    ],
    needs_review: 0,
    best_practice: 0,
  },
  page_length: 3,
  total_issues: 3,
  next_page: null,
  remaining: 0,
  duplicate_issues: null,
  unlinked_duplicates: 0,
  hidden_issues: null,
};

const MEMORY = {
  truncated: false,
  rules: [
    {
      ruleCode: "role-required",
      docsUrl:
        "https://www.browserstack.com/docs/accessibility/rules/a11y-engine/role-required/",
      entryCount: 1,
      entries: [
        {
          id: 41,
          site: "www.shop.example",
          global: false,
          verdict: "false_positive",
          matchScope: "component_family",
          rootCause:
            "Role is set inside each acme- custom element's shadow root; the host has none.",
          pattern: {
            tagPrefix: "acme-",
            predicate: "acme- custom elements rendering a native control",
          },
          userStatement: "Those Acme buttons work fine with a screen reader",
        },
      ],
    },
  ],
};

const RUN = { scanId: "7310042", scanRunId: "5520318" };

beforeEach(() => {
  vi.clearAllMocks();
  m.parse.mockResolvedValue(structuredClone(REPORT));
});

describe("fetchAccessibilityIssues with saved false positives", () => {
  it("opens by saying to remove them before giving any list or count", async () => {
    m.memoryForReport.mockResolvedValue(MEMORY);

    const lines = texts(await fetchIssues()(RUN));

    expect(lines[0]).toMatch(/Saved false positives apply to this report/);
    expect(lines[0]).toContain("2 of the 3 issues below");
    expect(lines[0]).toMatch(/Before you give the user any list, count/);
    const firstCount = lines.findIndex((l) => l.startsWith("Retrieved"));
    expect(firstCount).toBeGreaterThan(0);
    expect(lines[firstCount]).toContain(
      "Total: 3, before removing saved false positives",
    );
  });

  it("asks only for the rules of the issues it answers with", async () => {
    m.memoryForReport.mockResolvedValue(MEMORY);

    await fetchIssues()(RUN);

    expect(m.memoryForReport.mock.calls[0][1]).toEqual([
      "role-required",
      "image-alt",
    ]);
  });

  it("marks the issues the entries may cover, and only those", async () => {
    m.memoryForReport.mockResolvedValue(MEMORY);

    const block = texts(await fetchIssues()(RUN)).find((l) =>
      l.startsWith("Issues:"),
    )!;
    const issues = JSON.parse(block.split("\n")[2]).issues;

    expect(issues.map((i: any) => i.saved_fp_entries)).toEqual([
      [41],
      [41],
      undefined,
    ]);
  });

  it("gives the memory before the issues and how to report what is left after them", async () => {
    m.memoryForReport.mockResolvedValue(MEMORY);

    const lines = texts(await fetchIssues()(RUN));
    const memoryAt = lines.findIndex((l) =>
      l.startsWith("False-positive memory:"),
    );
    const issuesAt = lines.findIndex((l) => l.startsWith("Issues:"));
    const closingAt = lines.findIndex((l) =>
      l.includes("list only the issues left"),
    );

    expect(memoryAt).toBeGreaterThan(-1);
    expect(memoryAt).toBeLessThan(issuesAt);
    expect(closingAt).toBeGreaterThan(issuesAt);
  });

  it("answers as it always did when no saved entry covers these issues", async () => {
    m.memoryForReport.mockResolvedValue({
      truncated: false,
      rules: [
        {
          ...MEMORY.rules[0],
          entries: [
            { ...MEMORY.rules[0].entries[0], site: "elsewhere.example" },
          ],
        },
      ],
    });

    const lines = texts(await fetchIssues()(RUN));

    expect(lines[0]).not.toMatch(/Saved false positives/);
    expect(lines.join("\n")).not.toContain("saved_fp_entries");
    expect(lines.join("\n")).toContain("Total: 3)");
  });

  it("answers as it always did when the account has no memory", async () => {
    m.memoryForReport.mockResolvedValue(undefined);

    const lines = texts(await fetchIssues()(RUN));

    expect(lines.join("\n")).not.toMatch(/false positive/i);
    expect(lines.join("\n")).toContain("Total: 3)");
  });
});
