import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import { SessionType } from "../../src/lib/constants";
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

// Real rows from the "Checking Project Name" project: the dashboard shows
// "junit", the SDK sent a size-suffixed name, and each run has its own number.
const JUNIT_ROWS = [
  {
    build_id: "yeym4xchfkryrxfpl8wjifacddkbs7wqeuscb2ze",
    name: "junit",
    original_name: "patc204-junit-21mb",
    build_number: 1,
    started_at: "2026-08-21T10:00:00.000+00:00",
    status: "passed",
  },
  {
    build_id: "e9tdlmcerew3j7bbob4ghuvfuu6aztjrm7pm0rkl",
    name: "junit",
    original_name: "patc204-junit-25mb",
    build_number: 2,
    started_at: "2026-08-21T10:00:00.000+00:00",
    status: "passed",
  },
  {
    build_id: TRA_ID,
    name: "junit",
    original_name: "patc204-junit-105mb",
    build_number: 3,
    started_at: "2026-08-21T10:00:00.000+00:00",
    status: "passed",
    observability_url:
      "https://observability.browserstack.com/projects/Checking+Project+Name/builds/junit/3",
  },
];

const ok = (data: unknown) => ({ ok: true, status: 200, data });
const notFound = { ok: false, status: 404, statusText: "Not Found", data: {} };

/** Route apiClient.get by URL, the way the TRA public API answers. */
function routeTra(options: {
  latest?: Record<string, string>;
  projects?: Array<{ id: number; name: string }>;
  builds?: any[];
  automateBuilds?: { automate?: any[]; app?: any[] };
}) {
  (apiClient.get as Mock).mockImplementation(async ({ url, params }) => {
    if (url.endsWith("/ext/v1/builds/latest")) {
      const id = options.latest?.[params.build_name];
      return id ? ok({ build_id: id }) : notFound;
    }
    if (url.endsWith("/ext/v1/projects")) {
      // One page, then the empty page the API really sends at the end.
      return params?.next_page
        ? ok({ projects: [], pagination: { has_next: false } })
        : ok({
            projects: options.projects ?? [],
            pagination: { has_next: true, next_page: "p2" },
          });
    }
    if (url.endsWith("/builds.json")) {
      const product = url.includes("app-automate") ? "app" : "automate";
      return params.offset
        ? ok([])
        : ok(options.automateBuilds?.[product] ?? []);
    }
    if (/\/ext\/v1\/projects\/\d+\/builds$/.test(url)) {
      const all = options.builds ?? [];
      const rows = params.unique_build_names
        ? all.filter((b) => b.name === params.unique_build_names)
        : all;
      return ok({ builds: rows, pagination: { has_next: false } });
    }
    throw new Error(`unexpected url ${url}`);
  });
}

