import { describe, it, expect, vi, beforeEach } from "vitest";
import { trackMCP, withToolCall } from "../../src/lib/instrumentation";
import { apiClient } from "../../src/lib/apiClient";
import { withAccountRegion } from "../../src/lib/region-context";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));
vi.mock("../../src/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/config", () => ({
  default: { REMOTE_MCP: false },
}));

const clientInfo = { name: "claude-code", version: "1.2.3" };
const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};
const lastRow = () =>
  (apiClient.post as any).mock.calls.at(-1)[0].body.event_properties;

describe("telemetry by the account's region", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["eu", "in", "unknown"])(
    "drops free text but keeps usage fields for a %s account",
    (region) => {
      withAccountRegion(region as any, () =>
        trackMCP("invokeCapability", clientInfo, new Error("boom"), config, {
          capability: "listTestRuns",
          upstream_status: 200,
          change_summary: "close the checkout regression run",
          search_query: "checkout runs",
          feedback_message: "it failed",
          feedback_category: "tool_error",
        }),
      );
      const row = lastRow();
      expect(row).toMatchObject({
        tool_name: "invokeCapability",
        mcp_client: "claude-code",
        success: false,
        error_type: "Error",
        capability: "listTestRuns",
        upstream_status: 200,
      });
      for (const field of [
        "error_message",
        "change_summary",
        "search_query",
        "feedback_message",
        "feedback_category",
      ])
        expect(row).not.toHaveProperty(field);
    },
  );

  it.each(["eu", "in", "unknown"])(
    "drops the error text of a returned failure for a %s account",
    async (region) => {
      await withAccountRegion(region as any, () =>
        withToolCall(
          "listTestCases",
          () => clientInfo,
          config,
          async () => ({
            content: [{ type: "text", text: "Project PR-1 not found" }],
            isError: true,
          }),
        ),
      );
      const row = lastRow();
      expect(row).toMatchObject({ outcome: "error_result", success: true });
      expect(row).not.toHaveProperty("error_message");
    },
  );

  it.each(["eu", "in", "unknown"])(
    "keeps only a known product and no entity for a %s account",
    (region) => {
      withAccountRegion(region as any, () => {
        trackMCP("searchCapability", clientInfo, undefined, config, {
          product: "tm",
          entity: "Acme release 4.2",
        });
        trackMCP("searchCapability", clientInfo, undefined, config, {
          product: "Acme release 4.2",
        });
      });
      const calls = (apiClient.post as any).mock.calls;
      const [known, typed] = calls
        .slice(-2)
        .map((c: any) => c[0].body.event_properties);
      expect(known.product).toBe("tm");
      expect(known).not.toHaveProperty("entity");
      expect(typed).not.toHaveProperty("product");
    },
  );

  it.each([undefined, "us"])(
    "sends every field when the region is %s",
    (region) => {
      withAccountRegion(region as any, () =>
        trackMCP("searchCapability", clientInfo, new Error("boom"), config, {
          search_query: "checkout runs",
        }),
      );
      expect(lastRow()).toMatchObject({
        error_message: "boom",
        search_query: "checkout runs",
      });
    },
  );
});
