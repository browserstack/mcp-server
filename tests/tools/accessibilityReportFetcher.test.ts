import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  AccessibilityReportFetcher,
  IssueSource,
} from "../../src/tools/accessiblity-utils/report-fetcher.js";

const get = apiClient.get as Mock;
const API = "https://api-accessibility.browserstack.com/api";
const BUILD_ID = "q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja";

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  data: { success: true, data },
});
const failed = (status: number, error: unknown) => ({
  ok: false,
  status,
  data: { success: false, data: null, error },
});

function fetcher() {
  const f = new AccessibilityReportFetcher();
  f.setAuth({ username: "u", password: "p" });
  return f;
}

describe("AccessibilityReportFetcher.getReportLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each<[string, IssueSource, string, string]>([
    [
      "a Website Scanner run",
      { kind: "scan", scanId: "1234", scanRunId: "5678" },
      `${API}/website-scanner/v1/scans/1234/scan_runs/issues?scan_run_id=5678`,
      `${API}/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A1`,
    ],
    [
      "an Automated Tests build",
      { kind: "build", buildId: BUILD_ID },
      `${API}/automated-tests/v1/builds/issues?buildUuid=${BUILD_ID}`,
      `${API}/automated-tests/v1/builds/issues?taskId=t%3A1`,
    ],
    [
      "a Workflow Analyzer report",
      { kind: "workflow", reportId: "123456" },
      `${API}/workflow-analyzer/v1/reports/issues?reportId=123456`,
      `${API}/workflow-analyzer/v1/reports/issues?taskId=t%3A1`,
    ],
  ])(
    "exports the issues of %s on its own route",
    async (_label, source, startUrl, pollUrl) => {
      get
        .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
        .mockResolvedValueOnce(ok({ reportLink: "https://csv" }));

      await expect(fetcher().getReportLink(source)).resolves.toBe(
        "https://csv",
      );
      expect(get.mock.calls.map(([options]) => options.url)).toEqual([
        startUrl,
        pollUrl,
      ]);
      expect(get.mock.calls[0][0].headers).toEqual({
        Authorization: `Basic ${Buffer.from("u:p").toString("base64")}`,
      });
    },
  );

  it("says which id a build needs when the API does not find it", async () => {
    get.mockResolvedValueOnce(failed(404, ["Build not found"]));

    await expect(
      fetcher().getReportLink({
        kind: "build",
        buildId: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
      }),
    ).rejects.toThrow(/Build not found.*thBuildId.*not the Automate build id/s);
  });

  it("passes on the API's reason when it rejects a report id", async () => {
    get.mockResolvedValueOnce(failed(400, ["Report id must be an Integer"]));

    await expect(
      fetcher().getReportLink({ kind: "workflow", reportId: "abc" }),
    ).rejects.toThrow("Report id must be an Integer");
  });
});
