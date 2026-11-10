import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import JSZip from "jszip";
import { apiClient } from "../../src/lib/apiClient";
import { AppAutomateLogType, SessionType } from "../../src/lib/constants";
import {
  findFrameworkBuild,
  frameworkSessions,
  isBrowserStackUrl,
} from "../../src/tools/appautomate-utils/framework-builds";
import { retrieveFrameworkLogs } from "../../src/tools/failurelogs-utils/framework";
import {
  fetchAutomationScreenshots,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_ZIP_ENTRIES,
  readEntryCapped,
} from "../../src/tools/automate-utils/fetch-screenshots";
import { listSessionIdsTool } from "../../src/tools/automate";
import { getFailureLogs } from "../../src/tools/get-failure-logs";

vi.mock("../../src/lib/apiClient", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: () => "user:key",
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/image", () => ({
  maybeCompressBase64: async (b: string) => b,
}));
vi.mock("../../src/tools/failurelogs-utils/resolve-app-build-id", () => ({
  resolveAppAutomateBuildId: vi.fn(async () => BUILD),
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};
const BUILD = "f00d000000000000000000000000000000000001";
const SESSION = "5e55000000000000000000000000000000000001";
const ok = (data: unknown) => ({ ok: true, status: 200, data });
const notFound = { ok: false, status: 404, statusText: "Not Found", data: {} };

// Shapes recorded from live Maestro / XCUITest builds.
const maestroBuild = {
  id: BUILD,
  framework: "maestro",
  devices: [
    {
      device: "Google Pixel 8",
      os: "android",
      os_version: "14.0",
      sessions: [{ id: SESSION, status: "failed" }],
    },
  ],
};
const maestroSession = {
  id: SESSION,
  testcases: {
    data: [
      {
        class: "flows",
        testcases: [
          {
            name: "login-flow",
            status: "passed",
            maestro_log: "https://api.browserstack.com/logs/pass.txt",
            screenshots: "https://api.browserstack.com/shots/pass.zip",
          },
          {
            name: "checkout-flow",
            status: "failed",
            crash_logs_count: 1,
            maestro_log: "https://api.browserstack.com/logs/fail.txt",
            screenshots: "https://api.browserstack.com/shots/fail.zip",
          },
        ],
      },
    ],
  },
};

/** Route by URL: only the Maestro framework knows the build. */
function routeMaestro(extra: (url: string) => unknown = () => undefined) {
  (apiClient.get as Mock).mockImplementation(async ({ url }) => {
    const answer = extra(url);
    if (answer) return answer;
    if (url.endsWith(`/maestro/v2/builds/${BUILD}`)) return ok(maestroBuild);
    if (url.endsWith(`/maestro/v2/builds/${BUILD}/sessions/${SESSION}`))
      return ok(maestroSession);
    if (url.includes("/v2/")) return notFound;
    throw new Error(`unexpected url ${url}`);
  });
}

describe("findFrameworkBuild", () => {
  beforeEach(() => vi.resetAllMocks());

  it("asks all five frameworks at once and returns the one that knows the build", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) =>
      url.includes("/xcuitest/v2/") ? ok({ id: BUILD, devices: [] }) : notFound,
    );

    const build = await findFrameworkBuild(BUILD, config);

    expect(build?.framework.name).toBe("xcuitest");
    expect(apiClient.get).toHaveBeenCalledTimes(5);
  });

  it("returns undefined after five 404s, for an ordinary Appium build", async () => {
    (apiClient.get as Mock).mockResolvedValue(notFound);

    await expect(findFrameworkBuild(BUILD, config)).resolves.toBeUndefined();
    expect(apiClient.get).toHaveBeenCalledTimes(5);
  });

  it("treats a failed lookup on another framework as 'not this framework'", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) => {
      if (url.includes("/maestro/v2/")) return ok(maestroBuild);
      if (url.includes("/flutter-integration-tests/v2/ios/"))
        return { ok: false, status: 403, statusText: "Forbidden", data: {} };
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        data: {},
      };
    });

    await expect(findFrameworkBuild(BUILD, config)).resolves.toMatchObject({
      framework: { name: "maestro" },
    });
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    await expect(findFrameworkBuild(BUILD, config)).resolves.toBeUndefined();
  });
});

describe("frameworkSessions", () => {
  it("flattens devices and sessions into session records", () => {
    expect(
      frameworkSessions({
        framework: { name: "maestro", path: "maestro/v2" },
        buildId: BUILD,
        data: maestroBuild,
      }),
    ).toEqual([
      {
        sessionId: SESSION,
        status: "failed",
        os: "android",
        osVersion: "14.0",
        device: "Google Pixel 8",
        browserUrl: `https://app-automate.browserstack.com/dashboard/v2/builds/${BUILD}/sessions/${SESSION}`,
      },
    ]);
  });
});

