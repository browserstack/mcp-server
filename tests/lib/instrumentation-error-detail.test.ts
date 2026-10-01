import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));

async function rows() {
  const { apiClient } = await import("../../src/lib/apiClient.js");
  return (apiClient.post as any).mock.calls.map(
    (c: any) => c[0].body.event_properties,
  );
}

const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

const run = async (fn: () => unknown) => {
  const { withToolCall } = await import("../../src/lib/instrumentation.js");
  return withToolCall("myTool", () => ({ name: "vitest" }), CONFIG, fn);
};

/** A tool that reports failure by RETURNING, which is what most tools do. */
const errorResult = (text: string) => ({
  content: [{ type: "text", text }],
  isError: true,
});

describe("returned tool errors are diagnosable", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { apiClient } = await import("../../src/lib/apiClient.js");
    (apiClient.post as any).mockClear();
  });

  it("records the message a returned failure showed the user", async () => {
    await run(() => errorResult("Failed to list test cases: project not found"));

    const [row] = await rows();
    expect(row.outcome).toBe("error_result");
    expect(row.error_message).toContain("Failed to list test cases");
    expect(row.error_type).toBe("ToolError");
  });

  it("still writes exactly one row", async () => {
    await run(() => errorResult("Failed to create test case"));
    expect(await rows()).toHaveLength(1);
  });

  it("leaves a successful call free of error fields", async () => {
    await run(() => ({ content: [{ type: "text", text: "Found 3 test cases" }] }));

    const [row] = await rows();
    expect(row.outcome).toBe("ok");
    expect(row.error_message).toBeUndefined();
    expect(row.error_kind).toBeUndefined();
  });

  it("keeps the thrown-error path intact", async () => {
    await expect(
      run(() => {
        throw new TypeError("boom");
      }),
    ).rejects.toThrow("boom");

    const [row] = await rows();
    expect(row.outcome).toBe("threw");
    expect(row.success).toBe(false);
    expect(row.error_type).toBe("TypeError");
    expect(row.error_message).toBe("boom");
  });

  it("redacts credentials and addresses out of the recorded message", async () => {
    await run(() =>
      errorResult("Failed for priya.sharma@acme.io from host 10.64.56.167"),
    );

    const [row] = await rows();
    expect(row.error_message).not.toContain("priya.sharma@acme.io");
    expect(row.error_message).not.toContain("10.64.56.167");
    expect(row.error_message).toContain("[email]");
    expect(row.error_message).toContain("[ip]");
  });

  it("caps a long message", async () => {
    await run(() => errorResult("x".repeat(5000)));
    const [row] = await rows();
    expect(row.error_message.length).toBeLessThanOrEqual(300);
  });
});

describe("classifyError", () => {
  it.each([
    ["Request failed with status code 429", "rate_limited"],
    ["Too Many Requests, please retry", "rate_limited"],
    ["401 Unauthorized", "auth"],
    ["Access denied for this project", "auth"],
    ["404 Not Found", "not_found"],
    ["Project does not exist", "not_found"],
    ["socket hang up", "network"],
    ["Request timed out after 30s", "timeout"],
    ["500 Internal Server Error", "server_error"],
    ["'project_id' must be a number", "validation"],
    ["missing required parameter(s): project_id", "validation"],
    ["something entirely unexpected", "unknown"],
  ])("buckets %s", async (message, expected) => {
    const { classifyError } = await import("../../src/lib/instrumentation.js");
    expect(classifyError(message)).toBe(expected);
  });

  it("returns unknown when there is no text", async () => {
    const { classifyError } = await import("../../src/lib/instrumentation.js");
    expect(classifyError(undefined)).toBe("unknown");
  });
});
