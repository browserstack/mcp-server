import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import {
  resolvePercyToken,
  getPercyHeaders,
  getPercyApiBaseUrl,
} from "../../../src/lib/percy-api/auth.js";
import { fetchPercyToken } from "../../../src/tools/sdk-utils/percy-web/fetchPercyToken.js";

vi.mock("../../../src/tools/sdk-utils/percy-web/fetchPercyToken", () => ({
  fetchPercyToken: vi.fn(),
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

const emptyConfig = {
  "browserstack-username": "",
  "browserstack-access-key": "",
};

describe("resolvePercyToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("SUCCESS: PERCY_TOKEN env var set resolves for project scope", async () => {
    vi.stubEnv("PERCY_TOKEN", "project-token-abc123");

    const token = await resolvePercyToken(emptyConfig, { scope: "project" });

    expect(token).toBe("project-token-abc123");
    expect(fetchPercyToken).not.toHaveBeenCalled();
  });

  it("SUCCESS: PERCY_ORG_TOKEN env var set resolves for org scope", async () => {
    vi.stubEnv("PERCY_ORG_TOKEN", "org-token-xyz789");

    const token = await resolvePercyToken(emptyConfig, { scope: "org" });

    expect(token).toBe("org-token-xyz789");
    expect(fetchPercyToken).not.toHaveBeenCalled();
  });

  it("SUCCESS: both tokens set - project scope prefers PERCY_TOKEN, org scope uses PERCY_ORG_TOKEN", async () => {
    vi.stubEnv("PERCY_TOKEN", "project-token-abc123");
    vi.stubEnv("PERCY_ORG_TOKEN", "org-token-xyz789");

    const projectToken = await resolvePercyToken(emptyConfig, {
      scope: "project",
    });
    expect(projectToken).toBe("project-token-abc123");

    const orgToken = await resolvePercyToken(emptyConfig, { scope: "org" });
    expect(orgToken).toBe("org-token-xyz789");
  });

  it("SUCCESS: auto scope prefers PERCY_TOKEN over PERCY_ORG_TOKEN", async () => {
    vi.stubEnv("PERCY_TOKEN", "project-token-abc123");
    vi.stubEnv("PERCY_ORG_TOKEN", "org-token-xyz789");

    const token = await resolvePercyToken(emptyConfig, { scope: "auto" });

    expect(token).toBe("project-token-abc123");
  });

  it("SUCCESS: auto scope falls back to PERCY_ORG_TOKEN when PERCY_TOKEN absent", async () => {
    vi.stubEnv("PERCY_ORG_TOKEN", "org-token-xyz789");

    const token = await resolvePercyToken(emptyConfig, { scope: "auto" });

    expect(token).toBe("org-token-xyz789");
  });

  it("SUCCESS: no env var but BrowserStack credentials falls back to fetchPercyToken", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("fetched-token-456");

    const token = await resolvePercyToken(mockConfig, {
      projectName: "my-project",
    });

    expect(token).toBe("fetched-token-456");
    expect(fetchPercyToken).toHaveBeenCalledWith(
      "my-project",
      "fake-user:fake-key",
      {},
    );
  });

  it("SUCCESS: fallback uses default project name when none provided", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("fetched-token-789");

    const token = await resolvePercyToken(mockConfig);

    expect(token).toBe("fetched-token-789");
    expect(fetchPercyToken).toHaveBeenCalledWith(
      "default",
      "fake-user:fake-key",
      {},
    );
  });

  it("FAIL: neither token set and no BrowserStack credentials throws with guidance", async () => {
    await expect(resolvePercyToken(emptyConfig)).rejects.toThrow(
      "Percy token not available",
    );
    await expect(resolvePercyToken(emptyConfig)).rejects.toThrow(
      "PERCY_TOKEN",
    );
    await expect(resolvePercyToken(emptyConfig)).rejects.toThrow(
      "PERCY_ORG_TOKEN",
    );
  });

  it("FAIL: only org token set but project scope requested throws with guidance", async () => {
    vi.stubEnv("PERCY_ORG_TOKEN", "org-token-xyz789");

    await expect(
      resolvePercyToken(emptyConfig, { scope: "project" }),
    ).rejects.toThrow("Set PERCY_TOKEN");
  });

  it("FAIL: fetchPercyToken fails propagates error with guidance", async () => {
    (fetchPercyToken as Mock).mockRejectedValue(
      new Error("API returned 401"),
    );

    await expect(
      resolvePercyToken(mockConfig, { projectName: "bad-project" }),
    ).rejects.toThrow("Failed to fetch Percy token via BrowserStack API");
    await expect(
      resolvePercyToken(mockConfig, { projectName: "bad-project" }),
    ).rejects.toThrow("API returned 401");
  });
});

describe("getPercyHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("SUCCESS: returns correct headers with token", async () => {
    vi.stubEnv("PERCY_TOKEN", "my-percy-token");

    const headers = await getPercyHeaders(emptyConfig);

    expect(headers).toEqual({
      Authorization: "Token token=my-percy-token",
      "Content-Type": "application/json",
      "User-Agent": "browserstack-mcp-server",
    });
  });

  it("SUCCESS: passes scope and projectName to resolvePercyToken", async () => {
    vi.stubEnv("PERCY_ORG_TOKEN", "org-token-abc");

    const headers = await getPercyHeaders(emptyConfig, { scope: "org" });

    expect(headers.Authorization).toBe("Token token=org-token-abc");
  });
});

describe("getPercyApiBaseUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("SUCCESS: returns default URL when env not set", () => {
    const url = getPercyApiBaseUrl();
    expect(url).toBe("https://percy.io/api/v1");
  });

  it("SUCCESS: returns custom URL from env", () => {
    vi.stubEnv("PERCY_API_URL", "https://custom-percy.example.com/api/v1");

    const url = getPercyApiBaseUrl();
    expect(url).toBe("https://custom-percy.example.com/api/v1");
  });
});
