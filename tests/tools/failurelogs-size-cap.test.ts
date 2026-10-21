import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { apiClient } from "../../src/lib/apiClient";
import { getFailureLogs } from "../../src/tools/get-failure-logs";

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

describe("getFailureLogs with oversized logs", () => {
  let server: http.Server;
  let base: string;
  let hugeBytesSent = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      if (req.url === "/small") {
        res.end("INFO start\n[ERROR] element not found\nINFO done\n");
        return;
      }
      const chunk = Buffer.from("[ERROR] noisy line\n".repeat(4096));
      let sent = 0;
      const write = () => {
        while (sent < 60 * 1024 * 1024) {
          sent += chunk.length;
          hugeBytesSent = Math.max(hugeBytesSent, sent);
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

  it("returns a too-large message for oversized logs and still returns the rest", async () => {
    const realGet = Object.getPrototypeOf(apiClient).get.bind(apiClient);
    vi.spyOn(apiClient, "get").mockImplementation((opts) =>
      realGet({
        ...opts,
        url: opts.url.endsWith("/logs") ? `${base}/small` : `${base}/huge`,
      }),
    );

    const result = await getFailureLogs(
      {
        sessionId: "sid",
        sessionType: "automate" as any,
        logTypes: ["networkLogs", "sessionLogs", "consoleLogs"] as any,
      },
      config,
    );

    const texts = result.content.map((c: any) => c.text);
    expect(result.isError).toBeUndefined();
    expect(texts[0]).toContain("network logs for this session are too large");
    expect(texts[1]).toContain("Session Failures (1 found)");
    expect(texts[2]).toContain("console logs for this session are too large");
    expect(hugeBytesSent).toBeLessThan(60 * 1024 * 1024);
  });

  it("still throws past the cap when the caller asks for errors", async () => {
    vi.restoreAllMocks();
    await expect(
      apiClient.get({ url: `${base}/huge`, maxContentLength: 1024 }),
    ).rejects.toThrow(/maxContentLength/);
  });

  it("does not cap log downloads for local (non-remote) servers", async () => {
    vi.resetModules();
    vi.doMock("../../src/config", async (importOriginal) => {
      const actual: any = await importOriginal();
      return { default: { ...actual.default, REMOTE_MCP: false } };
    });
    const { MAX_LOG_BYTES } = await import(
      "../../src/tools/failurelogs-utils/utils"
    );
    expect(MAX_LOG_BYTES).toBeUndefined();
  });
});
