import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { approveOrDeclinePercyBuild } from "../../src/tools/review-agent-utils/percy-approve-reject";

const AUTH = "fake-user:fake-key";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => AUTH),
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
} as any;

// Re-derive the token the same way the util does, for the current minute bucket.
function expectedToken(buildId: string, action: string): string {
  const bucket = Math.floor(Date.now() / 60000);
  return createHmac("sha256", AUTH)
    .update(`${buildId}:${action}:${bucket}`)
    .digest("hex")
    .slice(0, 16);
}

const okResponse = {
  ok: true,
  json: async () => ({
    data: {
      attributes: {
        "review-state": "approved",
        "action-performed-by": { user_name: "tester" },
      },
    },
  }),
};

describe("approveOrDeclinePercyBuild - confirmation flow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["approve", "unapprove", "reject"] as const)(
    "does NOT call Percy for '%s' without a token, and returns a token",
    async (action) => {
      const result = await approveOrDeclinePercyBuild(
        { buildId: "123", action },
        mockConfig,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as any).text;
      expect(text).toContain(action);
      expect(text).toContain(expectedToken("123", action));
    },
  );

  it("does NOT call Percy with an invalid token", async () => {
    const result = await approveOrDeclinePercyBuild(
      { buildId: "123", action: "reject", confirmToken: "deadbeefdeadbeef" },
      mockConfig,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    // Returns a fresh valid token so the caller can retry correctly.
    expect((result.content[0] as any).text).toContain(
      expectedToken("123", "reject"),
    );
  });

  it("does NOT accept a token minted for a different build", async () => {
    const wrongToken = expectedToken("999", "approve");
    await approveOrDeclinePercyBuild(
      { buildId: "123", action: "approve", confirmToken: wrongToken },
      mockConfig,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT accept a token minted for a different action", async () => {
    const wrongToken = expectedToken("123", "reject");
    await approveOrDeclinePercyBuild(
      { buildId: "123", action: "approve", confirmToken: wrongToken },
      mockConfig,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Percy with a valid token", async () => {
    const token = expectedToken("123", "approve");
    const result = await approveOrDeclinePercyBuild(
      { buildId: "123", action: "approve", confirmToken: token },
      mockConfig,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://percy.io/api/v1/reviews");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body).data.attributes.action).toBe("approve");
    expect((result.content[0] as any).text).toContain("approved");
  });

  it("throws on Percy API errors without leaking the upstream body", async () => {
    const bodyText = vi.fn(async () => "secret upstream detail");
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: bodyText });

    const token = expectedToken("bad", "reject");
    await expect(
      approveOrDeclinePercyBuild(
        { buildId: "bad", action: "reject", confirmToken: token },
        mockConfig,
      ),
    ).rejects.toThrow("Percy build reject failed: 422");

    expect(bodyText).not.toHaveBeenCalled();
  });
});
