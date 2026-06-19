import { describe, it, expect, vi, beforeEach } from "vitest";

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: vi.fn(),
      post: postMock,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  },
}));

vi.mock("../../src/config", () => ({
  default: {
    browserstackLocalOptions: {},
  },
}));

// utils.ts (a transitive import of apiClient) imports trackMCP from index.ts,
// whose top-level main() would otherwise run on import. Stub it out.
vi.mock("../../src/index", () => ({
  trackMCP: vi.fn(),
}));

import { apiClient } from "../../src/lib/apiClient";

describe("apiClient error surfacing", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it("includes the server's JSON error message in the thrown error", async () => {
    postMock.mockRejectedValueOnce({
      message: "Request failed with status code 400",
      response: {
        status: 400,
        data: {
          success: false,
          message: "Max Testcase IDs supported limit exceeded.",
        },
      },
    });

    await expect(
      apiClient.post({ url: "https://example.com/api", body: {} }),
    ).rejects.toMatchObject({
      message:
        "Request failed with status code 400: Max Testcase IDs supported limit exceeded.",
    });
  });

  it("falls back to a string error body", async () => {
    postMock.mockRejectedValueOnce({
      message: "Request failed with status code 422",
      response: { status: 422, data: "Unprocessable Entity" },
    });

    await expect(
      apiClient.post({ url: "https://example.com/api", body: {} }),
    ).rejects.toMatchObject({
      message: "Request failed with status code 422: Unprocessable Entity",
    });
  });

  it("returns the response instead of throwing when raise_error is false", async () => {
    postMock.mockRejectedValueOnce({
      message: "Request failed with status code 400",
      response: { status: 400, data: { success: false } },
    });

    const res = await apiClient.post({
      url: "https://example.com/api",
      body: {},
      raise_error: false,
    });
    expect(res.status).toBe(400);
    expect(res.data).toEqual({ success: false });
  });
});
