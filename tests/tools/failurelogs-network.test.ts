import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/lib/get-auth.js", () => ({
  getBrowserStackAuth: () => "user:key",
}));
vi.mock("../../src/config", () => ({
  __esModule: true,
  default: { browserstackUsername: "user", browserstackAccessKey: "key" },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

import { apiClient } from "../../src/lib/apiClient.js";
import { retrieveNetworkFailures } from "../../src/tools/failurelogs-utils/automate.js";
import { getFailureLogs } from "../../src/tools/get-failure-logs.js";

const config = {} as any;
const respond = (data: unknown) =>
  vi
    .mocked(apiClient.get)
    .mockResolvedValue({ ok: true, status: 200, data } as any);

const entry = (response: unknown, url = "https://app.example/api") => ({
  startedDateTime: "2026-10-05T10:00:00Z",
  time: 12,
  request: { method: "GET", url, queryString: [] },
  response,
  serverIPAddress: "10.0.0.1",
});

describe("retrieveNetworkFailures", () => {
  beforeEach(() => vi.mocked(apiClient.get).mockReset());

  it("reports failed requests from a well-formed HAR", async () => {
    respond({
      log: {
        entries: [
          entry({ status: 200 }),
          entry({ status: 500, statusText: "Server Error" }),
        ],
      },
    });
    const out = await retrieveNetworkFailures("s1", config);
    expect(out).toContain("Network Failures (1 found)");
    expect(out).toContain("500");
  });

  it("treats an entry with a null response as a failed request instead of throwing", async () => {
    respond({
      log: {
        entries: [
          entry(null, "https://app.example/aborted"),
          entry({ status: 204 }),
        ],
      },
    });
    const out = await retrieveNetworkFailures("s1", config);
    expect(out).toContain("Network Failures (1 found)");
    expect(out).toContain("https://app.example/aborted");
    expect(out).toContain('"_error": "no response recorded"');
  });

  it("ignores a null entry in the HAR instead of throwing", async () => {
    respond({ log: { entries: [null, entry({ status: 404 })] } });
    const out = await retrieveNetworkFailures("s1", config);
    expect(out).toContain("Network Failures (1 found)");
    expect(out).toContain("404");
  });

  it("treats an entry with no response field the same way", async () => {
    respond({ log: { entries: [entry(undefined)] } });
    await expect(retrieveNetworkFailures("s1", config)).resolves.toContain(
      "Network Failures (1 found)",
    );
  });

  it.each([
    ["an empty object", {}],
    ["a log without entries", { log: {} }],
    ["a string body", "no logs"],
    ["null", null],
  ])(
    "returns a message when the body is %s rather than a HAR file",
    async (_label, body) => {
      respond(body);
      await expect(retrieveNetworkFailures("s1", config)).resolves.toBe(
        "No network logs found for this session",
      );
    },
  );

  it("still reports no failures for a clean HAR", async () => {
    respond({
      log: { entries: [entry({ status: 200 }), entry({ status: 302 })] },
    });
    await expect(retrieveNetworkFailures("s1", config)).resolves.toBe(
      "No network failures found",
    );
  });
});

describe("getFailureLogs tool with a HAR that has null entries and responses", () => {
  beforeEach(() => vi.mocked(apiClient.get).mockReset());

  it("returns a normal result instead of an error", async () => {
    respond({
      log: {
        entries: [
          null,
          entry(null, "https://app.example/aborted"),
          entry({ status: 200 }),
        ],
      },
    });
    const server = { server: { getClientVersion: () => "vitest" } } as any;
    const result = await getFailureLogs(
      {
        sessionId: "s1",
        logTypes: ["networkLogs"],
        sessionType: "automate",
      } as any,
      server,
    );
    expect(result.isError).toBeFalsy();
    const text = result.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("Network Failures (1 found)");
    expect(text).toContain("https://app.example/aborted");
    expect(text).not.toContain("Cannot read properties");
  });
});
