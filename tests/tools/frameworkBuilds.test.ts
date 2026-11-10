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
import { fetchAutomationScreenshots } from "../../src/tools/automate-utils/fetch-screenshots";
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

  it("tries each framework once and stops at the one that knows the build", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) =>
      url.includes("/xcuitest/v2/") ? ok({ id: BUILD, devices: [] }) : notFound,
    );

    const build = await findFrameworkBuild(BUILD, config);

    expect(build?.framework.name).toBe("xcuitest");
    expect((apiClient.get as Mock).mock.calls.map(([r]) => r.url)).toEqual([
      `https://api-cloud.browserstack.com/app-automate/maestro/v2/builds/${BUILD}`,
      `https://api-cloud.browserstack.com/app-automate/espresso/v2/builds/${BUILD}`,
      `https://api-cloud.browserstack.com/app-automate/xcuitest/v2/builds/${BUILD}`,
    ]);
  });

  it("returns undefined after five 404s, for an ordinary Appium build", async () => {
    (apiClient.get as Mock).mockResolvedValue(notFound);

    await expect(findFrameworkBuild(BUILD, config)).resolves.toBeUndefined();
    expect(apiClient.get).toHaveBeenCalledTimes(5);
  });

  it("surfaces a server error instead of reading it as 'not this framework'", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    await expect(findFrameworkBuild(BUILD, config)).rejects.toThrow(/503/);
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
