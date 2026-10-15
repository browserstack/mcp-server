import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { apiClient } from "../../src/lib/apiClient";
import { fetchAutomationScreenshots } from "../../src/tools/automate-utils/fetch-screenshots";
import { SessionType } from "../../src/lib/constants";

vi.mock("../../src/index", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "user:key"),
}));

vi.mock("../../src/config", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, REMOTE_MCP: true } };
});

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
} as any;

const HUGE_BYTES = 30 * 1024 * 1024;

// The parser only accepts allowlisted https hosts, so the log carries real
// BrowserStack URLs and the apiClient spy routes them to the local server.
const HUGE_URL = "https://automate.browserstack.com/s3-debug/huge.png";
const SMALL_URL = "https://automate.browserstack.com/s3-debug/small.png";

const LOCAL_PATH: Record<string, string> = {
  [HUGE_URL]: "/huge.png",
  [SMALL_URL]: "/small.png",
};

// Mirrors the SeleniumHub log shape: a timestamped REQUEST followed by its RESPONSE.
function screenshotLog(urls: string[]): string {
  return urls
    .map(
      (u, i) =>
        `2026-10-15 10:0:${i}:100 REQUEST [abc] GET /session/sid/screenshot\n` +
        `2026-10-15 10:0:${i}:200 RESPONSE {"value":"${u}"}`,
    )
    .join("\n");
}

describe("fetchAutomationScreenshots with oversized downloads", () => {
  let server: http.Server;
  let base: string;
  let logsBody = "";
  const bytesSent: Record<string, number> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/logs") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(logsBody);
        return;
      }
      if (req.url === "/small.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from("small-png"));
        return;
      }
      // /huge.png and /huge-logs stream 30 MB unless the client aborts first
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      const chunk = Buffer.alloc(64 * 1024, 1);
      let sent = 0;
      const write = () => {
        while (sent < HUGE_BYTES) {
          sent += chunk.length;
          bytesSent[req.url!] = sent;
          if (!res.write(chunk)) return void res.once("drain", write);
        }
        res.end();
      };
      res.on("error", () => {});
      write();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  afterEach(() => vi.restoreAllMocks());

  function routeLogsTo(path: string) {
    const realGet = Object.getPrototypeOf(apiClient).get.bind(apiClient);
    vi.spyOn(apiClient, "get").mockImplementation((opts) =>
      realGet({
        ...opts,
        url: opts.url.endsWith("/logs")
          ? `${base}${path}`
          : `${base}${LOCAL_PATH[opts.url] ?? opts.url}`,
      }),
    );
  }

  it("skips an oversized screenshot, aborts its download, and returns the rest", async () => {
    logsBody = screenshotLog([HUGE_URL, SMALL_URL]);
    routeLogsTo("/logs");

    const shots = await fetchAutomationScreenshots(
      "sid",
      SessionType.Automate,
      config,
    );

    expect(shots).toEqual([
      {
        url: SMALL_URL,
        base64: Buffer.from("small-png").toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(bytesSent["/huge.png"]).toBeLessThan(HUGE_BYTES);
  });

  it("throws a too-large error when every screenshot is oversized", async () => {
    logsBody = screenshotLog([HUGE_URL]);
    routeLogsTo("/logs");

    await expect(
      fetchAutomationScreenshots("sid", SessionType.Automate, config),
    ).rejects.toThrow(/screenshots in this session are too large/);
  });

  it("throws a too-large error for oversized session logs", async () => {
    routeLogsTo("/huge-logs");

    await expect(
      fetchAutomationScreenshots("sid", SessionType.Automate, config),
    ).rejects.toThrow(/logs for this session are too large/);
    expect(bytesSent["/huge-logs"]).toBeLessThan(HUGE_BYTES);
  });

  it("does not cap screenshot downloads for local (non-remote) servers", async () => {
    vi.resetModules();
    vi.doMock("../../src/config", async (importOriginal) => {
      const actual: any = await importOriginal();
      return { default: { ...actual.default, REMOTE_MCP: false } };
    });
    const { MAX_SCREENSHOT_BYTES } =
      await import("../../src/tools/automate-utils/fetch-screenshots");
    expect(MAX_SCREENSHOT_BYTES).toBeUndefined();
  });
});
