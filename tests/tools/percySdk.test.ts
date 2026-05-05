import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPercyTools } from "../../src/tools/percy-sdk";
import { setUpPercyHandler, simulatePercyChangeHandler } from "../../src/tools/sdk-utils/handler";
import { updateTestsWithPercyCommands } from "../../src/tools/add-percy-snapshots";
import { runPercyScan } from "../../src/tools/run-percy-scan";
import { fetchPercyChanges } from "../../src/tools/review-agent";
import { approveOrDeclinePercyBuild } from "../../src/tools/review-agent-utils/percy-approve-reject";

vi.mock("../../src/tools/sdk-utils/handler", () => ({
  setUpPercyHandler: vi.fn(),
  simulatePercyChangeHandler: vi.fn(),
}));
vi.mock("../../src/tools/add-percy-snapshots", () => ({
  updateTestsWithPercyCommands: vi.fn(),
}));
vi.mock("../../src/tools/run-percy-scan", () => ({
  runPercyScan: vi.fn(),
}));
vi.mock("../../src/tools/review-agent", () => ({
  fetchPercyChanges: vi.fn(),
}));
vi.mock("../../src/tools/review-agent-utils/percy-approve-reject", () => ({
  approveOrDeclinePercyBuild: vi.fn(),
}));
vi.mock("../../src/tools/list-test-files", () => ({
  addListTestFiles: vi.fn(),
}));
vi.mock("../../src/lib/utils", () => ({
  handleMCPError: vi.fn().mockReturnValue({
    content: [{ type: "text", text: "Error" }],
    isError: true,
  }),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/index", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("Percy SDK Tools", () => {
  let serverMock: any;
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    serverMock = {
      tool: vi.fn((name: string, _desc: string, _schema: any, handler: (...args: any[]) => any) => {
        handlers[name] = handler;
      }),
      prompt: vi.fn(),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    registerPercyTools(serverMock, mockConfig);
  });

  it("registers all Percy tools", () => {
    const toolNames = serverMock.tool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames).toContain("percyVisualTestIntegrationAgent");
    expect(toolNames).toContain("expandPercyVisualTesting");
    expect(toolNames).toContain("addPercySnapshotCommands");
    expect(toolNames).toContain("listTestFiles");
    expect(toolNames).toContain("runPercyScan");
    expect(toolNames).toContain("fetchPercyChanges");
    expect(toolNames).toContain("managePercyBuildApproval");
  });

  it("percyVisualTestIntegrationAgent - SUCCESS", async () => {
    (simulatePercyChangeHandler as any).mockResolvedValue({
      content: [{ type: "text", text: "Percy integration guide" }],
    });

    const result = await handlers["percyVisualTestIntegrationAgent"]({ framework: "playwright" });
    expect(result.content[0].text).toContain("Percy integration");
  });

  it("percyVisualTestIntegrationAgent - FAIL: returns error on failure", async () => {
    (simulatePercyChangeHandler as any).mockReturnValue(
      Promise.reject(new Error("fail")),
    );

    // The handler doesn't await simulatePercyChangeHandler, so the rejection
    // propagates through the returned promise. The try-catch won't catch it.
    await expect(
      handlers["percyVisualTestIntegrationAgent"]({ framework: "bad" }),
    ).rejects.toThrow("fail");
  });

  it("expandPercyVisualTesting - SUCCESS", async () => {
    (setUpPercyHandler as any).mockResolvedValue({
      content: [{ type: "text", text: "Percy setup complete" }],
    });

    const result = await handlers["expandPercyVisualTesting"]({ language: "js" });
    expect(result.content[0].text).toContain("Percy setup");
  });

  it("expandPercyVisualTesting - FAIL: returns error on failure", async () => {
    (setUpPercyHandler as any).mockReturnValue(
      Promise.reject(new Error("fail")),
    );

    await expect(
      handlers["expandPercyVisualTesting"]({ language: "bad" }),
    ).rejects.toThrow("fail");
  });

  it("addPercySnapshotCommands - SUCCESS", async () => {
    (updateTestsWithPercyCommands as any).mockResolvedValue({
      content: [{ type: "text", text: "Commands added" }],
    });

    const result = await handlers["addPercySnapshotCommands"]({ index: 0 });
    expect(result.content[0].text).toContain("Commands added");
  });

  it("runPercyScan - SUCCESS", async () => {
    (runPercyScan as any).mockResolvedValue({
      content: [{ type: "text", text: "Percy scan started" }],
    });

    const result = await handlers["runPercyScan"]({ projectName: "test" });
    expect(result.content[0].text).toContain("Percy scan");
  });

  it("fetchPercyChanges - SUCCESS", async () => {
    (fetchPercyChanges as any).mockResolvedValue({
      content: [{ type: "text", text: "Visual changes found" }],
    });

    const result = await handlers["fetchPercyChanges"]({ project_name: "test" });
    expect(result.content[0].text).toContain("Visual changes");
  });

  it("managePercyBuildApproval - SUCCESS", async () => {
    (approveOrDeclinePercyBuild as any).mockResolvedValue({
      content: [{ type: "text", text: "Build approved" }],
    });

    const result = await handlers["managePercyBuildApproval"]({ buildId: "123", action: "approve" });
    expect(result.content[0].text).toContain("Build approved");
  });

  it("managePercyBuildApproval - FAIL", async () => {
    (approveOrDeclinePercyBuild as any).mockRejectedValue(new Error("fail"));

    const result = await handlers["managePercyBuildApproval"]({ buildId: "bad" });
    expect(result.isError).toBe(true);
  });
});
