import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { apiClient } from "../../src/lib/apiClient";
import { getFailureLogs } from "../../src/tools/get-failure-logs";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "user:key"),
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
} as any;

const deviceLog = [
  "01-01 10:00:00.000 I/AnalyticsInterceptor: click event tile_42",
  "01-01 10:00:01.000 E/AndroidRuntime: ERROR something broke",
  "01-01 10:00:02.000 D/AnalyticsInterceptor: impression event banner_7",
  "01-01 10:00:03.000 W/Other: harmless",
].join("\n");

describe("getFailureLogs deviceLogFilter", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(deviceLog);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    const realGet = Object.getPrototypeOf(apiClient).get.bind(apiClient);
    vi.spyOn(apiClient, "get").mockImplementation((opts) =>
      realGet({ ...opts, url: `${base}/devicelogs` }),
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  const run = (deviceLogFilter?: string) =>
    getFailureLogs(
      {
        sessionId: "sid",
        buildId: "bid",
        sessionType: "app-automate" as any,
        logTypes: ["deviceLogs"] as any,
        deviceLogFilter,
      },
      config,
    );

  it("returns only lines matching the filter, case-insensitively", async () => {
    const result = await run("AnalyticsInterceptor");
    const text = result.content[0].text as string;

    expect(text).toContain('Device Logs matching "AnalyticsInterceptor" (2 found):');
    expect(text).toContain("click event tile_42");
    expect(text).toContain("impression event banner_7");
    expect(text).not.toContain("ERROR something broke");
  });

  it("keeps the error-keyword output when no filter is given", async () => {
    const result = await run();
    const text = result.content[0].text as string;

    expect(text).toContain("Device Failures (1 found):");
    expect(text).toContain("ERROR something broke");
    expect(text).not.toContain("AnalyticsInterceptor");
  });

  it("returns a no-match message when the filter matches nothing", async () => {
    const result = await run("NoSuchTag");

    expect(result.content[0].text).toBe('No device log lines matching "NoSuchTag"');
  });
});
