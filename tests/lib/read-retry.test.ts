import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTransientResponse,
  retryRead,
} from "../../src/lib/read-retry";
import { fetchFromBrowserStackAPI } from "../../src/lib/utils";
import { getTestIds } from "../../src/tools/rca-agent-utils/get-failed-test-id";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
} as any;

async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return pending;
}

describe("retryRead", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the first answer that is not transient", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });

    const result = await settle(retryRead(attempt, isTransientResponse));

    expect(result).toEqual({ status: 200 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("waits longer before each try", async () => {
    const attempt = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const pending = retryRead(attempt).catch((error) => error);

    await vi.advanceTimersByTimeAsync(299);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(await pending).toBeInstanceOf(TypeError);
  });

  it("gives up after three tries with the last answer", async () => {
    const attempt = vi.fn().mockResolvedValue({ status: 502 });

    const result = await settle(retryRead(attempt, isTransientResponse));

    expect(result).toEqual({ status: 502 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("does not retry an answer the caller has to act on", async () => {
    for (const status of [200, 400, 401, 403, 404, 500, 504]) {
      const attempt = vi.fn().mockResolvedValue({ status });
      await settle(retryRead(attempt, isTransientResponse));
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });

  it("discards the body of a transient answer before trying again", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, body: { cancel } })
      .mockResolvedValueOnce({ status: 200 });

    await settle(retryRead(attempt, isTransientResponse));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rethrows at once when retryOnError is off", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("token mint failed"));

    await expect(
      retryRead(attempt, () => false, { retryOnError: false }),
    ).rejects.toThrow("token mint failed");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("reads that use retryRead", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("listTestIds recovers from a failed fetch", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hierarchy: [], pagination: { has_next: false } }),
      }) as any;

    await expect(settle(getTestIds("build-1", "user:key"))).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("fetchBuildInsights' request recovers from a 503", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 1 }) }) as any;

    await expect(
      settle(fetchFromBrowserStackAPI("https://api.example/build", config)),
    ).resolves.toEqual({ id: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
