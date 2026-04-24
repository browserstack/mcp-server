import { describe, it, expect, vi, beforeEach } from "vitest";
import addAccessibilityTools from "../../src/tools/accessibility";

vi.mock("../../src/tools/accessiblity-utils/accessibility-rag", () => ({
  queryAccessibilityRAG: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "WCAG guidelines say..." }],
  }),
}));
vi.mock("../../src/tools/accessiblity-utils/scanner", () => ({
  AccessibilityScanner: vi.fn().mockImplementation(() => ({
    setAuth: vi.fn(),
    startScan: vi.fn().mockResolvedValue({ id: "scan-1", scanRunId: "run-1" }),
    waitUntilComplete: vi.fn().mockResolvedValue({ status: "completed" }),
  })),
}));
vi.mock("../../src/tools/accessiblity-utils/report-fetcher", () => ({
  AccessibilityReportFetcher: vi.fn().mockImplementation(() => ({
    setAuth: vi.fn(),
    getReportLink: vi.fn().mockResolvedValue({
      csvReportUrl: "https://example.com/report.csv",
      reportUrl: "https://example.com/report",
    }),
  })),
}));
vi.mock("../../src/tools/accessiblity-utils/report-parser", () => ({
  parseAccessibilityReportFromCSV: vi.fn().mockResolvedValue({
    records: [{ issue: "Low contrast", severity: "serious" }],
    pageLength: 1,
  }),
}));
vi.mock("../../src/tools/accessiblity-utils/auth-config", () => {
  return {
    AccessibilityAuthConfig: class {
      setAuth = vi.fn();
      createBasicAuthConfig = vi.fn().mockResolvedValue({
        data: { id: "auth-1", name: "test" },
      });
      createFormAuthConfig = vi.fn().mockResolvedValue({
        data: { id: "auth-2", name: "test-form" },
      });
      getAuthConfig = vi.fn().mockResolvedValue({
        data: [{ id: "auth-1", name: "test" }],
      });
    },
  };
});
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("Accessibility Tools", () => {
  let serverMock: any;
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    serverMock = {
      tool: vi.fn((name: string, _desc: string, _schema: any, handler: (...args: any[]) => any) => {
        handlers[name] = handler;
      }),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    addAccessibilityTools(serverMock, mockConfig);
  });

  it("registers all 5 accessibility tools", () => {
    const toolNames = serverMock.tool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames).toContain("accessibilityExpert");
    expect(toolNames).toContain("startAccessibilityScan");
    expect(toolNames).toContain("createAccessibilityAuthConfig");
    expect(toolNames).toContain("getAccessibilityAuthConfig");
    expect(toolNames).toContain("fetchAccessibilityIssues");
  });

  it("accessibilityExpert — returns a response without crashing", async () => {
    const result = await handlers["accessibilityExpert"](
      { query: "What is WCAG?" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("createAccessibilityAuthConfig — returns a response for basic auth", async () => {
    const result = await handlers["createAccessibilityAuthConfig"](
      { type: "basic", name: "test-auth", username: "user", password: "pass", url: "https://example.com/login" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("createAccessibilityAuthConfig — FAIL: form auth without required selectors returns error", async () => {
    const result = await handlers["createAccessibilityAuthConfig"](
      { type: "form", name: "test-form", username: "user", password: "pass", url: "https://example.com" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    // Should return an error because form auth requires selectors
    expect(result.isError).toBe(true);
  });

  it("getAccessibilityAuthConfig — returns a response", async () => {
    const result = await handlers["getAccessibilityAuthConfig"](
      { configId: 1 },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("startAccessibilityScan — returns a response", async () => {
    const result = await handlers["startAccessibilityScan"](
      { name: "test-scan", pageURL: "https://example.com" },
      { sendNotification: vi.fn(), _meta: { progressToken: "tok" } },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("fetchAccessibilityIssues — returns a response", async () => {
    const result = await handlers["fetchAccessibilityIssues"](
      { scanId: "scan-1", scanRunId: "run-1" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });
});
