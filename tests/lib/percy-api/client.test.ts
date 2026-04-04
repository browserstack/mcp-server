import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PercyClient, deserialize } from "../../../src/lib/percy-api/client.js";
import { PercyApiError } from "../../../src/lib/percy-api/errors.js";

// ---------------------------------------------------------------------------
// Mock auth module — avoid real token resolution
// ---------------------------------------------------------------------------
vi.mock("../../../src/lib/percy-api/auth", () => ({
  getPercyHeaders: vi.fn().mockResolvedValue({
    Authorization: "Token token=fake-token",
    "Content-Type": "application/json",
    "User-Agent": "browserstack-mcp-server",
  }),
  getPercyApiBaseUrl: vi.fn().mockReturnValue("https://percy.io/api/v1"),
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function mockFetch204() {
  return {
    ok: true,
    status: 204,
    headers: { get: () => null },
    json: vi.fn(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PercyClient", () => {
  let client: PercyClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new PercyClient(mockConfig);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. GET with includes — deserializes data + included relationships
  // -------------------------------------------------------------------------
  it("SUCCESS: GET with includes deserializes data and included relationships", async () => {
    const envelope = {
      data: {
        id: "123",
        type: "builds",
        attributes: {
          state: "finished",
          branch: "main",
          "build-number": 42,
          "review-state": "approved",
        },
        relationships: {
          project: { data: { id: "p1", type: "projects" } },
        },
      },
      included: [
        {
          id: "p1",
          type: "projects",
          attributes: { name: "My Project", slug: "my-project" },
        },
      ],
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(envelope));

    const result = await client.get<any>("/builds/123", undefined, [
      "project",
    ]);

    // Verify fetch was called with correct URL
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain("/builds/123");
    expect(calledUrl).toContain("include=project");

    // Verify deserialized data
    expect(result.data.id).toBe("123");
    expect(result.data.type).toBe("builds");
    expect(result.data.state).toBe("finished");
    expect(result.data.buildNumber).toBe(42);
    expect(result.data.reviewState).toBe("approved");

    // Verify resolved relationship
    expect(result.data.project).toBeDefined();
    expect(result.data.project.id).toBe("p1");
    expect(result.data.project.name).toBe("My Project");
    expect(result.data.project.slug).toBe("my-project");
  });

  // -------------------------------------------------------------------------
  // 2. POST with JSON:API body — sends correct format
  // -------------------------------------------------------------------------
  it("SUCCESS: POST sends JSON body and deserializes response", async () => {
    const requestBody = {
      data: {
        type: "reviews",
        attributes: { "review-state": "approved" },
      },
    };

    const responseEnvelope = {
      data: {
        id: "r1",
        type: "reviews",
        attributes: { "review-state": "approved" },
      },
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(responseEnvelope));

    const result = await client.post<any>("/reviews", requestBody);

    // Verify fetch was called with POST method and body
    const [, fetchOpts] = fetchSpy.mock.calls[0];
    expect(fetchOpts.method).toBe("POST");
    expect(JSON.parse(fetchOpts.body)).toEqual(requestBody);

    // Verify deserialized response
    expect(result.data.id).toBe("r1");
    expect(result.data.reviewState).toBe("approved");
  });

  // -------------------------------------------------------------------------
  // 3. kebab-case to camelCase conversion
  // -------------------------------------------------------------------------
  it("SUCCESS: converts kebab-case attribute keys to camelCase", async () => {
    const envelope = {
      data: {
        id: "c1",
        type: "comparisons",
        attributes: {
          "ai-processing-state": "finished",
          "diff-ratio": 0.05,
          "ai-diff-ratio": 0.02,
          state: "finished",
        },
      },
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(envelope));

    const result = await client.get<any>("/comparisons/c1");

    expect(result.data.aiProcessingState).toBe("finished");
    expect(result.data.diffRatio).toBe(0.05);
    expect(result.data.aiDiffRatio).toBe(0.02);
    expect(result.data.state).toBe("finished");
  });

  // -------------------------------------------------------------------------
  // 4. Array data — list of resources
  // -------------------------------------------------------------------------
  it("SUCCESS: deserializes array data correctly", async () => {
    const envelope = {
      data: [
        {
          id: "b1",
          type: "builds",
          attributes: { state: "finished", branch: "main" },
        },
        {
          id: "b2",
          type: "builds",
          attributes: { state: "processing", branch: "dev" },
        },
      ],
      meta: { "total-count": 2 },
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(envelope));

    const result = await client.get<any>("/builds");

    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe("b1");
    expect(result.data[1].branch).toBe("dev");
    expect(result.meta).toEqual({ "total-count": 2 });
  });

  // -------------------------------------------------------------------------
  // 5. No `included` array — relationships resolve to raw refs
  // -------------------------------------------------------------------------
  it("EDGE: response with no included — relationships resolve to raw { id, type }", async () => {
    const envelope = {
      data: {
        id: "b1",
        type: "builds",
        attributes: { state: "finished" },
        relationships: {
          project: { data: { id: "p99", type: "projects" } },
          browsers: {
            data: [
              { id: "br1", type: "browsers" },
              { id: "br2", type: "browsers" },
            ],
          },
        },
      },
      // no `included`
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(envelope));

    const result = await client.get<any>("/builds/b1");

    // Not in included index — should return the raw ref
    expect(result.data.project).toEqual({ id: "p99", type: "projects" });
    expect(result.data.browsers).toEqual([
      { id: "br1", type: "browsers" },
      { id: "br2", type: "browsers" },
    ]);
  });

  // -------------------------------------------------------------------------
  // 6. Nested objects in attributes are preserved
  // -------------------------------------------------------------------------
  it("EDGE: nested objects in attributes (ai-details) are preserved", async () => {
    const aiDetails = {
      "ai-summary": "No visual changes detected",
      confidence: 0.95,
      regions: [{ x: 0, y: 0, width: 100, height: 100 }],
    };

    const envelope = {
      data: {
        id: "b1",
        type: "builds",
        attributes: {
          state: "finished",
          "ai-details": aiDetails,
        },
      },
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(envelope));

    const result = await client.get<any>("/builds/b1");

    // ai-details should be preserved as a nested object (keys camelCased)
    expect(result.data.aiDetails).toBeDefined();
    expect(result.data.aiDetails.aiSummary).toBe(
      "No visual changes detected",
    );
    expect(result.data.aiDetails.confidence).toBe(0.95);
    expect(result.data.aiDetails.regions).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 7. 401 response — throws PercyApiError
  // -------------------------------------------------------------------------
  it("FAIL: 401 response throws PercyApiError with enriched message", async () => {
    const errorBody = {
      errors: [{ title: "Unauthorized", detail: "Token is invalid" }],
    };

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(errorBody, 401));

    await expect(client.get("/builds/123")).rejects.toThrow(PercyApiError);
    await expect(client.get("/builds/123")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  // -------------------------------------------------------------------------
  // 8. 429 response — retries with backoff, eventually throws
  // -------------------------------------------------------------------------
  it("FAIL: 429 response retries then throws after max retries", async () => {
    const errorBody = {
      errors: [{ title: "Rate limited" }],
    };

    // Return 429 for all attempts (initial + 3 retries = 4 calls)
    fetchSpy
      .mockResolvedValueOnce(
        mockFetchResponse(errorBody, 429, { "Retry-After": "0.01" }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(errorBody, 429, { "Retry-After": "0.01" }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(errorBody, 429, { "Retry-After": "0.01" }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(errorBody, 429, { "Retry-After": "0.01" }),
      );

    await expect(client.get("/builds")).rejects.toThrow(PercyApiError);
    await expect(client.get("/builds")).rejects.toMatchObject({
      statusCode: 429,
    });

    // Should have made 4 attempts (1 initial + 3 retries)
    // Note: each expect(client.get) makes its own calls, so check the first batch
  });

  // -------------------------------------------------------------------------
  // 9. 204 No Content — returns undefined
  // -------------------------------------------------------------------------
  it("EDGE: 204 No Content returns undefined", async () => {
    fetchSpy.mockResolvedValueOnce(mockFetch204());

    const result = await client.del("/builds/123");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Standalone deserialize tests
// ---------------------------------------------------------------------------

describe("deserialize", () => {
  it("returns null for data: null", () => {
    const result = deserialize({ data: null });
    expect(result.data).toBeNull();
  });

  it("returns empty array for data: []", () => {
    const result = deserialize({ data: [] });
    expect(result.data).toEqual([]);
  });

  it("handles null relationship data", () => {
    const envelope = {
      data: {
        id: "1",
        type: "builds",
        attributes: { state: "pending" },
        relationships: {
          project: { data: null },
        },
      },
    };

    const result = deserialize(envelope as any);
    const record = result.data as Record<string, unknown>;
    expect(record.project).toBeNull();
  });
});
