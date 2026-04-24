import { describe, it, expect, vi, beforeEach } from "vitest";
import addSDKTools from "../../src/tools/bstack-sdk";
import { runTestsOnBrowserStackHandler } from "../../src/tools/sdk-utils/handler";

vi.mock("../../src/tools/sdk-utils/handler", () => ({
  runTestsOnBrowserStackHandler: vi.fn(),
}));
vi.mock("../../src/lib/utils", () => ({
  handleMCPError: vi.fn().mockReturnValue({
    content: [{ type: "text", text: "Error occurred" }],
    isError: true,
  }),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("BStack SDK Tool", () => {
  let serverMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => {
        serverMock.handlers = serverMock.handlers || {};
        serverMock.handlers[name] = handler;
      }),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    addSDKTools(serverMock, mockConfig);
  });

  it("registers setupBrowserStackAutomateTests tool", () => {
    expect(serverMock.tool).toHaveBeenCalledWith(
      "setupBrowserStackAutomateTests",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("SUCCESS: returns SDK setup instructions", async () => {
    (runTestsOnBrowserStackHandler as any).mockResolvedValue({
      content: [{ type: "text", text: "SDK configured successfully" }],
    });

    const handler = serverMock.handlers["setupBrowserStackAutomateTests"];
    const result = await handler({ language: "java", test_framework: "testng", testing_type: "web" });

    expect(result.content[0].text).toContain("SDK configured");
  });

  it("FAIL: returns error via handleMCPError", async () => {
    (runTestsOnBrowserStackHandler as any).mockRejectedValue(
      new Error("Invalid framework"),
    );

    const handler = serverMock.handlers["setupBrowserStackAutomateTests"];
    const result = await handler({ language: "bad", test_framework: "bad", testing_type: "web" });

    expect(result.isError).toBe(true);
  });
});
