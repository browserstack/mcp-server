import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import {
  AccessibilityAuthConfig,
  safeAuthConfigData,
} from "../../src/tools/accessiblity-utils/auth-config";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const LIST_URL =
  "https://api-accessibility.browserstack.com/api/website-scanner/v1/auth_configs";

const listResponse = {
  success: true,
  data: {
    authConfigs: [
      {
        id: 9364,
        name: "staging-login",
        type: "Basic Authentication",
        type_identifier: "basic",
        authData: { username: "site-user", password: "site-secret" },
      },
      {
        id: 9351,
        name: "form-login",
        type: "Form Authentication",
        type_identifier: "form",
        authData: {
          url: "https://example.com/login",
          username: "u",
          password: "p",
        },
      },
    ],
  },
};

describe("AccessibilityAuthConfig.getAuthConfig", () => {
  let authConfig: AccessibilityAuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    authConfig = new AccessibilityAuthConfig();
    authConfig.setAuth({ username: "bs-user", password: "bs-key" });
  });

  it("lists the account's configs (no GET-by-id route exists) and selects by id", async () => {
    (apiClient.get as Mock).mockResolvedValue({ data: listResponse });

    const result = await authConfig.getAuthConfig(9364);

    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect((apiClient.get as Mock).mock.calls[0][0].url).toBe(LIST_URL);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(9364);
    expect(result.data?.name).toBe("staging-login");
    expect(result.data?.type).toBe("basic");
  });

  it("carries the login url through for form configs", async () => {
    (apiClient.get as Mock).mockResolvedValue({ data: listResponse });

    const result = await authConfig.getAuthConfig(9351);

    expect(result.data?.type).toBe("form");
    expect(result.data?.url).toBe("https://example.com/login");
  });

  it("returns a clear not-found error instead of a raw 404", async () => {
    (apiClient.get as Mock).mockResolvedValue({ data: listResponse });

    await expect(authConfig.getAuthConfig(1)).rejects.toThrow(
      /Auth config 1 not found/,
    );
  });

  it("never exposes the stored site credentials after the allowlist", async () => {
    (apiClient.get as Mock).mockResolvedValue({ data: listResponse });

    const result = await authConfig.getAuthConfig(9364);
    const serialized = JSON.stringify(safeAuthConfigData(result));

    expect(serialized).not.toContain("site-secret");
    expect(serialized).not.toContain("site-user");
    expect(serialized).toContain("9364");
  });

  it("throws when BrowserStack credentials are not set", async () => {
    await expect(new AccessibilityAuthConfig().getAuthConfig(9364)).rejects.toThrow(
      /credentials are not set/,
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
