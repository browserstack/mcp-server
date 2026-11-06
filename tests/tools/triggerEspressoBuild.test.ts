import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient";
import { triggerEspressoBuild } from "../../src/tools/appautomate-utils/native-execution/appautomate";

const mockConfig = {
  "browserstack-username": "config-user",
  "browserstack-access-key": "config-key",
};

describe("triggerEspressoBuild — credential sourcing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Guard: even if process.env happens to be set, the function must not use it.
    process.env.BROWSERSTACK_USERNAME = "env-user-should-be-ignored";
    process.env.BROWSERSTACK_ACCESS_KEY = "env-key-should-be-ignored";
  });

  it("uses creds from config, not process.env", async () => {
    (apiClient.post as any).mockResolvedValue({ data: { build_id: "BUILD-1" } });

    const buildId = await triggerEspressoBuild(
      "app.apk",
      "tests.apk",
      ["Samsung Galaxy S20-12.0"],
      "p1",
      mockConfig,
    );

    expect(buildId).toBe("BUILD-1");

    const call = (apiClient.post as any).mock.calls[0][0];
    const authHeader = call.headers.Authorization as string;
    expect(authHeader.startsWith("Basic ")).toBe(true);

    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString();
    expect(decoded).toBe("config-user:config-key");
    expect(decoded).not.toContain("env-user-should-be-ignored");
  });

  it("throws a clear error when config is missing creds (does not silently auth)", async () => {
    await expect(
      triggerEspressoBuild("app.apk", "tests.apk", ["d"], "p", {
        "browserstack-username": "",
        "browserstack-access-key": "",
      } as any),
    ).rejects.toThrow(/credentials not set/i);

    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
