import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// A report's dashboard link is all a user usually has. A Website Scanner link carries the
// run's build id (thBuildId), which the API now reads directly, so the link works however old
// the scan is; a Workflow Analyzer link carries the report's id in `ids`.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  AccessibilityReportFetcher,
  reportExports,
  ScanRunNotFoundError,
  scanRunLink,
} from "../../src/tools/accessiblity-utils/report-fetcher.js";

const get = apiClient.get as Mock;
const API = "https://api-accessibility.browserstack.com/api";
const DASHBOARD = "https://accessibility.browserstack.com";
const TH_BUILD = "k3v9q2m7x1c8b4n6z0w5r2t9y4p1s8d3f6g0h2ja";

const ok = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });
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

const scannerLink = (name: string, thBuildId: string) =>
  `${DASHBOARD}/site-scanner/projects/${encodeURIComponent(name)}/builds?thBuildId=${thBuildId}&amp%3Brecurring=false`;

describe("a Website Scanner report link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportExports.clear();
  });

  it("names the run by its build id, without searching the scan list", async () => {
    await expect(
      fetcher().sourceFromReportUrl(scannerLink("checkout fix", TH_BUILD)),
    ).resolves.toEqual({ kind: "scanBuild", thBuildId: TH_BUILD, scanName: "checkout fix" });
    expect(get).not.toHaveBeenCalled();
  });

  it("is read through the issues route that takes the build id", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "ext_api_issues:WebsiteScannerTest:x:1:2", message: "started" }))
      .mockResolvedValueOnce(ok({ thBuildId: TH_BUILD, reportLink: "https://csv" }));

    await expect(
      fetcher().getReportLink({ kind: "scanBuild", thBuildId: TH_BUILD, scanName: "checkout fix" }),
    ).resolves.toBe("https://csv");
    expect(get.mock.calls.map(([options]) => options.url)).toEqual([
      `${API}/website-scanner/v1/scan_runs/issues?thBuildId=${TH_BUILD}`,
      `${API}/website-scanner/v1/scan_runs/issues?task_id=ext_api_issues%3AWebsiteScannerTest%3Ax%3A1%3A2`,
    ]);
  });

  it("says when the API does not know the run by its build id, so the caller can search instead", async () => {
    get.mockResolvedValueOnce(failed(404, "Scan run not found. Invalid thBuildId or task id."));

    await expect(
      fetcher().getReportLink({ kind: "scanBuild", thBuildId: TH_BUILD }),
    ).rejects.toBeInstanceOf(ScanRunNotFoundError);
  });

  it("tells an API without the route from one that does not know the run", async () => {
    get.mockResolvedValueOnce({ ok: false, status: 404, data: "<html>Not Found</html>" });

    const error = await fetcher()
      .getReportLink({ kind: "scanBuild", thBuildId: TH_BUILD })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScanRunNotFoundError);
    expect(error.routeMissing).toBe(true);
  });

  it("passes on the API's reason for any other refusal", async () => {
    get.mockResolvedValueOnce(failed(422, ["thBuildId must be the build id from the report link"]));

    await expect(
      fetcher().getReportLink({ kind: "scanBuild", thBuildId: "bad" }),
    ).rejects.toThrow("thBuildId must be the build id from the report link");
  });

  it("is named again by a clean link, for the next page", () => {
    expect(scanRunLink({ kind: "scanBuild", thBuildId: TH_BUILD, scanName: 'checkout "fix"' })).toBe(
      `${DASHBOARD}/site-scanner/projects/checkout%20%22fix%22/builds?thBuildId=${TH_BUILD}`,
    );
  });

  it("can still be found in the scan list, for what needs the scan's ids", async () => {
    get.mockResolvedValueOnce(
      ok({
        scans: [
          {
            id: 1234,
            name: "checkout fix",
            scanUrl: scannerLink("checkout fix", TH_BUILD),
            lastScanDetails: { scanRunId: 5678 },
          },
        ],
        pagination: { hasNext: false },
      }),
    );

    await expect(
      fetcher().findScanRun({ kind: "scanBuild", thBuildId: TH_BUILD, scanName: "checkout fix" }),
    ).resolves.toEqual({ kind: "scan", scanId: "1234", scanRunId: "5678" });
  });

  it("has no processing status to read without the scan's ids", async () => {
    await expect(
      fetcher().reportStatus({ kind: "scanBuild", thBuildId: TH_BUILD }),
    ).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("a Workflow Analyzer report link", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [`${DASHBOARD}/workflow-analyzer/report?ids=123456`],
    [`${DASHBOARD}/reports/report?ids=123456`],
    [`${DASHBOARD}/workflow-analyzer/report/?ids=123456&tab=issues`],
  ])("names the report by the id it carries: %s", async (link) => {
    await expect(fetcher().sourceFromReportUrl(link)).resolves.toEqual({
      kind: "workflow",
      reportId: "123456",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("asks for one report when the link opens several", async () => {
    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/workflow-analyzer/report?ids=123,456`),
    ).rejects.toThrow(/several Workflow Analyzer reports.*workflowReportId/s);
  });
});

describe("an Assisted Test report link", () => {
  it("says this tool does not read Assisted Test reports, rather than that the link is unknown", async () => {
    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/assisted-test/report?ids=98765`),
    ).rejects.toThrow(/Assisted Test reports/);
  });
});

describe("a build id no build API knows", () => {
  const missing = () => ({ ok: false, status: 404, data: { success: false, error: ["Build not found"] } });

  beforeEach(() => vi.clearAllMocks());

  it("is tried as a Website Scanner run's build id when asked to", async () => {
    get.mockResolvedValueOnce(missing()).mockResolvedValueOnce(missing());

    await expect(
      fetcher().resolveBuild({ kind: "build", buildId: TH_BUILD }, { orScanRun: true }),
    ).resolves.toEqual({ kind: "scanBuild", thBuildId: TH_BUILD });
  });

  it("is still refused when only build APIs are asked", async () => {
    get.mockResolvedValueOnce(missing()).mockResolvedValueOnce(missing());

    await expect(
      fetcher().resolveBuild({ kind: "build", buildId: TH_BUILD }),
    ).rejects.toThrow(/No Automated Tests \(web\) or App Accessibility build/);
  });
});
