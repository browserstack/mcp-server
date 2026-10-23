import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What startAccessibilityScan / fetchAccessibilityIssues tell the agent about the issue
// count: main issues only, matching the dashboard, with duplicates stated separately.

const m = vi.hoisted(() => ({
  startScan: vi.fn(),
  waitUntilComplete: vi.fn(),
  getReportLink: vi.fn(),
  sourceFromReportUrl: vi.fn(),
  reportStatus: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("../../src/tools/accessiblity-utils/scanner.js", () => ({
  AccessibilityScanner: class {
    setAuth = vi.fn();
    startScan = m.startScan;
    waitUntilComplete = m.waitUntilComplete;
    runSettings = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
  AccessibilityReportFetcher: class {
    setAuth = vi.fn();
    getReportLink = m.getReportLink;
    sourceFromReportUrl = m.sourceFromReportUrl;
    reportStatus = m.reportStatus;
  },
  EXPORT_WAIT_MS: 45_000,
  ExportPendingError: class extends Error {
    constructor(
      readonly taskId: string,
      readonly waitedMs: number,
    ) {
      super("still generating");
    }
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

import addAccessibilityTools, {
  REPORT_STATUS_POLL_MS,
  REPORT_STATUS_WAIT_MS,
} from "../../src/tools/accessibility.js";
import { ExportPendingError } from "../../src/tools/accessiblity-utils/report-fetcher.js";

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

/** A grouped report: 79 main issues, 43 duplicates (all matched), nothing hidden. */
const GROUPED = {
  records: [{ issue_type: "select-name", duplicate_count: 0 }],
  page_length: 1,
  total_issues: 79,
  next_page: 140,
  duplicate_issues: 43,
  unlinked_duplicates: 0,
  hidden_issues: 0,
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

  it("fetchAccessibilityIssues says folded only for the duplicates it could match", async () => {
    m.parse.mockResolvedValue({ ...GROUPED, unlinked_duplicates: 2 });
    const result = await handlers.fetchAccessibilityIssues(
      { scanId: "scan-42", scanRunId: "run-7" },
      CONTEXT,
    );

    const body = text(result);
    expect(body).toContain("Retrieved 1 accessibility issues (Total: 79)");
    expect(body).toContain(
      "43 duplicate occurrences are not included in the total. 41 are folded into their main issue (see duplicate_count); 2 could not be matched to one.",
    );
  });

  it("does not point at duplicate_count when no duplicate could be matched", async () => {
    m.parse.mockResolvedValue({ ...GROUPED, unlinked_duplicates: 43 });
    const result = await handlers.fetchAccessibilityIssues(
      { scanId: "scan-42", scanRunId: "run-7" },
      CONTEXT,
    );

    const body = text(result);
    expect(body).toContain(
      "43 duplicate occurrences are not included in the total.",
    );
    // The note itself; the records below still carry the field.
    expect(body).not.toMatch(
      /not included in the total\.[^\n]*duplicate_count/,
    );
  });

  it("states the hidden issues it left out", async () => {
    m.parse.mockResolvedValue({ ...GROUPED, hidden_issues: 122 });
    const result = await handlers.startAccessibilityScan(
      { name: "hidden", pageURL: "https://site.example" },
      CONTEXT,
    );

    const body = text(result);
    expect(body).toContain("We found 79 issues.");
    expect(body).toContain(
      "122 issues hidden in the dashboard are not included, as the dashboard leaves them out of its count too.",
    );
  });

  it("adds no note for a report without duplicates or hidden issues", async () => {
    m.parse.mockResolvedValue({
      ...GROUPED,
      duplicate_issues: null,
      hidden_issues: null,
      next_page: null,
    });
    const result = await handlers.startAccessibilityScan(
      { name: "plain", pageURL: "https://site.example" },
      CONTEXT,
    );

    const body = text(result);
    expect(body).toContain("We found 79 issues.");
    expect(body).not.toContain("duplicate occurrences");
    expect(body).not.toContain("hidden");
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
      expect(m.getReportLink).toHaveBeenCalledWith(source, expect.anything());
      const body = text(result);
      expect(body).toContain("Retrieved 1 accessibility issues (Total: 79)");
      expect(body).toContain(
        `Use fetchAccessibilityIssues with ${nextPageArgs} and cursor: 140`,
      );
      expect(body).toContain(
        "download the full report (CSV) from the following link",
      );
      expect(body).toContain("https://csv\n");
    },
  );

  it("resolves a dashboard report link and pages by the ids it found", async () => {
    const reportUrl =
      "https://accessibility.browserstack.com/site-scanner/projects/x/builds?thBuildId=abc";
    m.sourceFromReportUrl.mockResolvedValue({
      kind: "scan",
      scanId: "scan-42",
      scanRunId: "run-7",
    });
    const result = await handlers.fetchAccessibilityIssues(
      { reportUrl },
      CONTEXT,
    );

    expect(result.isError).toBeFalsy();
    expect(m.sourceFromReportUrl).toHaveBeenCalledWith(reportUrl);
    expect(m.getReportLink).toHaveBeenCalledWith(
      { kind: "scan", scanId: "scan-42", scanRunId: "run-7" },
      expect.anything(),
    );
    const body = text(result);
    expect(body).toContain(
      "Resolved the report link to Website Scanner scan scan-42, run run-7.",
    );
    expect(body).toContain(
      'Use fetchAccessibilityIssues with scanId: "scan-42", scanRunId: "run-7" and cursor: 140',
    );
  });

  it("startAccessibilityScan reads the run it just started", async () => {
    await handlers.startAccessibilityScan(
      { name: "run", pageURL: "https://site.example" },
      CONTEXT,
    );
    expect(m.getReportLink).toHaveBeenCalledWith(
      { kind: "scan", scanId: "scan-42", scanRunId: "run-7" },
      expect.anything(),
    );
  });

  it("startAccessibilityScan hands a still-generating export over to fetchAccessibilityIssues", async () => {
    m.getReportLink.mockRejectedValueOnce(new (ExportPendingError as any)("t:7", 45_000));

    const result = await handlers.startAccessibilityScan(
      { name: "run", pageURL: "https://site.example" },
      CONTEXT,
    );

    expect(result.isError).toBeFalsy();
    const body = text(result);
    expect(body).toMatch(/completed/);
    expect(body).toMatch(/still being generated/);
    expect(body).toContain('scanId: "scan-42", scanRunId: "run-7" and exportTaskId: "t:7"');
  });

  it.each([
    ["no source", {}, /exactly one/],
    [
      "two sources",
      { scanId: "scan-42", scanRunId: "run-7", buildId: BUILD_ID },
      /exactly one/,
    ],
    ["a scan without its run", { scanId: "scan-42" }, /scanRunId/],
    [
      "a report link with another source",
      {
        reportUrl: "https://accessibility.browserstack.com/x",
        buildId: BUILD_ID,
      },
      /exactly one/,
    ],
  ])("refuses %s without calling the API", async (_label, args, message) => {
    const result = await handlers.fetchAccessibilityIssues(args, CONTEXT);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(message);
    expect(m.getReportLink).not.toHaveBeenCalled();
    expect(m.sourceFromReportUrl).not.toHaveBeenCalled();
  });
});

describe("fetchAccessibilityIssues and a report still processing", () => {
  const BUILD_ID = "q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja";
  const sendNotification = vi.fn();
  const context = { sendNotification, _meta: { progressToken: "tok" } };
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    m.getReportLink.mockResolvedValue("https://csv");
    m.parse.mockResolvedValue({ ...GROUPED, next_page: null });
    handlers = register();
  });

  afterEach(() => vi.useRealTimers());

  it("reads the issues straight away when the report is complete", async () => {
    m.reportStatus.mockResolvedValue("completed");
    const result = await handlers.fetchAccessibilityIssues(
      { buildId: BUILD_ID },
      context,
    );

    expect(m.reportStatus).toHaveBeenCalledTimes(1);
    const body = text(result);
    expect(body).toContain("✅ All issues retrieved.");
    expect(body).not.toContain("still processing");
  });

  it("waits while the report is finalizing, then reads the complete issues", async () => {
    m.reportStatus
      .mockResolvedValueOnce("finalizing")
      .mockResolvedValueOnce("finalizing")
      .mockResolvedValueOnce("completed");
    const pending = handlers.fetchAccessibilityIssues(
      { buildId: BUILD_ID },
      context,
    );
    await vi.advanceTimersByTimeAsync(REPORT_STATUS_POLL_MS * 2);
    const result = await pending;

    expect(m.reportStatus).toHaveBeenCalledTimes(3);
    expect(m.getReportLink).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "notifications/progress",
        params: expect.objectContaining({
          message: expect.stringContaining("still finalizing"),
        }),
      }),
    );
    const body = text(result);
    expect(body).toContain(
      "The report was still processing (status: finalizing); waited 20s for it to complete",
    );
    expect(body).toContain("✅ All issues retrieved.");
  });

  it("says the issues are only those found so far when processing outlasts the wait", async () => {
    m.reportStatus.mockResolvedValue("finalizing");
    const pending = handlers.fetchAccessibilityIssues(
      { buildId: BUILD_ID },
      context,
    );
    await vi.advanceTimersByTimeAsync(
      REPORT_STATUS_WAIT_MS + REPORT_STATUS_POLL_MS,
    );
    const result = await pending;

    const body = text(result);
    expect(body).toContain(
      "This report is still processing (status: finalizing",
    );
    expect(body).toContain("only those found so far");
    expect(body).not.toContain("✅ All issues retrieved.");
  });

  it("does not wait again for a later page, but still says the report is processing", async () => {
    m.reportStatus.mockResolvedValue("finalizing");
    const result = await handlers.fetchAccessibilityIssues(
      { buildId: BUILD_ID, cursor: 4400 },
      context,
    );

    expect(m.reportStatus).toHaveBeenCalledTimes(1);
    expect(text(result)).toContain("This report is still processing");
  });

  it("does not wait while the tests are still running, and says the issues are those found so far", async () => {
    // A long suite can run for an hour; blocking the first read for five minutes and then
    // returning partial results anyway serves nobody. Only post-run processing is waited on.
    m.reportStatus.mockResolvedValue("running");

    const result = await handlers.fetchAccessibilityIssues(
      { buildId: BUILD_ID },
      context,
    );

    expect(m.reportStatus).toHaveBeenCalledTimes(1);
    expect(sendNotification).not.toHaveBeenCalled();
    const body = text(result);
    expect(body).toContain("still processing (status: running");
    expect(body).toContain("only those found so far");
  });

  it("does not wait when the status cannot be read", async () => {
    m.reportStatus.mockResolvedValue(undefined);
    const result = await handlers.fetchAccessibilityIssues(
      { buildId: BUILD_ID },
      context,
    );

    expect(m.reportStatus).toHaveBeenCalledTimes(1);
    expect(text(result)).toContain("✅ All issues retrieved.");
  });
});
