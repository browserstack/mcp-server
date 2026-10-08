import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { apiClient } from "../../src/lib/apiClient";
import {
  fetchLog,
  filterLinesByKeywords,
  formatFailures,
  MAX_FAILURE_ITEMS,
  MAX_LINE_CHARS,
  MAX_LOG_BYTES,
} from "../../src/tools/failurelogs-utils/utils";
import { retrieveSessionFailures } from "../../src/tools/failurelogs-utils/automate";
import { retrieveDeviceLogs } from "../../src/tools/failurelogs-utils/app-automate";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "user:key"),
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
} as any;

const ok = (data: unknown) => ({ ok: true, status: 200, data }) as any;

describe("failure logs size caps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchLog caps the download size", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(ok("line"));
    await fetchLog("https://api.browserstack.com/x", "session logs", config);
    expect(get.mock.calls[0][0].maxContentLength).toBe(MAX_LOG_BYTES);
  });

  it("fetchLog returns a message instead of throwing when the log is too large", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(
      new Error(`maxContentLength size of ${MAX_LOG_BYTES} exceeded`),
    );
    const result = await fetchLog(
      "https://api.browserstack.com/x",
      "session logs",
      config,
    );
    expect(result).toEqual({
      message: expect.stringContaining("too large to analyze here"),
    });
  });

  it("fetchLog rethrows other errors", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      fetchLog("https://api.browserstack.com/x", "session logs", config),
    ).rejects.toThrow("ECONNRESET");
  });

  it("formatFailures caps the item count and long lines", () => {
    const items = Array.from({ length: MAX_FAILURE_ITEMS + 50 }, (_, i) =>
      i === 0 ? "e".repeat(MAX_LINE_CHARS + 100) : `error ${i}`,
    );
    const text = formatFailures("Session Failures", "session logs", items);
    expect(text).toContain(`Session Failures (${MAX_FAILURE_ITEMS + 50} found)`);
    expect(text).toContain(`Showing the first ${MAX_FAILURE_ITEMS}; 50 more not shown.`);
    expect(text).toContain("[line truncated]");
    expect(text).not.toContain(`error ${MAX_FAILURE_ITEMS + 10}`);
    expect(text).not.toContain("e".repeat(MAX_LINE_CHARS + 1));
  });

  it("formatFailures adds no note when nothing is omitted", () => {
    const text = formatFailures("Console Failures", "console logs", ["a error"]);
    expect(text).not.toContain("more not shown");
  });

  it("filterLinesByKeywords trims and matches case-insensitively", () => {
    expect(
      filterLinesByKeywords("  [ERROR] boom  \ninfo ok\r\nFATAL x", ["error", "fatal"]),
    ).toEqual(["[ERROR] boom", "FATAL x"]);
  });

  it("retrieveSessionFailures truncates a JSON body that collapses to one huge line", async () => {
    const body = { entries: Array.from({ length: 2000 }, () => ({ msg: "error here" })) };
    vi.spyOn(apiClient, "get").mockResolvedValue(ok(body));
    const text = await retrieveSessionFailures("sid", config);
    expect(text).toContain("Session Failures (1 found)");
    expect(text).toContain("[line truncated]");
    expect(text.length).toBeLessThan(MAX_LINE_CHARS + 1000);
  });

  it("retrieveDeviceLogs passes the too-large message through", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(
      new Error(`maxContentLength size of ${MAX_LOG_BYTES} exceeded`),
    );
    const text = await retrieveDeviceLogs("sid", "bid", config);
    expect(text).toContain("device logs for this session are larger than 10 MB");
  });
});

describe("apiClient maxContentLength against a real stream", () => {
  let server: http.Server;
  let url: string;
  let bytesSent = 0;

  beforeAll(async () => {
    // Streams far more than the cap; axios must abort instead of buffering it all.
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(64 * 1024, "a");
      let sent = 0;
      const write = () => {
        while (sent < 50 * 1024 * 1024) {
          sent += chunk.length;
          bytesSent = sent;
          if (!res.write(chunk)) return void res.once("drain", write);
        }
        res.end();
      };
      res.on("error", () => {});
      write();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/log`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  it("rejects with the error fetchLog recognises once the cap is passed", async () => {
    const cap = 1024 * 1024;
    await expect(
      apiClient.get({ url, maxContentLength: cap, raise_error: false }),
    ).rejects.toThrow(/maxContentLength/);
    expect(bytesSent).toBeLessThan(50 * 1024 * 1024);
  });
});
