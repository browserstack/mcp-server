import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import {
  callCapability,
  CapabilityUnavailableError,
  resetCapabilityRegistryForTests,
} from "../../src/tools/capability-registry/call";
import { invoke } from "../../src/tools/capability-registry/resolve";

vi.mock("../../src/tools/capability-registry/resolve", () => ({
  invoke: vi.fn(),
}));
vi.mock(
  "../../src/tools/capability-registry/config",
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    resolveBaseUrl: vi.fn(
      async () => "https://api-observability.browserstack.com",
    ),
  }),
);

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};

describe("callCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCapabilityRegistryForTests();
  });
  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_DISABLED;
  });

  it("calls the build-number capability from the shipped TRA index", async () => {
    (invoke as Mock).mockResolvedValue({
      ok: true,
      completed: true,
      http_response: { status: 200, body: { buildId: "b1" } },
    });

    const result = await callCapability(
      "tra",
      "get_build_id_from_build_coordinates",
      {
        query: {
          projectNormalisedName: "P",
          buildNormalisedName: "n",
          buildSerialId: 2,
        },
      },
      config,
    );

    expect(result.http_response.body).toEqual({ buildId: "b1" });
    const [capability, args, baseUrl, credentials, , auth, product] = (
      invoke as Mock
    ).mock.calls[0];
    expect(capability.path).toBe("/api/v1/builds/getBuildIdFromBuildInfo");
    expect(args.query.buildSerialId).toBe(2);
    expect(baseUrl).toBe("https://api-observability.browserstack.com");
    expect(credentials).toEqual({ username: "user", accessKey: "key" });
    expect(auth).toEqual({ type: "oauth2" });
    expect(product).toBe("tra");
  });

  it("refuses when the registry is disabled", async () => {
    process.env.CAPABILITY_REGISTRY_DISABLED = "true";

    await expect(
      callCapability("tra", "get_build_id_from_build_coordinates", {}, config),
    ).rejects.toBeInstanceOf(CapabilityUnavailableError);
    expect(invoke).not.toHaveBeenCalled();
  });
});
