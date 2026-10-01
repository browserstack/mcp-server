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

});

describe("the recorded message is not truncated", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { apiClient } = await import("../../src/lib/apiClient.js");
    (apiClient.post as any).mockClear();
  });

  it("keeps a long product error whole", async () => {
    const long = `Failed to update test case: ${"detail ".repeat(200)}`.trim();
    await run(() => errorResult(long));

    const [row] = await rows();
    expect(row.error_message).toBe(long);
    expect(row.error_message.length).toBeGreaterThan(1000);
  });
});

describe("an unusable config still writes the row", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { apiClient } = await import("../../src/lib/apiClient.js");
    (apiClient.post as any).mockClear();
  });

  it("sends unauthenticated rather than dropping the event", async () => {
    const { withToolCall } = await import("../../src/lib/instrumentation.js");
    await withToolCall("myTool", () => ({ name: "vitest" }), {} as any, () =>
      errorResult("Failed to list test cases"),
    );

    const recorded = await rows();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].error_message).toBe("Failed to list test cases");
  });
});

describe("redaction stays fast on pathological input", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { apiClient } = await import("../../src/lib/apiClient.js");
    (apiClient.post as any).mockClear();
  });

  it.each([
    ["a long alphanumeric run", "A".repeat(50000)],
    ["a long dotted-number run", "1.".repeat(20000)],
    ["a long jwt-like prefix", "eyJ" + "A".repeat(20000)],
  ])("handles %s without stalling", async (_label, payload) => {
    const started = Date.now();
    await run(() => errorResult(payload));
    expect(Date.now() - started).toBeLessThan(500);
    expect(await rows()).toHaveLength(1);
  });

  it("still redacts once the input is capped", async () => {
    await run(() => errorResult("x".repeat(3000) + " contact priya@acme.io"));
    const [row] = await rows();
    expect(row.error_message).not.toContain("priya@acme.io");
  });
});
