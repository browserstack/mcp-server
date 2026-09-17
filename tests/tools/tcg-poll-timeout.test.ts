import { beforeEach, afterEach, describe, it, expect, vi, Mock } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import { getTMBaseURL } from "../../src/lib/tm-base-url";
import { pollTestCaseDetails } from "../../src/tools/testmanagement-utils/TCG-utils/api";
import { TCG_POLL_MAX_WAIT_MS } from "../../src/tools/testmanagement-utils/TCG-utils/config";

// The TCG polling loops must give up after a hard wall-clock deadline instead
// of polling forever when the backend never sends a "termination" message.
vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../src/lib/tm-base-url", () => ({
  getTMBaseURL: vi.fn(async () => "https://test-management.browserstack.com"),
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "fake-user:fake-key"),
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
} as any;

describe("TCG polling hard timeout", () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (getTMBaseURL as Mock).mockResolvedValue(
      "https://test-management.browserstack.com",
    );
    // Make the inter-poll sleep resolve immediately so the loop advances
    // without waiting real seconds.
    setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("pollTestCaseDetails rejects once the deadline passes with no termination", async () => {
    // Backend keeps replying successfully but never emits a terminal message.
    (apiClient.post as Mock).mockResolvedValue({
      data: { data: { success: true, message: [] } },
    });

    // First Date.now() sets the deadline; the next read is past it.
    const base = 1_000_000;
    let call = 0;
    vi.spyOn(Date, "now").mockImplementation(() =>
      ++call === 1 ? base : base + TCG_POLL_MAX_WAIT_MS + 1,
    );

    await expect(pollTestCaseDetails("trace-abc", mockConfig)).rejects.toThrow(
      /timed out/i,
    );
  });

  it("pollTestCaseDetails resolves normally when termination arrives", async () => {
    (apiClient.post as Mock).mockResolvedValue({
      data: {
        data: {
          success: true,
          message: [
            {
              type: "testcase_details",
              data: {
                testcase_details: [
                  { id: "tc-1", steps: ["s1"], preconditions: "p1" },
                ],
              },
            },
            { type: "termination" },
          ],
        },
      },
    });

    await expect(
      pollTestCaseDetails("trace-xyz", mockConfig),
    ).resolves.toEqual({ "tc-1": { steps: ["s1"], preconditions: "p1" } });
  });
});
