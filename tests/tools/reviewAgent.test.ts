import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { fetchPercyChanges } from "../../src/tools/review-agent";
import { fetchPercyToken } from "../../src/tools/sdk-utils/percy-web/fetchPercyToken";
import { getPercyBuildCount } from "../../src/tools/review-agent-utils/build-counts";
import { getChangedPercySnapshotIds } from "../../src/tools/review-agent-utils/percy-snapshots";
import { getPercySnapshotDiffs } from "../../src/tools/review-agent-utils/percy-diffs";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/tools/sdk-utils/percy-web/fetchPercyToken", () => ({
  fetchPercyToken: vi.fn(),
}));
vi.mock("../../src/tools/review-agent-utils/build-counts", () => ({
  getPercyBuildCount: vi.fn(),
}));
vi.mock("../../src/tools/review-agent-utils/percy-snapshots", () => ({
  getChangedPercySnapshotIds: vi.fn(),
}));
vi.mock("../../src/tools/review-agent-utils/percy-diffs", () => ({
  getPercySnapshotDiffs: vi.fn(),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("fetchPercyChanges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUCCESS: returns snapshot diffs", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("percy-token-123");
    (getPercyBuildCount as Mock).mockResolvedValue({
      noBuilds: false,
      isFirstBuild: false,
      lastBuildId: "build-999",
      orgId: "org-1",
      browserIds: ["chrome"],
    });
    (getChangedPercySnapshotIds as Mock).mockResolvedValue(["snap-1"]);
    (getPercySnapshotDiffs as Mock).mockResolvedValue([
      { name: "Homepage", title: "Visual Change", description: "Button color changed" },
    ]);

    const result = await fetchPercyChanges(
      { project_name: "my-project" },
      mockConfig,
    );

    expect(result.content.length).toBe(1);
    expect(result.content[0].text).toContain("Homepage");
    expect(result.content[0].text).toContain("Button color changed");
  });

  it("SUCCESS: handles no builds", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("percy-token-123");
    (getPercyBuildCount as Mock).mockResolvedValue({ noBuilds: true });

    const result = await fetchPercyChanges(
      { project_name: "new-project" },
      mockConfig,
    );

    expect(result.content[0].text).toContain("No Percy builds found");
  });

  it("SUCCESS: handles first build (no baseline)", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("percy-token-123");
    (getPercyBuildCount as Mock).mockResolvedValue({
      noBuilds: false,
      isFirstBuild: true,
      lastBuildId: null,
    });

    const result = await fetchPercyChanges(
      { project_name: "new-project" },
      mockConfig,
    );

    expect(result.content[0].text).toContain("first Percy build");
  });

  it("FAIL: throws when Percy token fetch fails", async () => {
    (fetchPercyToken as Mock).mockRejectedValue(
      new Error("Token not found"),
    );

    await expect(
      fetchPercyChanges({ project_name: "bad" }, mockConfig),
    ).rejects.toThrow("Token not found");
  });
});
