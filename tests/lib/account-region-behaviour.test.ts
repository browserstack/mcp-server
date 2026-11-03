import { beforeEach, describe, expect, it, vi } from "vitest";

const regions = new Map<string, string>();
vi.mock("../../src/lib/account-region.js", () => ({
  accountRegion: (config: any) => {
    const region = regions.get(config?.["browserstack-username"]);
    return region === undefined ? undefined : Promise.resolve(region);
  },
}));
import { getRegionalHost } from "../../src/lib/regional-host.js";
import { bindAccountRegion } from "../../src/lib/tool-latency.js";

const configFor = (username: string) => ({
  "browserstack-username": username,
  "browserstack-access-key": "key",
});
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
});
