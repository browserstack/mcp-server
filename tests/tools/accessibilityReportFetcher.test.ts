import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  AccessibilityReportFetcher,
  IssueSource,
  MAX_SCAN_LIST_PAGES,
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

describe("AccessibilityReportFetcher.sourceFromReportUrl", () => {
  const DASHBOARD = "https://accessibility.browserstack.com";
  const scannerLink = (name: string, thBuildId: string) =>
    `${DASHBOARD}/site-scanner/projects/${encodeURIComponent(name)}/builds?thBuildId=${thBuildId}&recurring=false&tunnel_vision=false`;
  const scan = (
    id: number,
    name: string,
    thBuildId: string,
    scanRunId: number,
  ) => ({
    id,
    name,
    scanUrl: scannerLink(name, thBuildId),
    lastScanDetails: { scanRunId },
  });
  const scansPage = (scans: unknown[], nextPage?: string) =>
    ok({ scans, pagination: { hasNext: Boolean(nextPage), nextPage } });

  beforeEach(() => vi.clearAllMocks());

  it("takes an Automated Tests link's build id without calling the API", async () => {
    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/automated-tests/projects/p/builds/b/1?thBuildId=${BUILD_ID}`,
      ),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(get).not.toHaveBeenCalled();
  });

  it("finds a Website Scanner link's scan and latest run by paging the scan list", async () => {
    get
      .mockResolvedValueOnce(scansPage([scan(1, "other", "aaa", 11)], "tok2"))
      .mockResolvedValueOnce(
        scansPage([scan(1234, "checkout fix", "bbb", 5678)]),
      );

    await expect(
      fetcher().sourceFromReportUrl(scannerLink("checkout fix", "bbb")),
    ).resolves.toEqual({ kind: "scan", scanId: "1234", scanRunId: "5678" });
    // No limit: larger pages make the list skip scans, so it is walked at its default size.
    expect(get.mock.calls.map(([options]) => options.url)).toEqual([
      `${API}/website-scanner/v1/scans`,
      `${API}/website-scanner/v1/scans?nextPage=tok2`,
    ]);
  });

  it("names the scan when the link is to one of its earlier runs", async () => {
    get.mockResolvedValueOnce(
      scansPage([scan(1234, "checkout fix", "newer", 5678)]),
    );

    await expect(
      fetcher().sourceFromReportUrl(scannerLink("checkout fix", "older")),
    ).rejects.toThrow(/earlier run of scan "checkout fix" \(scanId 1234\)/);
  });

  it("stops after the newest scans and asks for the ids", async () => {
    get.mockResolvedValue(scansPage([scan(1, "other", "aaa", 11)], "more"));

    await expect(
      fetcher().sourceFromReportUrl(scannerLink("checkout fix", "bbb")),
    ).rejects.toThrow(/most recent scans.*scanId and scanRunId/s);
    expect(get).toHaveBeenCalledTimes(MAX_SCAN_LIST_PAGES);
  });

  it("refuses a link that carries no report id", async () => {
    await expect(
      fetcher().sourceFromReportUrl(
        "https://scanner.browserstack.com/site-scanner/scan-details/checkout",
      ),
    ).rejects.toThrow(/thBuildId/);
    expect(get).not.toHaveBeenCalled();
  });
});
