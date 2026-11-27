import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({
  trackMCP: vi.fn(),
  withToolCall: (_n: string, fn: any) => fn(),
}));
vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient";
import appConfig from "../../src/config";
import {
  credentialHash,
  handle,
  parseBasicAuth,
  verifyCredentials,
} from "../../src/http-server";
import addMobileDeviceTools from "../../src/tools/mobile-devices";

const basic = (u: string, k: string) =>
  "Basic " + Buffer.from(`${u}:${k}`).toString("base64");

function fakeRes() {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    headersSent: false,
    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
      return this;
    },
    end(chunk?: string) {
      this.body += chunk ?? "";
    },
  };
  return res;
}

function fakeReq(method: string, url: string, headers: Record<string, string>, body?: unknown) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers },
  ) as any;
}

const initialize = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
};

beforeEach(() => vi.clearAllMocks());

describe("HTTP server: per-user login", () => {
  it("parses Basic credentials and rejects malformed ones", () => {
    expect(parseBasicAuth(basic("alice", "k:with:colons"))).toEqual({ username: "alice", accessKey: "k:with:colons" });
    expect(parseBasicAuth(undefined)).toBeUndefined();
    expect(parseBasicAuth("Bearer abc")).toBeUndefined();
    expect(parseBasicAuth(basic("alice", ""))).toBeUndefined();
    const h = credentialHash({ username: "alice", accessKey: "fake-test-key" });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("fake-test-key");
  });

  it("requires a login before anything else", async () => {
    const res = fakeRes();
    await handle(fakeReq("POST", "/mcp", {}, initialize), res);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toMatch(/Basic/);
  });

  it("rejects credentials BrowserStack does not accept, without creating a session", async () => {
    (apiClient.get as any).mockResolvedValue({ status: 401 });
    const res = fakeRes();
    await handle(fakeReq("POST", "/mcp", { authorization: basic("alice", "wrong") }, initialize), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("rejected these credentials");
    expect(res.body).not.toContain("wrong");
  });

  it("fails closed when BrowserStack's answer is not a clear yes or no", async () => {
    for (const status of [429, 500, 503, 404, 302]) {
      (apiClient.get as any).mockResolvedValue({ status });
      await expect(verifyCredentials({ username: "victim", accessKey: "garbage" })).rejects.toThrow(
        new RegExp(`HTTP ${status}`),
      );
      const res = fakeRes();
      await handle(fakeReq("POST", "/mcp", { authorization: basic("victim", "garbage") }, initialize), res);
      expect(res.statusCode).toBe(502);
    }
    (apiClient.get as any).mockResolvedValue({ status: 403 });
    expect(await verifyCredentials({ username: "victim", accessKey: "garbage" })).toBe(false);
  });

  it("verifies against BrowserStack with the caller's own credentials", async () => {
    (apiClient.get as any).mockResolvedValue({ status: 200 });
    expect(await verifyCredentials({ username: "alice", accessKey: "key1" })).toBe(true);
    expect((apiClient.get as any).mock.calls[0][0].headers.Authorization).toBe(basic("alice", "key1"));
  });

  it("refuses unknown sessions and non-initialize first requests", async () => {
    const r1 = fakeRes();
    await handle(fakeReq("POST", "/mcp", { authorization: basic("a", "b"), "mcp-session-id": "nope" }, { jsonrpc: "2.0", id: 1, method: "tools/list" }), r1);
    expect(r1.statusCode).toBe(404);
    const r2 = fakeRes();
    await handle(fakeReq("POST", "/mcp", { authorization: basic("a", "b") }, { jsonrpc: "2.0", id: 1, method: "tools/list" }), r2);
    expect(r2.statusCode).toBe(400);
  });

  it("serves a health check and 404s other paths", async () => {
    const r = fakeRes();
    await handle(fakeReq("GET", "/healthz", {}), r);
    expect(r.statusCode).toBe(200);
    const r2 = fakeRes();
    await handle(fakeReq("GET", "/other", {}), r2);
    expect(r2.statusCode).toBe(404);
  });
});

describe("team default devices", () => {
  const collect = () => {
    const tools: Record<string, any> = {};
    addMobileDeviceTools(
      {
        tool: vi.fn((...a: any[]) => {
          tools[a[0]] = a[4];
          return {};
        }),
        server: { getClientVersion: () => ({}) },
      } as any,
      { "browserstack-username": "u", "browserstack-access-key": "k" },
    );
    return tools;
  };

  it("explains how to configure the list when none is set", async () => {
    const original = appConfig.TEAM_DEVICES_FILE;
    (appConfig as any).TEAM_DEVICES_FILE = undefined;
    try {
      const r = await collect().getTeamDefaultDevices({});
      expect(r.content[0].text).toMatch(/BROWSERSTACK_TEAM_DEVICES_FILE/);
    } finally {
      (appConfig as any).TEAM_DEVICES_FILE = original;
    }
  });

  it("checks each team device against the account's devices", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "team-"));
    const file = path.join(dir, "devices.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        { platform: "android", device: "Google Pixel 8", osVersion: "14", note: "smoke" },
        { platform: "android", device: "Google Pixel 8", osVersion: "12" },
        { platform: "ios", device: "iPhone 99" },
      ]),
    );
    (apiClient.get as any).mockResolvedValue({
      data: [{ os: "android", os_version: "14.0", device: "Google Pixel 8" }],
    });
    const original = appConfig.TEAM_DEVICES_FILE;
    (appConfig as any).TEAM_DEVICES_FILE = file;
    try {
      const text = (await collect().getTeamDefaultDevices({})).content[0].text;
      expect(text).toContain("Google Pixel 8 14 — ✓ available — smoke");
      expect(text).toContain("OS 12 not available (has 14.0)");
      expect(text).toContain("iPhone 99 — ✗ not available on this account");
    } finally {
      (appConfig as any).TEAM_DEVICES_FILE = original;
      fs.rmSync(dir, { recursive: true });
    }
  });
});
