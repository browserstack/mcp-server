import { beforeEach, describe, expect, it, vi } from "vitest";

// Refusals the user resolves on their own account (plan limits, a Website Scanner user not
// set up yet) are explained rather than reported as faults, and accessibilityExpert keeps
// questions within the knowledge base's 500-character limit. API messages are as logged on
// 4 Nov 2026.

const m = vi.hoisted(() => ({
  startScan: vi.fn(),
  waitUntilComplete: vi.fn(),
  getReportLink: vi.fn(),
  sourceFromReportUrl: vi.fn(),
  reportStatus: vi.fn(),
  // A build id is probed on both APIs; by default it stays what it was named as.
  resolveBuild: vi.fn(async (source: unknown) => source),
  appBuildReport: vi.fn(),
  appReportIssues: vi.fn(),
  parse: vi.fn(),
  dashboardLink: vi.fn(),
  failureDetails: vi.fn(async () => ({ pages: [] })),
  rag: vi.fn(),
}));

vi.mock("../../src/tools/accessiblity-utils/accessibility-rag.js", () => ({
  queryAccessibilityRAG: m.rag,
}));

vi.mock("../../src/tools/accessiblity-utils/scanner.js", () => ({
  AccessibilityScanner: class {
    setAuth = vi.fn();
    startScan = m.startScan;
    waitUntilComplete = m.waitUntilComplete;
    runSettings = vi.fn().mockResolvedValue(undefined);
    dashboardLink = m.dashboardLink;
    failureDetails = m.failureDetails;
  },
  ScanTimeoutError: class extends Error {
    constructor(readonly waitedMs: number) {
      super("still running");
    }
  },
}));
vi.mock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
  AccessibilityReportFetcher: class {
    setAuth = vi.fn();
    getReportLink = m.getReportLink;
    sourceFromReportUrl = m.sourceFromReportUrl;
    reportStatus = m.reportStatus;
    resolveBuild = m.resolveBuild;
    appBuildReport = m.appBuildReport;
    appReportIssues = m.appReportIssues;
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
// apiClient reaches the server entry through lib/utils; it must not start the server.
vi.mock("../../src/index.js", () => ({
  trackMCP: vi.fn(),
  PackageJsonVersion: "0.0.0",
}));

import addAccessibilityTools, {
  EXPERT_QUERY_MAX_CHARS,
} from "../../src/tools/accessibility.js";
import {
  FEEDBACK_HINT,
  withFeedbackHint,
} from "../../src/lib/feedback-hint.js";

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

describe("refusals the user resolves on their own account", () => {
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = register();
  });

  const startWith = async (apiMessage: string) => {
    m.startScan.mockRejectedValue(new Error(apiMessage));
    return handlers.startAccessibilityScan(
      { name: "home", pageURL: "https://site.example" },
      CONTEXT,
    );
  };

  it("explains the free plan's saved-scan limit, and says not to retry under another name", async () => {
    const result = await startWith(
      "Failed to start scan: You don't have access to make over 50 scans",
    );

    expect(result.isError).toBe(true);
    const body = text(result);
    expect(body).toContain(
      "This account has reached its plan's limit of 50 saved Website Scanner scans",
    );
    expect(body).toContain("delete scans that are no longer needed");
    expect(body).toContain("do not retry or start the scan under another name");
    expect(body).toContain(
      "BrowserStack said: Failed to start scan: You don't have access to make over 50 scans",
    );
    expect(body).not.toContain("open an issue on GitHub");
  });

  it("explains a plan without the External APIs add-on", async () => {
    const body = text(
      await startWith(
        "Failed to start scan: You do not have access to External APIs.",
      ),
    );

    expect(body).toContain(
      "does not include the External APIs add-on, which the MCP's accessibility tools need",
    );
    expect(body).toContain(
      "Scans can still be run and read in the Accessibility dashboard",
    );
    expect(body).not.toContain("open an issue on GitHub");
  });

  it("explains the add-on refusal on any accessibility tool, not only the scan", async () => {
    m.resolveBuild.mockRejectedValueOnce(
      new Error("You do not have access to External APIs."),
    );
    const result = await handlers.fetchAccessibilityIssues(
      { buildId: "q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja" },
      CONTEXT,
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("does not include the External APIs add-on");
  });

  it("tells a user Website Scanner has not set up yet to open it once", async () => {
    const body = text(
      await startWith("Failed to start scan: user info missing"),
    );

    expect(body).toContain("Website Scanner has not set this user up yet");
    expect(body).toContain(
      "open https://accessibility.browserstack.com/site-scanner once while signed in",
    );
    expect(body).not.toContain("open an issue on GitHub");
  });

  it("does not ask the agent to report these with submitFeedback", async () => {
    for (const apiMessage of [
      "Failed to start scan: You don't have access to make over 50 scans",
      "Failed to start scan: You do not have access to External APIs.",
      "Failed to start scan: user info missing",
    ]) {
      const result = await startWith(apiMessage);
      expect(
        text(withFeedbackHint("startAccessibilityScan", result)),
      ).not.toContain(FEEDBACK_HINT);
    }
  });

  it("leaves other failures as they were, hint included", async () => {
    const result = await startWith("Failed to start scan: socket hang up");

    const body = text(result);
    expect(body).toContain(
      "Failed to start accessibility scan: Failed to start scan: socket hang up. Please open an issue on GitHub",
    );
    expect(text(withFeedbackHint("startAccessibilityScan", result))).toContain(
      FEEDBACK_HINT,
    );
  });
});

