import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import { SessionType } from "../../src/lib/constants";
import { HttpError } from "../../src/lib/error";
import {
  BuildLookupError,
  parseBuildUrl,
  resolveBuild,
} from "../../src/tools/rca-agent-utils/resolve-build";
import {
  resolveTraBuildIdFromHashed,
  TraBuildNotFoundError,
} from "../../src/tools/automate-utils/resolve-tra-build-id";
import {
  callCapability,
  CapabilityUnavailableError,
} from "../../src/tools/capability-registry/call";

vi.mock("../../src/lib/apiClient", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: () => "user:key",
}));
vi.mock("../../src/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/tools/rca-agent-utils/constants", () => ({
  getAutomationBaseUrl: () => "https://api-automation.browserstack.com",
}));
vi.mock("../../src/tools/capability-registry/call", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  callCapability: vi.fn(),
}));
vi.mock(
  "../../src/tools/automate-utils/resolve-tra-build-id",
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    resolveTraBuildIdFromHashed: vi.fn(),
  }),
);

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};

const TRA_ID = "zz00000000000000000000000000000000000003";
const HASHED = "aa00000000000000000000000000000000000001";

const ok = (data: unknown) => ({ ok: true, status: 200, data });
const notFound = { ok: false, status: 404, statusText: "Not Found", data: {} };

/** Answers /builds/latest by SDK build name; any other URL is unexpected. */
function routeLatest(latest: Record<string, string>) {
  (apiClient.get as Mock).mockImplementation(async ({ url, params }) => {
    if (url.endsWith("/ext/v1/builds/latest")) {
      const id = latest[params.build_name];
      return id ? ok({ build_id: id }) : notFound;
    }
    throw new Error(`unexpected url ${url}`);
  });
}

const PROJECT = "Sample Project";

describe("parseBuildUrl", () => {
  it("reads project, dashboard name and number from a TRA link", () => {
    expect(
      parseBuildUrl(
        "https://observability.browserstack.com/projects/Sample+Project/builds/junit/3?tab=tests",
      ),
    ).toEqual({
      projectName: "Sample Project",
      buildName: "junit",
      buildNumber: 3,
    });
  });

  it("reads a TRA link without a build number", () => {
    expect(
      parseBuildUrl(
        "https://observability.browserstack.com/projects/My%20App/builds/nightly%20run",
      ),
    ).toEqual({ projectName: "My App", buildName: "nightly run" });
  });

  it("reads the hashed id and product from Automate links", () => {
    expect(
      parseBuildUrl(
        `https://automate.browserstack.com/dashboard/v2/builds/${HASHED}/sessions/abc`,
      ),
    ).toEqual({ hashedBuildId: HASHED, sessionType: SessionType.Automate });
    expect(
      parseBuildUrl(
        `https://app-automate.browserstack.com/dashboard/v2/builds/${HASHED}`,
      ),
    ).toEqual({ hashedBuildId: HASHED, sessionType: SessionType.AppAutomate });
  });

  it("accepts bare ids and rejects text it cannot read", () => {
    expect(parseBuildUrl(TRA_ID)).toEqual({ traBuildId: TRA_ID });
    expect(parseBuildUrl(HASHED)).toEqual({ hashedBuildId: HASHED });
    expect(parseBuildUrl("my build")).toBeUndefined();
    expect(parseBuildUrl("https://example.com/nothing")).toBeUndefined();
  });
});

