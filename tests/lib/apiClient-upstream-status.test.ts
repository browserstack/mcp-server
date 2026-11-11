import { describe, it, expect, vi, beforeEach } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: { ...actual.default, create: () => ({ get }) },
  };
});
vi.mock("../../src/config", () => ({
  default: { REMOTE_MCP: false, browserstackLocalOptions: {} },
}));

import { AxiosError } from "axios";
import { apiClient } from "../../src/lib/apiClient";
import {
  UpstreamScope,
  withUpstreamScope,
} from "../../src/lib/upstream-status";

const url = "https://api.browserstack.com/thing";

async function statusAfter(
  request: () => Promise<unknown>,
): Promise<number | undefined> {
  const scope: UpstreamScope = {};
  await withUpstreamScope(scope, () => request().catch(() => {}));
  return scope.status;
}

describe("apiClient upstream status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the status of an answered request", async () => {
    get.mockResolvedValue({ status: 200, data: {} });
    expect(await statusAfter(() => apiClient.get({ url }))).toBe(200);
  });

  it("records the status of a rejected request, raised or not", async () => {
    const error = new AxiosError("Request failed");
    error.request = {};
    error.response = { status: 503 } as any;
    get.mockRejectedValue(error);
    expect(await statusAfter(() => apiClient.get({ url }))).toBe(503);
    expect(
      await statusAfter(() => apiClient.get({ url, raise_error: false })),
    ).toBe(503);
  });

  it("records 0 when the request got no answer", async () => {
    const error = new AxiosError("timeout of 2000ms exceeded");
    error.request = {};
    get.mockRejectedValue(error);
    expect(await statusAfter(() => apiClient.get({ url }))).toBe(0);
  });

  it("records nothing for a URL it refused to send", async () => {
    expect(
      await statusAfter(() => apiClient.get({ url: "ftp://example.com" })),
    ).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
});
