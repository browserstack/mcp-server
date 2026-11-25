import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// A report's dashboard link is all a user usually has. A Website Scanner link carries the
// run's build id (thBuildId), which the API now reads directly, so the link works however old
// the scan is; a Workflow Analyzer link carries the report's id in `ids`.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
// Web builds are looked up on the Accessibility dashboard with a minted token; no auth server here.
vi.mock("../../src/tools/capability-registry/egress.js", async (original) => ({
  ...(await original<typeof import("../../src/tools/capability-registry/egress.js")>()),
  authHeaders: vi.fn(async () => ({ Authorization: "Bearer test-token" })),
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  AccessibilityReportFetcher,
  foundScanRuns,
  reportExports,
  ScanRunNotFoundError,
  scanRunLink,
} from "../../src/tools/accessiblity-utils/report-fetcher.js";

// Runs found by build id are cached for the process; each test starts without them.
beforeEach(() => foundScanRuns.clear());

const get = apiClient.get as Mock;
const post = apiClient.post as Mock;
const DASHBOARD = "https://accessibility.browserstack.com";
const TH_BUILD = "k3v9q2m7x1c8b4n6z0w5r2t9y4p1s8d3f6g0h2ja";

const ok = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });

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

  it("is exported through the dashboard by its build id", async () => {
    post.mockResolvedValueOnce(ok({ id: 42 }));
    get.mockResolvedValueOnce(ok({ url: "https://csv" }));

    await expect(
      fetcher().getReportLink({ kind: "scanBuild", thBuildId: TH_BUILD, scanName: "checkout fix" }),
    ).resolves.toBe("https://csv");
    expect(post.mock.calls[0][0].body).toEqual({ type: "websiteScan", th_build_id: TH_BUILD });
    expect(get.mock.calls.map(([options]) => options.url)).toEqual([
      "https://accessibility.browserstack.com/api/export_reports/42",
    ]);
  });

  it("says when the dashboard does not know the run by its build id, so the caller can search instead", async () => {
    post.mockResolvedValueOnce({ ok: false, status: 404, data: { success: false, message: "TestRun Not Found" } });

    const error = await fetcher()
      .getReportLink({ kind: "scanBuild", thBuildId: TH_BUILD })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScanRunNotFoundError);
    expect(error.routeMissing).toBe(false);
  });

  it("passes on the dashboard's reason for any other refusal", async () => {
    post.mockResolvedValueOnce({ ok: false, status: 422, data: { success: false, message: "th_build_id is invalid" } });

    await expect(
      fetcher().getReportLink({ kind: "scanBuild", thBuildId: "bad" }),
    ).rejects.toThrow("th_build_id is invalid");
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