describe("accessibilityExpert and the knowledge base's 500-character limit", () => {
  let handlers: Record<string, (...args: any[]) => any>;
  const ANSWER = { content: [{ type: "text", text: "Use 4.5:1." }] };

  beforeEach(() => {
    vi.clearAllMocks();
    m.rag.mockResolvedValue(ANSWER);
    handlers = register();
  });

  it("passes a question within the limit as it is, with no note", async () => {
    const result = await handlers.accessibilityExpert({
      query: "What contrast ratio does body text need?",
    });

    expect(m.rag).toHaveBeenCalledWith(
      "What contrast ratio does body text need?",
      CONFIG,
    );
    expect(result).toEqual(ANSWER);
  });

  it("keeps the question's opening and its last sentence, and says so above the answer", async () => {
    const context =
      "The chart renders bars as SVG rect elements with role=img and an aria-label. ".repeat(
        8,
      );
    const question = "Do the individual bars also need accessible names?";
    const query = context + question; // about 670 characters
    const result = await handlers.accessibilityExpert({ query });

    const sent: string = m.rag.mock.calls[0][0];
    expect(sent.length).toBeLessThanOrEqual(EXPERT_QUERY_MAX_CHARS);
    expect(sent.endsWith(` … ${question}`)).toBe(true);
    const opening = sent.slice(0, sent.indexOf(" … "));
    expect(query.startsWith(opening)).toBe(true);
    expect(query[opening.length]).toMatch(/\s/);
    const body = text(result);
    expect(body).toContain(
      `The question was ${query.length} characters; the knowledge base takes at most 500, so ${sent.length} were sent: its opening and its last sentence.`,
    );
    expect(body).toContain("Use 4.5:1.");
  });

  it("keeps only the opening when the last sentence is itself too long to keep whole", async () => {
    const query = "word ".repeat(150).trim() + "?"; // one 750-character sentence
    await handlers.accessibilityExpert({ query });

    const sent: string = m.rag.mock.calls[0][0];
    expect(sent.length).toBeLessThanOrEqual(EXPERT_QUERY_MAX_CHARS);
    expect(query.startsWith(sent)).toBe(true);
    expect(sent).not.toContain(" … ");
  });

  it("cuts a question with no word break near the limit at the limit itself", async () => {
    const query = "x".repeat(700);
    await handlers.accessibilityExpert({ query });

    expect(m.rag.mock.calls[0][0]).toBe("x".repeat(EXPERT_QUERY_MAX_CHARS));
  });
});
