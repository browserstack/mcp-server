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
vi.mock("../../src/tools/accessiblity-utils/auth-config", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/tools/accessiblity-utils/auth-config")
    >();
  return {
    ...actual,
    AccessibilityAuthConfig: class {
      setAuth = vi.fn();
      createBasicAuthConfig = vi.fn().mockResolvedValue({
        data: {
          id: "auth-1",
          name: "test",
          username: "site-user",
          password: "super-secret-site-password",
        },
      });
      createFormAuthConfig = vi.fn().mockResolvedValue({
        data: { id: "auth-2", name: "test-form" },
      });
      getAuthConfig = vi.fn().mockResolvedValue({
        data: {
          id: "auth-1",
          name: "test",
          username: "site-user",
          password: "super-secret-site-password",
        },
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
      tool: vi.fn((...toolArgs: any[]) => {
        const name = toolArgs[0] as string;
        const handler = toolArgs[toolArgs.length - 1] as (...args: any[]) => any;
        handlers[name] = handler;
      }),
      server: {
        getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }),
        // Default: client does NOT support elicitation (arg-based flow).
        getClientCapabilities: vi.fn().mockReturnValue({}),
        elicitInput: vi.fn(),
      },
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

  it("createAccessibilityAuthConfig — response omits the stored site credentials", async () => {
    const result = await handlers["createAccessibilityAuthConfig"](
      { type: "basic", name: "test-auth", username: "user", password: "pass", url: "https://example.com/login" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const serialized = JSON.stringify(result.content);
    // Allowlist: neither the site password nor the site username is echoed.
    expect(serialized).not.toContain("super-secret-site-password");
    expect(serialized).not.toContain("site-user");
    // Safe identifying fields are still returned.
    expect(serialized).toContain("auth-1");
  });

  it("createAccessibilityAuthConfig — elicits credentials from the user when the client supports it and they are not passed as args", async () => {
    serverMock.server.getClientCapabilities.mockReturnValue({ elicitation: {} });
    serverMock.server.elicitInput.mockResolvedValue({
      action: "accept",
      content: { username: "elicited-user", password: "elicited-pass" },
    });

    const result = await handlers["createAccessibilityAuthConfig"](
      { type: "basic", name: "no-args-auth", url: "https://example.com/login" },
      { sendNotification: vi.fn(), _meta: {} },
    );

    // Elicitation was used, and the config was created without creds in args.
    expect(serverMock.server.elicitInput).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    // The elicited secret is never echoed back (allowlisted response).
    expect(JSON.stringify(result.content)).not.toContain("elicited-pass");
  });

  it("createAccessibilityAuthConfig — errors when creds are missing and the client cannot elicit", async () => {
    // Default mock: getClientCapabilities returns {} (no elicitation support).
    const result = await handlers["createAccessibilityAuthConfig"](
      { type: "basic", name: "no-args-auth", url: "https://example.com/login" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result.isError).toBe(true);
    expect(serverMock.server.elicitInput).not.toHaveBeenCalled();
  });

  it("createAccessibilityAuthConfig — FAIL: form auth without required selectors returns error", async () => {
    const result = await handlers["createAccessibilityAuthConfig"](
      { type: "form", name: "test-form", username: "user", password: "pass", url: "https://example.com" },
      { sendNotification: vi.fn(), _meta: {} },
    );
    // Should return an error because form auth requires selectors
    expect(result.isError).toBe(true);
  });

  it("getAccessibilityAuthConfig — response omits the stored site credentials", async () => {
    const result = await handlers["getAccessibilityAuthConfig"](
      { configId: 1 },
      { sendNotification: vi.fn(), _meta: {} },
    );
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const serialized = JSON.stringify(result.content);
    // Allowlist: neither the site password nor the site username is echoed.
    expect(serialized).not.toContain("super-secret-site-password");
    expect(serialized).not.toContain("site-user");
    // Safe identifying fields are still returned.
    expect(serialized).toContain("auth-1");
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
