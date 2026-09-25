import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/tools/selfheal-utils/selfheal.js", () => ({
  getSelfHealSelectors: vi.fn().mockResolvedValue([]),
  fetchSelfHealingReportByBuild: vi
    .fn()
    .mockResolvedValue({ healing_logs: [] }),
}));
vi.mock("../../src/tools/selfheal-utils/fetch-test-code.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/tools/selfheal-utils/fetch-test-code")
  >("../../src/tools/selfheal-utils/fetch-test-code.js");
  return {
    ...actual,
    fetchTestCodeForSessions: vi.fn().mockResolvedValue([]),
  };
});

import {
  fetchSelfHealSelectorTool,
  prepareSelfHealingPlanTool,
} from "../../src/tools/selfheal";
import { describeTestCodeFetchIssues } from "../../src/tools/selfheal-utils/fetch-test-code";
import {
  getSelfHealSelectors,
  fetchSelfHealingReportByBuild,
} from "../../src/tools/selfheal-utils/selfheal.js";

const FAKE_CONFIG = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

const EMPTY_CONFIG = {
  "browserstack-username": "",
  "browserstack-access-key": "",
};

const canonicalSession = {
  sessionId: "s1",
  locators: [
    {
      original: { strategy: "css selector", value: '*[id="email-field"]' },
      healed: {
        strategy: "css selector",
        value: 'input[id="user-email-input"]',
      },
      thought: "email field properties changed",
    },
  ],
};

describe("fetchSelfHealSelectorTool input validation", () => {
  it("returns a friendly message when neither sessionId nor buildUuid is provided", async () => {
    const result = await fetchSelfHealSelectorTool({}, FAKE_CONFIG);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as any).text).toMatch(
      /exactly one of `sessionId` or `buildUuid`/,
    );
  });

  it("returns a friendly message when both sessionId and buildUuid are provided", async () => {
    const result = await fetchSelfHealSelectorTool(
      { sessionId: "s1", buildUuid: "b1" },
      FAKE_CONFIG,
    );
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as any).text).toMatch(
      /exactly one of `sessionId` or `buildUuid`/,
    );
  });

  it("asks the user to configure server env vars when config has no credentials", async () => {
    const result = await fetchSelfHealSelectorTool(
      { buildUuid: "b1" },
      EMPTY_CONFIG,
    );
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/BrowserStack credentials are not configured/);
    expect(text).toMatch(/BROWSERSTACK_USERNAME/);
    expect(text).toMatch(/BROWSERSTACK_ACCESS_KEY/);
    expect(text).toMatch(/not from chat/);
  });
});

