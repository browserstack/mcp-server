import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The hosted server failed calls with "connect ETIMEDOUT <IPv4>; connect ENETUNREACH <IPv6>"
// within a second: Node gives each address 250 ms by default. A connection that never
// opened sent nothing, so it is tried once more; anything that got a response is not.

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("axios", () => ({
  default: { create: () => ({ get: m.get, post: m.post }) },
}));
vi.mock("../../src/config.js", () => ({
  default: { browserstackLocalOptions: {} },
}));
vi.mock("../../src/lib/utils.js", () => ({ isDataUrlPayloadTooLarge: () => false }));

function connectFailure() {
  // The shape Node's dual-stack connect gives once every address has failed.
  const ipv4 = Object.assign(new Error("connect ETIMEDOUT 146.75.37.242:443"), {
    code: "ETIMEDOUT",
    syscall: "connect",
  });
  const ipv6 = Object.assign(new Error("connect ENETUNREACH 2a04:4e42:79::498:443"), {
    code: "ENETUNREACH",
    syscall: "connect",
  });
  return Object.assign(new AggregateError([ipv4, ipv6], ""), { code: "ETIMEDOUT" });
}

async function client() {
  return (await import("../../src/lib/apiClient.js")).apiClient;
}

describe("apiClient connect failures", () => {
  beforeEach(() => {
    vi.resetModules();
    m.get.mockReset();
    m.post.mockReset();
  });

  it("tries a POST once more when its connection never opened", async () => {
    m.post
      .mockRejectedValueOnce(connectFailure())
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const res = await (await client()).post({ url: "https://api.example/scans", body: { a: 1 } });

    expect(res.data).toEqual({ ok: true });
    expect(m.post).toHaveBeenCalledTimes(2);
  });

  it("does not try an upload again: its stream body was used up by the first try", async () => {
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", Readable.from([Buffer.from("app binary")]), "app.apk");
    m.post
      .mockRejectedValueOnce(connectFailure())
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    await expect(
      (await client()).post({ url: "https://api.example/upload", headers: form.getHeaders(), body: form }),
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it("reports the failure when the second try fails too", async () => {
    m.get.mockRejectedValue(connectFailure());

    await expect((await client()).get({ url: "https://api.example/status" })).rejects.toThrow();
    expect(m.get).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a request that got a response, or failed after connecting", async () => {
    m.post.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 500"), {
        response: { status: 500, data: {} },
      }),
    );
    await expect((await client()).post({ url: "https://api.example/scans" })).rejects.toThrow();
    expect(m.post).toHaveBeenCalledTimes(1);

    m.post.mockReset();
    m.post.mockRejectedValueOnce(
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    );
    await expect((await client()).post({ url: "https://api.example/scans" })).rejects.toThrow();
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it("reads a connect failure from its code, a wrapped cause, or the message", async () => {
    const { isConnectFailure } = await import("../../src/lib/apiClient.js");

    expect(isConnectFailure(connectFailure())).toBe(true);
    expect(isConnectFailure({ cause: { code: "ECONNREFUSED", syscall: "connect" } })).toBe(true);
    expect(
      isConnectFailure({ message: "connect ETIMEDOUT 140.248.149.242:443; connect ENETUNREACH 2a04:4e42:77::498:443 - Local (:::0)" }),
    ).toBe(true);
    expect(isConnectFailure({ code: "ETIMEDOUT", syscall: "read" })).toBe(false);
    expect(isConnectFailure({ code: "ECONNABORTED", message: "timeout of 15000ms exceeded" })).toBe(false);
  });
});