describe("isBrowserStackUrl", () => {
  it("allows only https BrowserStack hosts", () => {
    expect(isBrowserStackUrl("https://api.browserstack.com/x")).toBe(true);
    expect(isBrowserStackUrl("https://browserstack.com.evil.io/x")).toBe(false);
    expect(isBrowserStackUrl("http://api.browserstack.com/x")).toBe(false);
    expect(isBrowserStackUrl(42)).toBe(false);
  });
});

describe("retrieveFrameworkLogs", () => {
  beforeEach(() => vi.resetAllMocks());
  const build = {
    framework: { name: "maestro", path: "maestro/v2" } as const,
    buildId: BUILD,
    data: maestroBuild,
  };

  it("returns the failed test's log first, from its link", async () => {
    routeMaestro((url) =>
      url.endsWith("fail.txt")
        ? ok("step 1\nAssertion failed: button not visible")
        : url.endsWith("pass.txt")
          ? ok("all good")
          : undefined,
    );

    const text = await retrieveFrameworkLogs(
      build,
      SESSION,
      AppAutomateLogType.AppiumLogs,
      config,
    );

    expect(text.indexOf("checkout-flow (failed)")).toBeLessThan(
      text.indexOf("login-flow (passed)"),
    );
    expect(text).toContain("Assertion failed: button not visible");
    expect(text).toContain("UNTRUSTED");
    const fetched = (apiClient.get as Mock).mock.calls.find(([r]) =>
      r.url.endsWith("fail.txt"),
    )![0];
    expect(fetched.headers.Authorization).toMatch(/^Basic /);
  });

  it("reports crash counts without downloading anything", async () => {
    routeMaestro();

    const text = await retrieveFrameworkLogs(
      build,
      SESSION,
      AppAutomateLogType.CrashLogs,
      config,
    );

    expect(text).toContain("checkout-flow (failed): 1");
  });

  it("says which logs exist when the requested one does not", async () => {
    routeMaestro();

    const text = await retrieveFrameworkLogs(
      build,
      SESSION,
      AppAutomateLogType.DeviceLogs,
      config,
    );

    expect(text).toMatch(/no deviceLogs[\s\S]*maestro_log, screenshots/);
  });
});

describe("fetchAutomationScreenshots on a Maestro session", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads the failed test's screenshot zip when the generic logs 404", async () => {
    const zip = new JSZip();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    zip.file("screenshot-1.png", png);
    zip.file("screenshot-2.png", png);
    zip.file("notes.txt", "not an image");
    const zipped = await zip.generateAsync({ type: "nodebuffer" });

    routeMaestro((url) => {
      if (url.endsWith(`/app-automate/sessions/${SESSION}/logs`))
        return notFound;
      if (url.endsWith("fail.zip")) return ok(zipped);
      return undefined;
    });

    const shots = await fetchAutomationScreenshots(
      SESSION,
      SessionType.AppAutomate,
      config,
    );

    expect(shots).toHaveLength(2);
    expect(shots[0].url).toBe(
      "https://api.browserstack.com/shots/fail.zip#screenshot-1.png",
    );
    expect(shots[0].mimeType).toBe("image/png");
  });

  it("keeps the original error for an Appium session", async () => {
    (apiClient.get as Mock).mockResolvedValue(notFound);

    await expect(
      fetchAutomationScreenshots(SESSION, SessionType.AppAutomate, config),
    ).rejects.toThrow(/Invalid session ID/);
  });
});

describe("tools on a framework build", () => {
  beforeEach(() => vi.resetAllMocks());

  it("listSessions lists a Maestro build's sessions when the generic list is empty", async () => {
    routeMaestro((url) =>
      url.endsWith(`/app-automate/builds/${BUILD}/sessions.json`)
        ? ok([])
        : undefined,
    );

    const result = await listSessionIdsTool(
      { sessionType: SessionType.AppAutomate, buildId: BUILD },
      config,
    );

    const sessions = JSON.parse(result.content[0].text as string);
    expect(sessions[0]).toMatchObject({ sessionId: SESSION, status: "failed" });
    expect(result.content.map((c: any) => c.text).join("\n")).toContain(
      "ran through the maestro framework API",
    );
  });

  it("getFailureLogs falls back to the framework session when generic logs 404", async () => {
    routeMaestro((url) => {
      if (url.endsWith("/appiumlogs")) return notFound;
      if (url.endsWith("fail.txt"))
        return ok("Assertion failed: button not visible");
      if (url.endsWith("pass.txt")) return ok("ok");
      return undefined;
    });

    const result = await getFailureLogs(
      {
        sessionId: SESSION,
        sessionType: SessionType.AppAutomate,
        logTypes: [AppAutomateLogType.AppiumLogs],
      },
      config,
    );

    const text = result.content.map((c: any) => c.text).join("\n");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("maestro framework API");
    expect(text).toContain("Assertion failed: button not visible");
  });

  it("getFailureLogs makes no framework calls for an Appium session", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) => {
      if (url.endsWith("/appiumlogs")) return ok("appium log line");
      throw new Error(`unexpected url ${url}`);
    });

    await getFailureLogs(
      {
        sessionId: SESSION,
        sessionType: SessionType.AppAutomate,
        logTypes: [AppAutomateLogType.AppiumLogs],
      },
      config,
    );

    expect(
      (apiClient.get as Mock).mock.calls.some(([r]) => r.url.includes("/v2/")),
    ).toBe(false);
  });
});

