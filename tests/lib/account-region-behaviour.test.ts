import { beforeEach, describe, expect, it, vi } from "vitest";

const regions = new Map<string, string>();
vi.mock("../../src/lib/account-region.js", () => ({
  accountRegion: (config: any) => {
    const region = regions.get(config?.["browserstack-username"]);
    return region === undefined ? undefined : Promise.resolve(region);
  },
}));
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));
import { apiClient } from "../../src/lib/apiClient.js";
import { getRegionalHost } from "../../src/lib/regional-host.js";
import { bindAccountRegion } from "../../src/lib/tool-latency.js";
import { trackMCP, withToolCall } from "../../src/lib/instrumentation.js";
import { withAccountRegion } from "../../src/lib/region-context.js";
import { BrowserStackMcpServer } from "../../src/server-factory.js";
import { FEEDBACK_UNAVAILABLE } from "../../src/tools/feedback.js";

const configFor = (username: string) => ({
  "browserstack-username": username,
  "browserstack-access-key": "key",
});
const clientInfo = { name: "claude-code", version: "1" };
const rows = () =>
  (apiClient.post as any).mock.calls.map((c: any) => c[0].body.event_properties);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function tmHostTool(config: ReturnType<typeof configFor>) {
  const tools: any = {
    probe: {
      handler: async () => {
        await settle();
        return getRegionalHost("testManagement");
      },
    },
  };
  bindAccountRegion(tools, config);
  return tools.probe.handler as () => Promise<string>;
}

describe("the account's region", () => {
  beforeEach(() => {
    regions.clear();
    (apiClient.post as any).mockClear();
  });

  it("routes concurrent calls for different accounts to their own region", async () => {
    regions.set("eu-user", "eu").set("us-user", "us").set("in-user", "in");
    const hosts = await Promise.all(
      ["eu-user", "us-user", "in-user"].map((u) => tmHostTool(configFor(u))()),
    );
    expect(hosts).toEqual([
      "https://test-management-eu.browserstack.com",
      "https://test-management.browserstack.com",
      "https://test-management.browserstack.com",
    ]);
  });

  it("refuses to pick a host when the lookup failed", async () => {
    regions.set("someone", "unknown");
    await expect(tmHostTool(configFor("someone"))()).rejects.toThrow(
      /Could not confirm your BrowserStack account's region/,
    );
  });

  it.each(["eu", "in"])(
    "sends no telemetry outside a tool call for a %s account",
    async (region) => {
      regions.set("user", region);
      trackMCP("started", clientInfo, undefined, configFor("user"));
      await settle();
      expect(rows()).toHaveLength(0);
    },
  );

  it.each([
    ["unknown", true],
    ["us", false],
  ])(
    "limits telemetry outside a tool call for a %s account: %s",
    async (region, limited) => {
      regions.set("user", region);
      trackMCP("started", clientInfo, new Error("boom"), configFor("user"), {
        search_query: "checkout runs",
      });
      await settle();
      const row = rows().at(-1);
      expect(row.tool_name).toBe("started");
      expect("error_message" in row).toBe(!limited);
      expect("search_query" in row).toBe(!limited);
    },
  );

  it("sends no telemetry inside a tool call for an EU account", async () => {
    await withAccountRegion("eu", () =>
      withToolCall("listTestCases", () => clientInfo, configFor("x"), async () => ({
        content: [{ type: "text", text: "Project PR-1 not found" }],
        isError: true,
      })),
    );
    expect(rows()).toHaveLength(0);
  });

  it.each(["eu", "in"])(
    "leaves feedback out of a server created for a %s account",
    async (region) => {
      regions.set("user", region);
      const server = await BrowserStackMcpServer.create(configFor("user"));
      expect(server.getTool("submitFeedback")).toBeUndefined();
      expect((server.getInstance().server as any)._instructions ?? "").not.toContain(
        "submitFeedback",
      );
    },
  );

  it("keeps feedback for a US account", async () => {
    regions.set("user", "us");
    const server = await BrowserStackMcpServer.create(configFor("user"));
    expect(server.getTool("submitFeedback")).toBeDefined();
  });

  it("declines feedback at call time when the server was built before the lookup", async () => {
    regions.set("user", "eu");
    const server = new BrowserStackMcpServer(configFor("user"));
    const result: any = await server.getTool("submitFeedback")!.handler(
      { message: "the tool did not work", category: "tool_error" } as any,
      {} as any,
    );
    expect(result.content[0].text).toBe(FEEDBACK_UNAVAILABLE);
    await settle();
    expect(rows().some((r: any) => "feedback_message" in r)).toBe(false);
  });
});
