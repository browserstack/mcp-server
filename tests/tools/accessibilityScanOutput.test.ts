import { beforeEach, describe, expect, it, vi } from "vitest";

// What startAccessibilityScan / fetchAccessibilityIssues tell the agent about the issue
// count: main issues only, matching the dashboard, with duplicates stated separately.

const m = vi.hoisted(() => ({
  startScan: vi.fn(),
  waitUntilComplete: vi.fn(),
  getReportLink: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("../../src/tools/accessiblity-utils/scanner.js", () => ({
  AccessibilityScanner: class {
    setAuth = vi.fn();
    startScan = m.startScan;
    waitUntilComplete = m.waitUntilComplete;
  },
}));
vi.mock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
  AccessibilityReportFetcher: class {
    setAuth = vi.fn();
    getReportLink = m.getReportLink;
  },
}));
vi.mock("../../src/tools/accessiblity-utils/report-parser.js", () => ({
  parseAccessibilityReportFromCSV: m.parse,
}));
vi.mock("../../src/lib/get-auth.js", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));

import addAccessibilityTools from "../../src/tools/accessibility.js";

const CONFIG = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

function register() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const server: any = {
    tool: vi.fn((...args: any[]) => {
      handlers[args[0]] = args[args.length - 1];
    }),
    server: {
      getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }),
      getClientCapabilities: vi.fn().mockReturnValue({}),
    },
  };
  addAccessibilityTools(server, CONFIG);
  return handlers;
}

const text = (result: any) =>
  result.content.map((c: { text: string }) => c.text).join("\n");

const CONTEXT = { sendNotification: vi.fn(), _meta: {} };

/** A grouped report: 79 main issues, 43 duplicates (all matched). */
const GROUPED = {
  records: [{ issue_type: "select-name", duplicate_count: 0 }],
  page_length: 1,
  total_issues: 79,
  next_page: 140,
  duplicate_issues: 43,
  unlinked_duplicates: 0,
};

describe("accessibility issue counts", () => {
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    m.startScan.mockResolvedValue({
      data: { id: "scan-42", scanRunId: "run-7" },
    });
    m.waitUntilComplete.mockResolvedValue("completed");
    m.getReportLink.mockResolvedValue("https://csv");
    handlers = register();
  });

  it("startAccessibilityScan reports main issues as the total and states the duplicates separately", async () => {
    m.parse.mockResolvedValue(GROUPED);
    const result = await handlers.startAccessibilityScan(
      { name: "dedupe", pageURL: "https://site.example" },
      CONTEXT,
    );

    expect(result.isError).toBeFalsy();
    const body = text(result);
    expect(body).toContain("We found 79 issues.");
    expect(body).toContain(
      "43 duplicate occurrences are folded into their main issue",
    );
    expect(body).not.toContain("could not be matched");
  });

  it("fetchAccessibilityIssues reports main issues as the total and names unmatched duplicates", async () => {
    m.parse.mockResolvedValue({ ...GROUPED, unlinked_duplicates: 2 });
    const result = await handlers.fetchAccessibilityIssues(
      { scanId: "scan-42", scanRunId: "run-7" },
      CONTEXT,
    );

    const body = text(result);
    expect(body).toContain("Retrieved 1 accessibility issues (Total: 79)");
    expect(body).toContain(
      "43 duplicate occurrences are folded into their main issue",
    );
    expect(body).toContain("2 of them could not be matched");
  });

  it("adds no duplicates note for a report without duplicates", async () => {
    m.parse.mockResolvedValue({
      ...GROUPED,
      duplicate_issues: null,
      next_page: null,
    });
    const result = await handlers.startAccessibilityScan(
      { name: "plain", pageURL: "https://site.example" },
      CONTEXT,
    );

    const body = text(result);
    expect(body).toContain("We found 79 issues.");
    expect(body).not.toContain("duplicate occurrences");
  });

  it("keeps the report link intact when a client joins the blocks with no separator", async () => {
    m.getReportLink.mockResolvedValue(
      "https://reports.example/r.csv?Signature=abc&Key-Pair-Id=K1",
    );
    m.parse.mockResolvedValue(GROUPED);
    const result = await handlers.startAccessibilityScan(
      { name: "joined", pageURL: "https://site.example" },
      CONTEXT,
    );

    const joined = result.content.map((c: { text: string }) => c.text).join("");
    expect(joined.match(/following link: (\S+)/)?.[1]).toBe(
      "https://reports.example/r.csv?Signature=abc&Key-Pair-Id=K1",
    );
    expect(joined).not.toMatch(/Scan Run ID: run-7\S/);
  });
});

describe("fetchAccessibilityIssues sources", () => {
  let handlers: Record<string, (...args: any[]) => any>;
  const BUILD_ID = "q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja";

  beforeEach(() => {
    vi.clearAllMocks();
    m.startScan.mockResolvedValue({
      data: { id: "scan-42", scanRunId: "run-7" },
    });
    m.waitUntilComplete.mockResolvedValue("completed");
    m.getReportLink.mockResolvedValue("https://csv");
    m.parse.mockResolvedValue(GROUPED);
    handlers = register();
  });

  it.each([
    [
      "a Website Scanner run",
      { scanId: "scan-42", scanRunId: "run-7" },
      { kind: "scan", scanId: "scan-42", scanRunId: "run-7" },
      'scanId: "scan-42", scanRunId: "run-7"',
    ],
    [
      "an Automated Tests build",
      { buildId: BUILD_ID },
      { kind: "build", buildId: BUILD_ID },
      `buildId: "${BUILD_ID}"`,
    ],
    [
      "a Workflow Analyzer report",
      { workflowReportId: "123456" },
      { kind: "workflow", reportId: "123456" },
      'workflowReportId: "123456"',
    ],
  ])(
    "reads the issues of %s and names it again for the next page",
    async (_label, args, source, nextPageArgs) => {
      const result = await handlers.fetchAccessibilityIssues(args, CONTEXT);

      expect(result.isError).toBeFalsy();
      expect(m.getReportLink).toHaveBeenCalledWith(source);
      const body = text(result);
      expect(body).toContain("Retrieved 1 accessibility issues (Total: 79)");
      expect(body).toContain(
        `Use fetchAccessibilityIssues with ${nextPageArgs} and cursor: 140`,
      );
    },
  );

  it("startAccessibilityScan reads the run it just started", async () => {
    await handlers.startAccessibilityScan(
      { name: "run", pageURL: "https://site.example" },
      CONTEXT,
    );
    expect(m.getReportLink).toHaveBeenCalledWith({
      kind: "scan",
      scanId: "scan-42",
      scanRunId: "run-7",
    });
  });

  it.each([
    ["no source", {}, /exactly one/],
    [
      "two sources",
      { scanId: "scan-42", scanRunId: "run-7", buildId: BUILD_ID },
      /exactly one/,
    ],
    ["a scan without its run", { scanId: "scan-42" }, /scanRunId/],
  ])("refuses %s without calling the API", async (_label, args, message) => {
    const result = await handlers.fetchAccessibilityIssues(args, CONTEXT);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(message);
    expect(m.getReportLink).not.toHaveBeenCalled();
  });
});
