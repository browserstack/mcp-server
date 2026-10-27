import { describe, it, expect, vi, beforeEach } from "vitest";
import { trackMCP, withToolCall } from "../../src/lib/instrumentation";
import { apiClient } from "../../src/lib/apiClient";
import appConfig from "../../src/config";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));
vi.mock("../../src/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/config", () => ({
  default: { REMOTE_MCP: false, BROWSERSTACK_GRR_REGION: undefined },
}));

const clientInfo = { name: "claude-code", version: "1.2.3" };
const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};
const lastRow = () =>
  (apiClient.post as any).mock.calls.at(-1)[0].body.event_properties;

function setRegion(region: string | undefined) {
  (appConfig as any).BROWSERSTACK_GRR_REGION = region;
}

describe("telemetry under BROWSERSTACK_GRR_REGION", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["eu", "in"])(
    "drops free text but keeps usage fields when the region is %s",
    (region) => {
      setRegion(region);
      trackMCP("invokeCapability", clientInfo, new Error("boom"), config, {
        capability: "listTestRuns",
        upstream_status: 200,
        change_summary: "close the checkout regression run",
        search_query: "checkout runs",
        feedback_message: "it failed",
        feedback_category: "tool_error",
      });
      const row = lastRow();
      expect(row).toMatchObject({
        tool_name: "invokeCapability",
        mcp_client: "claude-code",
        success: false,
        error_type: "Error",
        capability: "listTestRuns",
        upstream_status: 200,
        feedback_category: "tool_error",
      });
      for (const field of [
        "error_message",
        "change_summary",
        "search_query",
        "feedback_message",
      ])
        expect(row).not.toHaveProperty(field);
    },
  );

  it("drops the error text of a returned failure inside withToolCall", async () => {
    setRegion("eu");
    await withToolCall("listTestCases", () => clientInfo, config, async () => ({
      content: [{ type: "text", text: "Project PR-1 not found" }],
      isError: true,
    }));
    const row = lastRow();
    expect(row).toMatchObject({ outcome: "error_result", success: true });
    expect(row).not.toHaveProperty("error_message");
  });

  it.each([undefined, "us"])(
    "sends every field when the region is %s",
    (region) => {
      setRegion(region);
      trackMCP("searchCapability", clientInfo, new Error("boom"), config, {
        search_query: "checkout runs",
      });
      expect(lastRow()).toMatchObject({
        error_message: "boom",
        search_query: "checkout runs",
      });
    },
  );
});