const PROJECT = { id: 1483919, name: "Checking Project Name" };

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

  it("returns the exact SDK-name match with no note (unchanged fast path)", async () => {
    routeTra({ latest: { "patc204-junit-105mb": TRA_ID } });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT.name,
          browserStackBuildName: "patc204-junit-105mb",
        },
        config,
      ),
    ).resolves.toEqual({ buildId: TRA_ID });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("finds the latest run by its dashboard name when the SDK name misses", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    const result = await resolveBuild(
      { browserStackProjectName: PROJECT.name, browserStackBuildName: "junit" },
      config,
    );

    expect(result.buildId).toBe(TRA_ID);
    expect(result.note).toContain('"junit" #3');
    expect(result.note).toContain('the SDK sent it as "patc204-junit-105mb"');
  });

  it("picks the requested build number", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    const result = await resolveBuild(
      {
        browserStackProjectName: "checking project name",
        browserStackBuildName: "junit",
        buildNumber: 2,
      },
      config,
    );

    expect(result.buildId).toBe("e9tdlmcerew3j7bbob4ghuvfuu6aztjrm7pm0rkl");
    // A build number skips /builds/latest, which only knows the latest run.
    const urls = (apiClient.get as Mock).mock.calls.map((c) => c[0].url);
    expect(urls.some((u: string) => u.endsWith("/builds/latest"))).toBe(false);
  });

  it("resolves a TRA dashboard link end to end", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    const result = await resolveBuild(
      {
        buildUrl:
          "https://observability.browserstack.com/projects/Checking+Project+Name/builds/junit/1",
      },
      config,
    );

    expect(result.buildId).toBe("yeym4xchfkryrxfpl8wjifacddkbs7wqeuscb2ze");
  });

  it("matches a differently cased SDK name over recent builds", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    const result = await resolveBuild(
      {
        browserStackProjectName: PROJECT.name,
        browserStackBuildName: "PATC204-JUNIT-25MB",
      },
      config,
    );

    expect(result.buildId).toBe("e9tdlmcerew3j7bbob4ghuvfuu6aztjrm7pm0rkl");
  });

  it("lists close matches instead of a bare 404", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    const error = await resolveBuild(
      {
        browserStackProjectName: PROJECT.name,
        browserStackBuildName: "patc204",
      },
      config,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(BuildLookupError);
    expect(error.message).toContain('No build named "patc204"');
    expect(error.message).toContain("Close matches");
    expect(error.message).toContain(TRA_ID);
  });

  it("names similar projects when the project is unknown", async () => {
    routeTra({ projects: [PROJECT, { id: 763, name: "Tcm Sanity" }] });

    await expect(
      resolveBuild(
        { browserStackProjectName: "Checking", browserStackBuildName: "junit" },
        config,
      ),
    ).rejects.toThrow(
      /No TRA project named "Checking" found. Similar projects: "Checking Project Name"/,
    );
  });

  it("asks for a name when a build number matches several builds", async () => {
    routeTra({
      projects: [PROJECT],
      builds: [
        ...JUNIT_ROWS,
        { ...JUNIT_ROWS[0], build_id: "other", name: "smoke", build_number: 3 },
      ],
    });

    await expect(
      resolveBuild(
        { browserStackProjectName: PROJECT.name, buildNumber: 3 },
        config,
      ),
    ).rejects.toThrow(/Several builds .* are #3; pass browserStackBuildName/);
  });

  it("returns the project's most recent build when only the project is given", async () => {
    routeTra({
      projects: [PROJECT],
      builds: [
        ...JUNIT_ROWS,
        {
          build_id: "newest",
          name: "smoke",
          build_number: 9,
          started_at: "2026-11-01T00:00:00.000+00:00",
        },
      ],
    });

    const result = await resolveBuild(
      { browserStackProjectName: PROJECT.name },
      config,
    );
    expect(result.buildId).toBe("newest");
    expect(result.note).toContain("Other recent builds");
  });

  it("prefers the caller's own build, then anyone's, for getBuildId", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ params }) =>
      params.user_name ? notFound : ok({ build_id: TRA_ID }),
    );

    const result = await resolveBuild(
      { browserStackProjectName: PROJECT.name, browserStackBuildName: "b" },
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
    expect(result.buildId).toBe(TRA_ID);
    expect(result.note).toContain("listSessions takes either id");
  });

  it("returns the hashed id with the reason when the Automate build has no TRA build", async () => {
    (resolveTraBuildIdFromHashed as Mock).mockRejectedValue(
      new TraBuildNotFoundError(
        "only runs through the BrowserStack SDK report tests to TRA",
      ),
    );

    const result = await resolveBuild({ buildUrl: HASHED }, config);

    expect(result.buildId).toBe(HASHED);
    expect(result.note).toContain(
      "listTestIds and fetchRCA need a TRA build id",
    );
  });

  it("explains what to pass when nothing identifies a project", async () => {
    await expect(
      resolveBuild({ browserStackBuildName: "junit" }, config),
    ).rejects.toThrow(/Pass browserStackProjectName/);
    await expect(
      resolveBuild({ buildUrl: "https://example.com/x" }, config),
    ).rejects.toThrow(/Could not read a build from that link/);
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

describe("resolveBuild: Automate builds TRA never saw", () => {
  beforeEach(() => vi.resetAllMocks());

  const automateBuild = (name: string, hashed: string, created: string) => ({
    automation_build: { name, hashed_id: hashed, created_at: created },
  });

  it("finds an Automate build by name when TRA has none, listing the others", async () => {
    routeTra({
      projects: [PROJECT],
      builds: JUNIT_ROWS,
      automateBuilds: {
        automate: [
          automateBuild("Smoke Suite", "a".repeat(40), "2026-10-01T00:00:00Z"),
        ],
        app: [automateBuild("smoke suite", HASHED, "2026-11-02T00:00:00Z")],
      },
    });
    (resolveTraBuildIdFromHashed as Mock).mockRejectedValue(
      new TraBuildNotFoundError(
        "has no TRA build: only runs through the BrowserStack SDK report tests to TRA.",
      ),
    );

    const result = await resolveBuild(
      {
        browserStackProjectName: PROJECT.name,
        browserStackBuildName: "smoke suite",
      },
      config,
    );
    expect(result.buildId).toBe("a".repeat(40));
    expect(result.note).toContain(
      'Found automate build "Smoke Suite" by name (first match)',
    );
    expect(result.note).toContain("has no TRA build");
    expect(result.note).toContain(`app-automate: ${HASHED}`);
  });

  it("returns the TRA id when the Automate build did report to TRA", async () => {
    routeTra({
      projects: [],
      automateBuilds: {
        automate: [automateBuild("nightly", HASHED, "2026-11-02T00:00:00Z")],
      },
    });
    (resolveTraBuildIdFromHashed as Mock).mockResolvedValue({
      traBuildId: TRA_ID,
      hashedBuildId: HASHED,
      sessionType: SessionType.Automate,
      projectName: "Other",
      buildName: "nightly",
    });

    const result = await resolveBuild(
      { browserStackBuildName: "nightly" },
      config,
    );
    expect(result.buildId).toBe(TRA_ID);
    expect(result.note).toContain("TRA build for automate build");
  });

  it("keeps the TRA explanation when no Automate build matches either", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT.name,
          browserStackBuildName: "patc204",
        },
        config,
      ),
    ).rejects.toThrow(
      /Close matches[\s\S]*None of the latest Automate or App Automate builds is named "patc204" either/,
    );
  });

  it("does not search Automate for a TRA build number", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT.name,
          browserStackBuildName: "junit",
          buildNumber: 9,
        },
        config,
      ),
    ).rejects.toThrow(BuildLookupError);
    expect(
      (apiClient.get as Mock).mock.calls.some(([req]) =>
        req.url.endsWith("/builds.json"),
      ),
    ).toBe(false);
  });
});

