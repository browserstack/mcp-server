import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { resolveAppAutomateBuildId } from "../../src/tools/failurelogs-utils/resolve-app-build-id";
import { apiClient } from "../../src/lib/apiClient";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: () => "user:key",
}));
vi.mock("../../src/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};

const BUILD_ID = "001a4e3bced4a35275f5e39160a205fbcd2ba65b";

describe("resolveAppAutomateBuildId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the build id reported by the session", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: { automation_session: { build_hashed_id: BUILD_ID } },
    });

    await expect(resolveAppAutomateBuildId("sess-1", config)).resolves.toBe(
      BUILD_ID,
    );
  });

  it("requests the session detail endpoint with an encoded session id", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: { automation_session: { build_hashed_id: BUILD_ID } },
    });

    await resolveAppAutomateBuildId("sess/1", config);

    expect((apiClient.get as Mock).mock.calls[0][0].url).toBe(
      "https://api.browserstack.com/app-automate/sessions/sess%2F1.json",
    );
  });

  it("returns undefined when the session cannot be fetched", async () => {
    (apiClient.get as Mock).mockResolvedValue({ ok: false, status: 404 });

    await expect(
      resolveAppAutomateBuildId("missing", config),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["the field is absent", { automation_session: {} }],
    ["the field is blank", { automation_session: { build_hashed_id: "  " } }],
    ["the field is not a string", { automation_session: { build_hashed_id: 42 } }],
    ["the payload has no session", {}],
  ])("returns undefined when %s", async (_label, data) => {
    (apiClient.get as Mock).mockResolvedValue({ ok: true, status: 200, data });

    await expect(
      resolveAppAutomateBuildId("sess-1", config),
    ).resolves.toBeUndefined();
  });
});
