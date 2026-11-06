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

const TRA_ID = "jlcb5jo8xakocnjyll3n10b1rx5sqnrprh3y6zsp";
const HASHED = "df9fde1187c547ea157e6e683289ed17ad58452c";

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

const PROJECT = "Checking Project Name";

describe("parseBuildUrl", () => {
  it("reads project, dashboard name and number from a TRA link", () => {
    expect(
      parseBuildUrl(
        "https://observability.browserstack.com/projects/Checking+Project+Name/builds/junit/3?tab=tests",
      ),
    ).toEqual({
      projectName: "Checking Project Name",
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
    routeLatest({ "patc204-junit-105mb": TRA_ID });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT,
          browserStackBuildName: "patc204-junit-105mb",
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

  it("hands a build number to the capability without calling any API", async () => {
    const result = await resolveBuild(
      {
        browserStackProjectName: PROJECT,
        browserStackBuildName: "junit",
        buildNumber: 2,
      },
      config,
    );

    expect(result).toMatchObject({
      capability: {
        name: "get_build_id_from_build_coordinates",
        product: "tra",
        query: {
          projectNormalisedName: PROJECT,
          buildNormalisedName: "junit",
          buildSerialId: 2,
        },
      },
    });
    expect("note" in result && result.note).toContain("call invokeCapability");
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("hands TRA and Automate dashboard project links to the capability", async () => {
    for (const link of [
      "https://observability.browserstack.com/projects/Checking+Project+Name/builds/junit/2",
      "https://automate.browserstack.com/projects/Default+Project+4/builds/TC-LCA+agentic+run++default/1022",
    ]) {
      const result = await resolveBuild({ buildUrl: link }, config);
      expect(result).toHaveProperty(
        "capability.name",
        "get_build_id_from_build_coordinates",
      );
    }
    const automate = await resolveBuild(
      {
        buildUrl:
          "https://automate.browserstack.com/projects/Default+Project+4/builds/TC-LCA+agentic+run++default/1022",
      },
      config,
    );
    expect(automate).toHaveProperty("capability.query", {
      projectNormalisedName: "Default Project 4",
      buildNormalisedName: "TC-LCA agentic run  default",
      buildSerialId: 1022,
    });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("looks up the latest run for a project link without a number", async () => {
    routeLatest({ junit: TRA_ID });

    await expect(
      resolveBuild(
        {
          buildUrl:
            "https://observability.browserstack.com/projects/Checking+Project+Name/builds/junit",
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