describe("resolveBuild: request budget", () => {
  beforeEach(() => vi.resetAllMocks());

  it("stops the project lookup after 5 pages and builds after 1", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url, params }) => {
      if (url.endsWith("/ext/v1/builds/latest")) return notFound;
      if (url.endsWith("/builds.json")) return ok([]);
      if (url.endsWith("/ext/v1/projects")) {
        // Always another page: the cap, not the data, must end the walk.
        return ok({
          projects: [{ id: Number(params?.next_page ?? 0), name: "Unrelated" }],
          pagination: {
            has_next: true,
            next_page: String(Number(params?.next_page ?? 0) + 1),
          },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: "Missing",
          browserStackBuildName: "nightly",
        },
        config,
      ),
    ).rejects.toThrow(/No TRA project named "Missing" found/);
    const urls = (apiClient.get as Mock).mock.calls.map(
      ([req]) => req.url as string,
    );
    expect(urls.filter((u) => u.endsWith("/ext/v1/projects"))).toHaveLength(5);
    expect(urls.filter((u) => u.endsWith("/builds.json"))).toHaveLength(2);
    expect(urls.length).toBeLessThanOrEqual(8);
  });

  it("reads one page of builds when a build number is not among the latest runs", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    await expect(
      resolveBuild(
        {
          browserStackProjectName: PROJECT.name,
          browserStackBuildName: "junit",
          buildNumber: 9,
        },
        config,
      ),
    ).rejects.toThrow(/no build #9 among its latest runs/);
    const buildPages = (apiClient.get as Mock).mock.calls.filter(([req]) =>
      /\/projects\/\d+\/builds$/.test(req.url),
    );
    expect(buildPages).toHaveLength(1);
  });
});

describe("resolveBuild: Automate project links", () => {
  beforeEach(() => vi.resetAllMocks());

  // The Automate dashboard serves TRA build pages, with TRA's names and numbers.
  const link =
    "https://automate.browserstack.com/projects/Checking+Project+Name/builds/junit/2";

  it("parses the link like a TRA link", () => {
    expect(parseBuildUrl(link)).toEqual({
      projectName: "Checking Project Name",
      buildName: "junit",
      buildNumber: 2,
    });
  });

  it("resolves it to the TRA build with that number", async () => {
    routeTra({ projects: [PROJECT], builds: JUNIT_ROWS });

    const result = await resolveBuild({ buildUrl: link }, config);
    expect(result.buildId).toBe("e9tdlmcerew3j7bbob4ghuvfuu6aztjrm7pm0rkl");
  });
});
