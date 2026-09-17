import { describe, it, expect, vi, beforeEach } from "vitest";
import addAppAutomationTools from "../../src/tools/appautomate";
import { setupAppAutomateHandler } from "../../src/tools/appautomate-utils/appium-sdk/handler";
import { trackMCP } from "../../src/lib/instrumentation";

vi.mock("../../src/tools/appautomate-utils/appium-sdk/handler", () => ({
  setupAppAutomateHandler: vi.fn(),
}));
vi.mock("webdriverio", () => ({ remote: vi.fn() }));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};
const clientVersion = { name: "test-client", version: "1.0" };

describe("setupBrowserStackAppAutomateTests telemetry", () => {
  let serverMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((...toolArgs: any[]) => {
        const name = toolArgs[0];
        const handler = toolArgs[toolArgs.length - 1];
        serverMock.handlers = serverMock.handlers || {};
        serverMock.handlers[name] = handler;
      }),
      server: { getClientVersion: vi.fn().mockReturnValue(clientVersion) },
    };
    addAppAutomationTools(serverMock, mockConfig as any);
  });

  const args = {
    language: "java",
    test_framework: "testng",
    app_platform: "android",
    app_path: "/path/app.apk",
  };

  it("records a success event with config on the success path", async () => {
    (setupAppAutomateHandler as any).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    await serverMock.handlers["setupBrowserStackAppAutomateTests"](args);

    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect(trackMCP).toHaveBeenCalledWith(
      "setupBrowserStackAppAutomateTests",
      clientVersion,
      undefined,
      mockConfig,
    );
  });

  it("records a failure event with the error and config on throw", async () => {
    const boom = new Error("handler exploded");
    (setupAppAutomateHandler as any).mockRejectedValue(boom);

    const result =
      await serverMock.handlers["setupBrowserStackAppAutomateTests"](args);

    expect(result.isError).toBe(true);
    expect(trackMCP).toHaveBeenCalledTimes(2);
    expect(trackMCP).toHaveBeenLastCalledWith(
      "setupBrowserStackAppAutomateTests",
      clientVersion,
      boom,
      mockConfig,
    );
  });
});
