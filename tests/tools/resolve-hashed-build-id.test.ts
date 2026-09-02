import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { SessionType } from "../../src/lib/constants";
import { apiClient } from "../../src/lib/apiClient";
import {
  BUILD_LIST_PAGE_SIZE,
  buildsListUrl,
  parseObservabilityId,
  resolveHashedBuildId,
} from "../../src/tools/automate-utils/resolve-hashed-build-id";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

const OBS_ID = "81yobvicuiuozd1bncaeegvubey7rbl8naevwets";
const HASHED_A = "ca9cccc228cf0e3ff3cb90dd62e2e2bfb4b20bc7";
const HASHED_B = "3b20f82b878c120e6edc7a2b373e65d20fb3ab7c";
const HASHED_APP = "e8cde62c7e261edb013e82ac0096a650b4694b84";

function traOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    data: {
      name: "wdio-cucumber-samples",
      original_name: "wdio-cucumber-samples",
      duration: 254005,
      started_at: "2024-05-08T12:45:34.651+00:00",
      ...overrides,
    },
  };
}

function restBuilds(
  items: Array<{ name: string; hashed_id: string; duration?: number }>,
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    data: items.map((item) => ({
      automation_build: item,
    })),
  };
}

describe("parseObservabilityId", () => {
  it("trims a bare UUID", () => {
    expect(parseObservabilityId(`  ${OBS_ID}  `)).toBe(OBS_ID);
  });

  it("takes the last path segment from a dashboard URL", () => {
    expect(
      parseObservabilityId(
        `https://observability.browserstack.com/builds/${OBS_ID}`,
      ),
    ).toBe(OBS_ID);
  });

  it("throws when empty", () => {
    expect(() => parseObservabilityId("   ")).toThrow(
      /Observability ID is required/,
    );
  });
});

describe("buildsListUrl", () => {
  it("uses Automate REST host", () => {
    expect(buildsListUrl(SessionType.Automate)).toBe(
      "https://api.browserstack.com/automate/builds.json",
    );
  });

  it("uses App Automate api-cloud host", () => {
    expect(buildsListUrl(SessionType.AppAutomate)).toBe(
      "https://api-cloud.browserstack.com/app-automate/builds.json",
    );
  });
});