describe("resolveBuild", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the latest run for the SDK build name in one request", async () => {
    routeLatest({ "unit-tests-ci-1234": TRA_ID });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT,
          browserStackBuildName: "unit-tests-ci-1234",
        },
        config,
      ),
    ).resolves.toEqual({ buildId: TRA_ID });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("explains the name mismatch after one request instead of searching", async () => {
    routeLatest({});

    await expect(
      resolveBuild(
        { browserStackProjectName: PROJECT, browserStackBuildName: "junit" },
        config,
      ),
    ).rejects.toThrow(
      /matches the name from browserstack.yml[\s\S]*build number or dashboard link/,
    );
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  const capabilityAnswer = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    completed: true,
    http_response: { status, body },
  });

  it("resolves a build number through the capability in one call", async () => {
    (callCapability as Mock).mockResolvedValue(
      capabilityAnswer(200, {
        buildId: "zz00000000000000000000000000000000000002",
      }),
    );

    const result = await resolveBuild(
      {
        browserStackProjectName: PROJECT,
        browserStackBuildName: "junit",
        buildNumber: 2,
      },
      config,
    );

    expect(result.buildId).toBe("zz00000000000000000000000000000000000002");
    expect(callCapability).toHaveBeenCalledWith(
      "tra",
      "get_build_id_from_build_coordinates",
      {
        query: {
          projectNormalisedName: PROJECT,
          buildNormalisedName: "junit",
          buildSerialId: 2,
        },
      },
      config,
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("reads project, name and number from TRA and Automate project links", async () => {
    (callCapability as Mock).mockResolvedValue(
      capabilityAnswer(200, {
        buildId: "aa000000000000000000000000000000000000b1",
      }),
    );

    const result = await resolveBuild(
      {
        buildUrl:
          "https://automate.browserstack.com/projects/Mobile+App/builds/Checkout+flow++smoke/1022",
      },
      config,
    );

    expect(result.buildId).toBe("aa000000000000000000000000000000000000b1");
    expect((callCapability as Mock).mock.calls[0][2]).toEqual({
      query: {
        projectNormalisedName: "Mobile App",
        buildNormalisedName: "Checkout flow  smoke",
        buildSerialId: 1022,
      },
    });
  });

  it("explains which name to use when no build has that name and number", async () => {
    (callCapability as Mock).mockResolvedValue(capabilityAnswer(404, null));

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT,
          browserStackBuildName: "unit-tests-ci-1234",
          buildNumber: 3,
        },
        config,
      ),
    ).rejects.toThrow(
      /No build #3 named[\s\S]*build name shown on the dashboard/,
    );
  });

  it("returns a clear error when the capability registry is off", async () => {
    (callCapability as Mock).mockRejectedValue(
      new CapabilityUnavailableError(
        "the capability registry is disabled on this server",
      ),
    );

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT,
          browserStackBuildName: "junit",
          buildNumber: 2,
        },
        config,
      ),
    ).rejects.toThrow(/not available here[\s\S]*TRA build id/);
  });

  it("surfaces a server error from the capability", async () => {
    (callCapability as Mock).mockResolvedValue(
      capabilityAnswer(503, { message: "down" }),
    );

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT,
          browserStackBuildName: "junit",
          buildNumber: 2,
        },
        config,
      ),
    ).rejects.toThrow(/503/);
  });

  it("looks up the latest run for a project link without a number", async () => {
    routeLatest({ junit: TRA_ID });

    await expect(
      resolveBuild(
        {
          buildUrl:
            "https://observability.browserstack.com/projects/Sample+Project/builds/junit",
        },
        config,
      ),
    ).resolves.toEqual({ buildId: TRA_ID });
  });

  it("prefers the caller's own build, then anyone's, for getBuildId", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ params }) =>
      params.user_name ? notFound : ok({ build_id: TRA_ID }),
    );

    const result = await resolveBuild(
      { browserStackProjectName: PROJECT, browserStackBuildName: "b" },
      config,
      { userName: "user" },
    );

    expect(result).toEqual({
      buildId: TRA_ID,
      note: expect.stringContaining("latest run by anyone"),
    });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("maps an Automate build link to its TRA build", async () => {
    (resolveTraBuildIdFromHashed as Mock).mockResolvedValue({
      traBuildId: TRA_ID,
      hashedBuildId: HASHED,
      sessionType: SessionType.AppAutomate,
      projectName: "P",
      buildName: "B",
    });

    const result = await resolveBuild(
      {
        buildUrl: `https://app-automate.browserstack.com/dashboard/v2/builds/${HASHED}`,
      },
      config,
    );

    expect(resolveTraBuildIdFromHashed).toHaveBeenCalledWith(
      HASHED,
      config,
      SessionType.AppAutomate,
    );
    expect(result).toMatchObject({
      buildId: TRA_ID,
      note: expect.stringContaining("listSessions takes either id"),
    });
  });

  it("returns the hashed id with the reason when the Automate build has no TRA build", async () => {
    (resolveTraBuildIdFromHashed as Mock).mockRejectedValue(
      new TraBuildNotFoundError(
        "only runs through the BrowserStack SDK report tests to TRA",
      ),
    );

    const result = await resolveBuild({ buildUrl: HASHED }, config);

    expect(result).toMatchObject({
      buildId: HASHED,
      note: expect.stringContaining(
        "listTestIds and fetchRCA need a TRA build id",
      ),
    });
  });

  it("surfaces a server error instead of returning the Automate id as a TRA id", async () => {
    (resolveTraBuildIdFromHashed as Mock).mockRejectedValue(
      new HttpError(
        "Failed to read automate build: 503 Service Unavailable",
        503,
      ),
    );

    await expect(
      resolveBuild(
        {
          buildUrl: `https://automate.browserstack.com/dashboard/v2/builds/${HASHED}`,
        },
        config,
      ),
    ).rejects.toThrow(/503/);
  });

  it("asks for both names when either is missing", async () => {
    await expect(
      resolveBuild({ browserStackBuildName: "junit" }, config),
    ).rejects.toThrow(BuildLookupError);
    await expect(
      resolveBuild({ browserStackProjectName: PROJECT }, config),
    ).rejects.toThrow(/browserStackBuildName/);
    await expect(
      resolveBuild({ buildUrl: "https://example.com/x" }, config),
    ).rejects.toThrow(/Could not read a build from that link/);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("retries a dropped connection once", async () => {
    (apiClient.get as Mock)
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(ok({ build_id: TRA_ID }));

    await expect(
      resolveBuild(
        { browserStackProjectName: "P", browserStackBuildName: "b" },
        config,
      ),
    ).resolves.toEqual({ buildId: TRA_ID });
  });
});