describe("Maestro screenshot memory limits", () => {
  beforeEach(() => vi.resetAllMocks());

  async function shotsFrom(zip: JSZip) {
    const zipped = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    routeMaestro((url) => {
      if (url.endsWith(`/app-automate/sessions/${SESSION}/logs`))
        return notFound;
      if (url.endsWith("fail.zip")) return ok(zipped);
      return undefined;
    });
    return fetchAutomationScreenshots(SESSION, SessionType.AppAutomate, config);
  }

  it("stops inflating an entry at the cap, whatever its compressed size", async () => {
    const zip = new JSZip();
    // 3 MB of zeros compresses to a few KB: the real size must be what counts.
    zip.file("big.png", Buffer.alloc(3 * 1024 * 1024));
    const loaded = await JSZip.loadAsync(
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    const entry = loaded.file("big.png")!;

    await expect(readEntryCapped(entry, 1024 * 1024)).resolves.toBeNull();
    await expect(readEntryCapped(entry, 4 * 1024 * 1024)).resolves.toHaveLength(
      3 * 1024 * 1024,
    );
  });

  it("skips images over the per-image limit", async () => {
    const zip = new JSZip();
    zip.file("1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    zip.file("2.png", Buffer.alloc(MAX_IMAGE_BYTES + 1));

    const shots = await shotsFrom(zip);

    expect(shots.map((s) => s.url.split("#")[1])).toEqual(["1.png"]);
  });

  it("stops at the total budget across images", async () => {
    const zip = new JSZip();
    const size = Math.floor(MAX_TOTAL_IMAGE_BYTES / 3) + 1;
    for (let i = 1; i <= 4; i++) zip.file(`${i}.png`, Buffer.alloc(size));

    const shots = await shotsFrom(zip);

    expect(shots.length).toBeLessThan(4);
    expect(shots.length).toBeGreaterThan(0);
  });

  it("refuses an archive with too many files", async () => {
    const zip = new JSZip();
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) zip.file(`${i}.png`, "x");

    await expect(shotsFrom(zip)).rejects.toThrow(/too many files/);
  });
});

describe("review follow-ups", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps a non-404 screenshot error and makes no framework calls", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      data: {},
    });

    await expect(
      fetchAutomationScreenshots(SESSION, SessionType.AppAutomate, config),
    ).rejects.toThrow();
    expect(
      (apiClient.get as Mock).mock.calls.some(([r]) => r.url.includes("/v2/")),
    ).toBe(false);
  });

  it("keeps the original screenshot error when the framework check fails", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) =>
      url.endsWith("/logs")
        ? notFound
        : {
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            data: {},
          },
    );

    await expect(
      fetchAutomationScreenshots(SESSION, SessionType.AppAutomate, config),
    ).rejects.toThrow(/Invalid session ID/);
  });

  it("listSessions honours limit, offset and a status filter in any case", async () => {
    const many = {
      ...maestroBuild,
      devices: [
        {
          device: "Pixel",
          os: "android",
          os_version: "14.0",
          sessions: [
            { id: "s1", status: "failed" },
            { id: "s2", status: "passed" },
            { id: "s3", status: "failed" },
            { id: "s4", status: "failed" },
          ],
        },
      ],
    };
    (apiClient.get as Mock).mockImplementation(async ({ url }) => {
      if (url.endsWith(`/app-automate/builds/${BUILD}/sessions.json`))
        return ok([]);
      if (url.endsWith(`/maestro/v2/builds/${BUILD}`)) return ok(many);
      return notFound;
    });

    const result = await listSessionIdsTool(
      {
        sessionType: SessionType.AppAutomate,
        buildId: BUILD,
        status: "FAILED",
        limit: 1,
        offset: 1,
      },
      config,
    );

    expect(
      JSON.parse(result.content[0].text as string).map((s: any) => s.sessionId),
    ).toEqual(["s3"]);
  });
});