describe("resolveHashedBuildId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws a TRA 404 that distinguishes observability UUID from hashed dashboard ID", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      data: {},
    });

    await expect(
      resolveHashedBuildId({ observabilityId: OBS_ID }, mockConfig),
    ).rejects.toThrow(/not a hashed Automate dashboard build ID/);
  });

  it("returns a direct hashed_id from the TRA payload", async () => {
    (apiClient.get as Mock)
      .mockResolvedValueOnce(traOk({ hashed_id: HASHED_A }))
      .mockResolvedValueOnce(
        restBuilds([{ name: "other", hashed_id: HASHED_B }]),
      )
      .mockResolvedValueOnce(
        restBuilds([{ name: "wdio-cucumber-samples", hashed_id: HASHED_A }]),
      );

    const result = await resolveHashedBuildId(
      { observabilityId: ` ${OBS_ID} ` },
      mockConfig,
    );

    expect(result).toEqual({
      hashedBuildId: HASHED_A,
      sessionType: SessionType.AppAutomate,
      name: "wdio-cucumber-samples",
      observabilityId: OBS_ID,
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `https://api-automation.browserstack.com/ext/v1/builds/${OBS_ID}`,
      }),
    );
  });

  it("matches Automate REST builds by original_name", async () => {
    (apiClient.get as Mock).mockImplementation(
      async ({ url }: { url: string }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk();
        }
        if (url.includes("/automate/builds.json")) {
          return restBuilds([
            {
              name: "wdio-cucumber-samples",
              hashed_id: HASHED_A,
              duration: 254005,
            },
          ]);
        }
        if (url.includes("/app-automate/builds.json")) {
          return restBuilds([]);
        }
        throw new Error(`unexpected url ${url}`);
      },
    );

    const result = await resolveHashedBuildId(
      {
        observabilityId: `https://observability.browserstack.com/x/${OBS_ID}`,
      },
      mockConfig,
    );

    expect(result.hashedBuildId).toBe(HASHED_A);
    expect(result.sessionType).toBe(SessionType.Automate);
    expect(result.name).toBe("wdio-cucumber-samples");
    expect(result.observabilityId).toBe(OBS_ID);
  });

  it("matches Automate REST names that append a whitespace suffix", async () => {
    (apiClient.get as Mock).mockImplementation(
      async ({ url }: { url: string }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk({
            original_name:
              "jenkins-dev-devx-developer-portal-pages-developer-portal-pages-PR-6992-15",
            name: "jenkins-dev-devx-developer-portal-pages-developer-portal-pages-PR",
          });
        }
        if (url.includes("/automate/builds.json")) {
          return restBuilds([
            {
              name: "jenkins-dev-devx-developer-portal-pages-developer-portal-pages-PR-6992-15  15",
              hashed_id: HASHED_A,
            },
          ]);
        }
        return restBuilds([]);
      },
    );

    const result = await resolveHashedBuildId(
      { observabilityId: OBS_ID },
      mockConfig,
    );

    expect(result.hashedBuildId).toBe(HASHED_A);
  });

  it("searches only App Automate when sessionType is set", async () => {
    (apiClient.get as Mock).mockImplementation(
      async ({ url }: { url: string }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk();
        }
        if (url.includes("/app-automate/builds.json")) {
          return restBuilds([
            { name: "wdio-cucumber-samples", hashed_id: HASHED_APP },
          ]);
        }
        throw new Error(`should not call ${url}`);
      },
    );

    const result = await resolveHashedBuildId(
      { observabilityId: OBS_ID, sessionType: SessionType.AppAutomate },
      mockConfig,
    );

    expect(result.hashedBuildId).toBe(HASHED_APP);
    expect(result.sessionType).toBe(SessionType.AppAutomate);
    expect(apiClient.get).not.toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.browserstack.com/automate/builds.json",
      }),
    );
  });

  it("errors when both products match the same name", async () => {
    (apiClient.get as Mock).mockImplementation(
      async ({ url }: { url: string }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk();
        }
        if (url.includes("/automate/builds.json")) {
          return restBuilds([
            { name: "wdio-cucumber-samples", hashed_id: HASHED_A },
          ]);
        }
        return restBuilds([
          { name: "wdio-cucumber-samples", hashed_id: HASHED_APP },
        ]);
      },
    );

    await expect(
      resolveHashedBuildId({ observabilityId: OBS_ID }, mockConfig),
    ).rejects.toThrow(/sessionType/);
  });

  it("picks the closer duration when multiple same-name builds exist", async () => {
    (apiClient.get as Mock).mockImplementation(
      async ({ url }: { url: string }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk({ duration: 100 });
        }
        if (url.includes("/automate/builds.json")) {
          return restBuilds([
            {
              name: "wdio-cucumber-samples",
              hashed_id: HASHED_A,
              duration: 10,
            },
            {
              name: "wdio-cucumber-samples",
              hashed_id: HASHED_B,
              duration: 102,
            },
          ]);
        }
        return restBuilds([]);
      },
    );

    const result = await resolveHashedBuildId(
      { observabilityId: OBS_ID },
      mockConfig,
    );
    expect(result.hashedBuildId).toBe(HASHED_B);
  });

  it("errors when same-name matches stay ambiguous", async () => {
    (apiClient.get as Mock).mockImplementation(
      async ({ url }: { url: string }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk({ duration: undefined, started_at: undefined });
        }
        if (url.includes("/automate/builds.json")) {
          return restBuilds([
            { name: "wdio-cucumber-samples", hashed_id: HASHED_A },
            { name: "wdio-cucumber-samples", hashed_id: HASHED_B },
          ]);
        }
        return restBuilds([]);
      },
    );

    await expect(
      resolveHashedBuildId({ observabilityId: OBS_ID }, mockConfig),
    ).rejects.toThrow(new RegExp(`${HASHED_A}|${HASHED_B}`));
  });

  it("paginates REST build lists", async () => {
    const page1 = Array.from({ length: BUILD_LIST_PAGE_SIZE }, (_, i) => ({
      name: `other-${i}`,
      hashed_id:
        `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${i.toString(16)}`.slice(0, 40),
    }));

    (apiClient.get as Mock).mockImplementation(
      async ({
        url,
        params,
      }: {
        url: string;
        params?: { offset?: number };
      }) => {
        if (url.includes("/ext/v1/builds/")) {
          return traOk();
        }
        if (url.includes("/automate/builds.json")) {
          if (!params?.offset) {
            return restBuilds(page1);
          }
          return restBuilds([
            { name: "wdio-cucumber-samples", hashed_id: HASHED_A },
          ]);
        }
        return restBuilds([]);
      },
    );

    const result = await resolveHashedBuildId(
      { observabilityId: OBS_ID, sessionType: SessionType.Automate },
      mockConfig,
    );
    expect(result.hashedBuildId).toBe(HASHED_A);
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.browserstack.com/automate/builds.json",
        params: { limit: BUILD_LIST_PAGE_SIZE, offset: BUILD_LIST_PAGE_SIZE },
      }),
    );
  });
});