describe("fetchSelfHealSelectorTool error contract", () => {
  // The function's declared return type is Promise<CallToolResult>. The catch
  // block must produce a structured { isError: true } result, never reject
  // the promise — otherwise direct (non-MCP-wrapper) callers see a rejected
  // promise instead of the documented shape.
  beforeEach(() => {
    vi.mocked(getSelfHealSelectors).mockReset();
    vi.mocked(fetchSelfHealingReportByBuild).mockReset();
  });

  it("returns { isError: true } when the sessionId path throws", async () => {
    vi.mocked(getSelfHealSelectors).mockRejectedValueOnce(
      new Error("Request failed with status code 401 Unauthorized"),
    );

    const result = await fetchSelfHealSelectorTool(
      { sessionId: "abc" },
      FAKE_CONFIG,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/Authentication with BrowserStack failed/);
    expect(text).toMatch(/sessionId=abc/);
  });

  it("returns { isError: true } when the buildUuid path throws", async () => {
    vi.mocked(fetchSelfHealingReportByBuild).mockRejectedValueOnce(
      new Error("Request failed with status code 404 Not Found"),
    );

    const result = await fetchSelfHealSelectorTool(
      { buildUuid: "build-xyz" },
      FAKE_CONFIG,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/BrowserStack returned 404/);
    expect(text).toMatch(/buildUuid=build-xyz/);
  });

  it("does not reject the promise on failure", async () => {
    vi.mocked(getSelfHealSelectors).mockRejectedValueOnce(
      new Error("transport error"),
    );

    await expect(
      fetchSelfHealSelectorTool({ sessionId: "s1" }, FAKE_CONFIG),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("prepareSelfHealingPlanTool", () => {
  it("returns plan instructions explicitly telling the caller NOT to edit files itself", async () => {
    const res = await prepareSelfHealingPlanTool(
      { sessions: [canonicalSession] },
      EMPTY_CONFIG,
    );
    const text = String(res.content?.[0]?.text);
    expect(text).toContain("This tool does NOT modify any files");
    expect(text).toContain("do NOT blindly");
  });

  it("includes the provided locator pair in the plan", async () => {
    const res = await prepareSelfHealingPlanTool(
      { sessions: [canonicalSession] },
      EMPTY_CONFIG,
    );
    const text = String(res.content?.[0]?.text);
    expect(text).toContain('input[id=\\"user-email-input\\"]');
    expect(text).toContain("email field properties changed");
  });

  it("emits the warning banner at the TOP of the response when credentials are missing", async () => {
    const res = await prepareSelfHealingPlanTool(
      { sessions: [canonicalSession] },
      EMPTY_CONFIG,
    );
    const text = String(res.content?.[0]?.text);
    // Banner must appear before the plan JSON, not after, so the LLM anchors on it.
    const bannerIdx = text.indexOf("ATTENTION");
    const planIdx = text.indexOf("## Plan");
    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(bannerIdx);
    expect(text).toMatch(/credentials or session issue/);
    expect(text).toMatch(/BrowserStack credentials not provided/);
  });

  it("returns a friendly message when `sessions` is empty", async () => {
    const res = await prepareSelfHealingPlanTool(
      { sessions: [] as any },
      FAKE_CONFIG,
    );
    expect(String(res.content?.[0]?.text)).toMatch(/No sessions provided/);
  });

  it("skips locator pairs that are identical or missing values", async () => {
    const res = await prepareSelfHealingPlanTool(
      {
        sessions: [
          {
            sessionId: "s1",
            locators: [
              // identical
              {
                original: { strategy: "css selector", value: "a" },
                healed: { strategy: "css selector", value: "a" },
              },
              // valid
              {
                original: { strategy: "css selector", value: "b" },
                healed: { strategy: "css selector", value: "c" },
              },
              // missing
              {
                original: { strategy: "css selector", value: "" },
                healed: { strategy: "css selector", value: "d" },
              },
            ],
          },
        ],
      },
      EMPTY_CONFIG,
    );
    const text = String(res.content?.[0]?.text);
    expect(text).toContain("Skipped locator pairs");
    expect(text).toContain("identical");
    expect(text).toContain("missing original.value or healed.value");
  });

  it("accepts the `{ action, sessions }` envelope pasted into `sessions`", async () => {
    const envelope = {
      action: "apply_healed_locators",
      sessions: [canonicalSession],
    };
    const res = await prepareSelfHealingPlanTool(
      { sessions: envelope as any },
      EMPTY_CONFIG,
    );
    const text = String(res.content?.[0]?.text);
    expect(text).toContain("## Plan");
    expect(text).toContain('input[id=\\"user-email-input\\"]');
  });

  it("accepts a single session object (not wrapped in an array)", async () => {
    const res = await prepareSelfHealingPlanTool(
      { sessions: canonicalSession as any },
      EMPTY_CONFIG,
    );
    expect(String(res.content?.[0]?.text)).toContain(
      'input[id=\\"user-email-input\\"]',
    );
  });

  it("accepts the raw healing-report shape with `original_locator`/`healed_selectors` and emits no fetch note on success path", async () => {
    const reportLike = {
      healing_logs: [
        {
          session_id: "s1",
          session_name: "Self-Heal Test Run",
          healed_selectors: [
            {
              original_locator: {
                type: "css selector",
                value: "span#modalClose",
              },
              healed_locator: {
                type: "css selector",
                value: "span.modal-close",
              },
              healing_thought: "original selector failed",
            },
          ],
        },
      ],
    };
    const res = await prepareSelfHealingPlanTool(
      { sessions: reportLike as any },
      EMPTY_CONFIG,
    );
    const text = String(res.content?.[0]?.text);
    expect(text).toContain("span.modal-close");
    expect(text).toContain("Self-Heal Test Run");
    expect(text).toContain("original selector failed");
  });
});

describe("describeTestCodeFetchIssues", () => {
  it("describes a non-SDK build as a missing-source case, not a credentials issue", () => {
    const note = describeTestCodeFetchIssues([
      {
        sessionId: "s-non-sdk",
        tests: [
          {
            testRunId: 1,
            code: null,
            filename: null,
            url: "",
          },
        ],
        status: "non_sdk_build",
        httpStatus: 200,
      },
    ]);
    expect(note).toContain("### Non-SDK build");
    expect(note).toContain("s-non-sdk");
    expect(note).toMatch(/not instrumented with the BrowserStack SDK/);
    expect(note).toMatch(/Credentials are not involved/);
    expect(note).toMatch(/local file path/);
    expect(note).not.toMatch(/Unauthorized/);
    expect(note).not.toMatch(/Say this/);
    expect(note).not.toMatch(/DO NOT/);
  });

  it("names the 401 explicitly and states both recovery options", () => {
    const note = describeTestCodeFetchIssues([
      {
        sessionId: "s-401",
        tests: [],
        status: "unauthorized",
        httpStatus: 401,
      },
    ]);
    expect(note).toContain("### Unauthorized (HTTP 401)");
    expect(note).toContain("s-401");
    expect(note).toMatch(/HTTP 401/);
    expect(note).toMatch(/BROWSERSTACK_USERNAME/);
    expect(note).toMatch(/BROWSERSTACK_ACCESS_KEY/);
    expect(note).toMatch(/local test file/);
    expect(note).toMatch(/not from chat/);
    expect(note).not.toMatch(/Say this/);
  });

  it("groups sessions by status and emits one note per status", () => {
    const note = describeTestCodeFetchIssues([
      {
        sessionId: "a",
        tests: [],
        status: "unauthorized",
        httpStatus: 401,
      },
      {
        sessionId: "b",
        tests: [{ testRunId: 1, code: null, filename: null, url: "" }],
        status: "non_sdk_build",
        httpStatus: 200,
      },
      {
        sessionId: "c",
        tests: [],
        status: "not_found",
        httpStatus: 404,
      },
    ]);
    expect(note).toContain("### Non-SDK build — session(s): b");
    expect(note).toContain("### Unauthorized (HTTP 401) — session(s): a");
    expect(note).toContain("### Not found (HTTP 404) — session(s): c");
  });

  it("returns empty string when every session is ok", () => {
    const note = describeTestCodeFetchIssues([
      {
        sessionId: "ok",
        tests: [{ testRunId: 1, code: "x", filename: "t.js", url: "" }],
        status: "ok",
        httpStatus: 200,
      },
    ]);
    expect(note).toBe("");
  });
});
