import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPercyToken } from "../../src/tools/sdk-utils/percy-web/fetchPercyToken";

function mockResponse(token: string) {
  return { ok: true, json: async () => ({ token, success: true }) } as Response;
}

describe("fetchPercyToken cache keying", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("reuses the cached token for the same project and credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse("tok-A"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchPercyToken("proj-shared", "userA:keyA");
    const second = await fetchPercyToken("proj-shared", "userA:keyA");

    expect(first).toBe("tok-A");
    expect(second).toBe("tok-A");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not hand one tenant's token to another with the same project name", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const auth = (init.headers as Record<string, string>).Authorization;
        return mockResponse(`tok-${auth}`);
      });
    vi.stubGlobal("fetch", fetchMock);

    const tenantOne = await fetchPercyToken(
      "shared-project-name",
      "tenant1:key1",
    );
    const tenantTwo = await fetchPercyToken(
      "shared-project-name",
      "tenant2:key2",
    );

    expect(tenantOne).not.toBe(tenantTwo);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
