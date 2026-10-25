import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { getAutomationBaseUrl } from "../../src/tools/rca-agent-utils/constants.js";
import {
  AccessibilityReportFetcher,
  EXPORT_WAIT_MS,
  ExportPendingError,
  IssueSource,
  EXPORT_TASK_MAX_AGE_MS,
  MAX_SCAN_LIST_PAGES,
  MAX_SCAN_RUN_PAGES,
  reportExports,
  MAX_REPORT_EXPORTS,
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
  beforeEach(() => {
    vi.clearAllMocks();
    reportExports.clear();
  });

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

describe("AccessibilityReportFetcher.sourceFromReportUrl and a scan without a run", () => {
  it("refuses a link whose scan has no run yet instead of asking the API for run 'undefined'", async () => {
    const DASHBOARD = "https://accessibility.browserstack.com";
    const link = `${DASHBOARD}/site-scanner/projects/checkout/builds?thBuildId=bbb`;
    (apiClient.get as Mock).mockResolvedValueOnce(
      ok({
        scans: [{ id: 1234, name: "checkout", scanUrl: link }],
        pagination: { hasNext: false },
      }),
    );

    await expect(fetcher().sourceFromReportUrl(link)).rejects.toThrow(
      /scan 1234 has no completed run/,
    );
  });
});

describe("AccessibilityReportFetcher.sourceFromReportUrl for Automate links", () => {
  const AUTOMATE_BUILD = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
  const SESSION = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
  const DASHBOARD = "https://automate.browserstack.com/dashboard/v2/builds";
  const testCodeUrl = `${getAutomationBaseUrl()}/ext/v1/sessions/${SESSION}/testCode`;
  const testCode = (buildUuid?: string) => ({
    ok: true,
    status: 200,
    data: { session_id: SESSION, build_uuid: buildUuid, tests: [] },
  });
  const urls = () => get.mock.calls.map(([options]) => options.url);

  beforeEach(() => vi.clearAllMocks());

  it("maps a session link to the accessibility build it ran in", async () => {
    get
      .mockResolvedValueOnce(testCode(BUILD_ID))
      .mockResolvedValueOnce(ok({ id: BUILD_ID }));

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/${AUTOMATE_BUILD}/sessions/${SESSION}`,
      ),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(urls()).toEqual([
      testCodeUrl,
      `${API}/automated-tests/v1/builds/${BUILD_ID}`,
    ]);
  });

  it("maps a build link through one of its sessions", async () => {
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ automation_session: { hashed_id: SESSION } }],
      })
      .mockResolvedValueOnce(testCode(BUILD_ID))
      .mockResolvedValueOnce(ok({ id: BUILD_ID }));

    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/${AUTOMATE_BUILD}`),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(urls()[0]).toBe(
      `https://api.browserstack.com/automate/builds/${AUTOMATE_BUILD}/sessions.json?limit=5`,
    );
  });

  it("tries the build's next session when one was not run through the SDK", async () => {
    const OTHER = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c";
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          { automation_session: { hashed_id: OTHER } },
          { automation_session: { hashed_id: SESSION } },
        ],
      })
      .mockResolvedValueOnce({ ok: false, status: 404, data: { message: "Session not found" } })
      .mockResolvedValueOnce(testCode(BUILD_ID))
      .mockResolvedValueOnce(ok({ id: BUILD_ID }));

    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/${AUTOMATE_BUILD}`),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(urls().slice(1)).toEqual([
      `${getAutomationBaseUrl()}/ext/v1/sessions/${OTHER}/testCode`,
      testCodeUrl,
      `${API}/automated-tests/v1/builds/${BUILD_ID}`,
    ]);
  });

  it("says a build none of whose sessions ran through the SDK has no accessibility results", async () => {
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ automation_session: { hashed_id: SESSION } }, { automation_session: { hashed_id: SESSION } }],
      })
      .mockResolvedValueOnce({ ok: false, status: 404, data: null })
      .mockResolvedValueOnce(testCode(undefined));

    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/${AUTOMATE_BUILD}`),
    ).rejects.toThrow(/not linked to a BrowserStack SDK build/);
  });

  it("says a session not run through the SDK has no accessibility results", async () => {
    get.mockResolvedValueOnce({
      ok: false,
      status: 404,
      data: { message: "Session not found" },
    });

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/${AUTOMATE_BUILD}/sessions/${SESSION}`,
      ),
    ).rejects.toThrow(/not linked to a BrowserStack SDK build/);
  });

  it("says an SDK run without accessibility testing has no results", async () => {
    get
      .mockResolvedValueOnce(testCode(BUILD_ID))
      .mockResolvedValueOnce(failed(404, ["Build not found"]));

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/${AUTOMATE_BUILD}/sessions/${SESSION}`,
      ),
    ).rejects.toThrow(/accessibility testing was not on/);
  });

  it("reports a failed accessibility build lookup as the error it was", async () => {
    get
      .mockResolvedValueOnce(testCode(BUILD_ID))
      .mockResolvedValueOnce(failed(500, ["Internal server Error"]));

    const lookup = fetcher().sourceFromReportUrl(
      `${DASHBOARD}/${AUTOMATE_BUILD}/sessions/${SESSION}`,
    );

    await expect(lookup).rejects.toThrow(/HTTP 500/);
    await expect(lookup).rejects.not.toThrow(/not on/);
  });

  it("names an Automate build it does not know", async () => {
    get.mockResolvedValueOnce({ ok: false, status: 404, data: null });

    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/${AUTOMATE_BUILD}`),
    ).rejects.toThrow(`No Automate build with id ${AUTOMATE_BUILD}`);
  });
});

describe("AccessibilityReportFetcher.reportStatus", () => {
  const urls = () => get.mock.calls.map(([options]) => options.url);

  beforeEach(() => vi.clearAllMocks());

  it("reads a scan run's status from its status endpoint", async () => {
    get.mockResolvedValueOnce(
      ok({ scan_id: "1234", scan_run_id: "5678", status: "finalizing" }),
    );

    await expect(
      fetcher().reportStatus({
        kind: "scan",
        scanId: "1234",
        scanRunId: "5678",
      }),
    ).resolves.toBe("finalizing");
    expect(urls()).toEqual([
      `${API}/website-scanner/v1/scans/1234/scan_runs/5678/status`,
    ]);
  });

  it("reads a Workflow Analyzer report's status from its summary", async () => {
    get.mockResolvedValueOnce(ok({ summary: { status: "completed" } }));

    await expect(
      fetcher().reportStatus({ kind: "workflow", reportId: "123456" }),
    ).resolves.toBe("completed");
    expect(urls()).toEqual([`${API}/workflow-analyzer/v1/reports/123456`]);
  });

  it("reads a build's status from its project's build list, as the build overview has none", async () => {
    get
      .mockResolvedValueOnce(ok({ id: BUILD_ID, projectName: "Checkout" }))
      .mockResolvedValueOnce(
        ok({
          builds: [{ id: "newer", status: "running" }],
          pagination: { has_next: true, next_page: "p2" },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          builds: [{ id: BUILD_ID, status: "finalizing" }],
          pagination: { has_next: false },
        }),
      );

    await expect(
      fetcher().reportStatus({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toBe("finalizing");
    expect(urls()).toEqual([
      `${API}/automated-tests/v1/builds/${BUILD_ID}`,
      `${API}/automated-tests/v1/builds?project_name=Checkout&limit=100`,
      `${API}/automated-tests/v1/builds?project_name=Checkout&limit=100&next_page=p2`,
    ]);
  });

  it("returns nothing when the status cannot be read", async () => {
    get.mockResolvedValueOnce(failed(500, ["Internal server Error"]));

    await expect(
      fetcher().reportStatus({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toBeUndefined();
  });
});

describe("AccessibilityReportFetcher.sourceFromReportUrl and a shared report link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the dashboard link a scanner share link carries", async () => {
    const inner = `https://accessibility.browserstack.com/site-scanner/projects/checkout/builds?thBuildId=bbb&recurring=false`;
    const share = `https://scanner.browserstack.com/site-scanner/checkout/a11y-report?reportUrl=${encodeURIComponent(inner)}&minimal=true&report_source=private_share`;
    get.mockResolvedValueOnce(
      ok({
        scans: [{ id: 1234, name: "checkout", scanUrl: inner, lastScanDetails: { scanRunId: 5678 } }],
        pagination: { hasNext: false },
      }),
    );

    await expect(fetcher().sourceFromReportUrl(share)).resolves.toEqual({
      kind: "scan",
      scanId: "1234",
      scanRunId: "5678",
    });
  });
});

describe("AccessibilityReportFetcher.getReportLink on a large report", () => {
  const SOURCE: IssueSource = { kind: "scan", scanId: "1234", scanRunId: "5678" };
  const pending = ok({ message: "CSV file link generation is in progress. Please try again in some time." });
  const urls = () => get.mock.calls.map(([options]) => options.url);

  beforeEach(() => {
    vi.clearAllMocks();
    reportExports.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps waiting on the same export until its link is ready", async () => {
    get.mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }));
    for (let i = 0; i < 6; i++) get.mockResolvedValueOnce(pending);
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv?Expires=9999999999" }));

    const link = fetcher().getReportLink(SOURCE);
    await vi.runAllTimersAsync();

    await expect(link).resolves.toBe("https://csv?Expires=9999999999");
    expect(urls().filter((u) => u.includes("scan_run_id="))).toHaveLength(1);
    expect(urls().filter((u) => u.includes("task_id=t%3A1"))).toHaveLength(7);
  });

  /** Runs a call until its export is handed back still pending, and returns the token for it. */
  async function pendingToken(
    source: IssueSource = SOURCE,
    options: { stillProcessing?: boolean } = {},
  ): Promise<string> {
    get.mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }));
    get.mockResolvedValue(pending);
    const link = fetcher().getReportLink(source, options);
    const outcome = link.catch((error) => error);
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ExportPendingError);
    get.mockReset();
    return error.taskId;
  }

  it("hands back a token for the export when it is still running after the wait, not the bare task id", async () => {
    const token = await pendingToken();

    expect(token).not.toBe("t:1");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("continues an export it was given instead of starting another", async () => {
    const token = await pendingToken();
    reportExports.clear();
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv" }));

    await expect(
      fetcher().getReportLink(SOURCE, { exportTaskId: token }),
    ).resolves.toBe("https://csv");
    expect(urls()).toEqual([
      "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A1",
    ]);
  });

  it("refuses an exportTaskId it did not hand out", async () => {
    await expect(
      fetcher().getReportLink(SOURCE, { exportTaskId: "t:9" }),
    ).rejects.toThrow(/not an export this tool handed out: call without it/);
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses another report's export rather than keeping its CSV as this report's", async () => {
    const token = await pendingToken();
    const other: IssueSource = { kind: "scan", scanId: "1234", scanRunId: "9999" };

    await expect(
      fetcher().getReportLink(other, { exportTaskId: token }),
    ).rejects.toThrow(/another report's export/);
    expect(get).not.toHaveBeenCalled();
    expect([...reportExports.keys()].some((key) => key.includes("9999"))).toBe(false);
  });

  it("matches a report however its ids were typed", async () => {
    const token = await pendingToken();
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv" }));

    const numeric = { kind: "scan", scanId: 1234, scanRunId: 5678 } as unknown as IssueSource;
    await expect(
      fetcher().getReportLink(numeric, { exportTaskId: token }),
    ).resolves.toBe("https://csv");
  });

  it.each([
    ["remembered from the previous call", false],
    ["given as a token", true],
  ])(
    "starts the export again when the one %s has been pending too long",
    async (_label, viaToken) => {
      const token = await pendingToken();
      if (viaToken) reportExports.clear();
      vi.setSystemTime(Date.now() + EXPORT_TASK_MAX_AGE_MS);
      get
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(ok({ task_id: "t:2", message: "started" }))
        .mockResolvedValueOnce(ok({ reportLink: "https://csv" }));

      await expect(
        fetcher().getReportLink(SOURCE, viaToken ? { exportTaskId: token } : {}),
      ).resolves.toBe("https://csv");
      expect(urls()).toEqual([
        `${API}/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A1`,
        `${API}/website-scanner/v1/scans/1234/scan_runs/issues?scan_run_id=5678`,
        `${API}/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A2`,
      ]);
    },
  );

  it("never sleeps past its wait budget", async () => {
    get.mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }));
    get.mockResolvedValue(pending);
    const startedAt = Date.now();
    let settledAt = 0;
    let waitedMs = 0;

    const link = fetcher()
      .getReportLink(SOURCE)
      .catch((error) => {
        settledAt = Date.now();
        waitedMs = error.waitedMs;
      });
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await link;

    expect(settledAt - startedAt).toBeLessThanOrEqual(EXPORT_WAIT_MS);
    expect(waitedMs).toBeLessThanOrEqual(EXPORT_WAIT_MS);
  });

  it("reports a failed poll with its HTTP status and forgets the export", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce({ ok: false, status: 502, data: "<html>Bad Gateway</html>" });

    await expect(fetcher().getReportLink(SOURCE)).rejects.toThrow(/HTTP 502/);
    expect(get.mock.calls[1][0].raise_error).toBe(false);
    expect(reportExports.size).toBe(0);
  });

  it("refuses a poll answer that is not an object instead of failing on it", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce({ ok: true, status: 200, data: null });

    await expect(fetcher().getReportLink(SOURCE)).rejects.toThrow(
      /Failed to fetch report/,
    );
  });

  it("continues the export a previous call started for the same report", async () => {
    get.mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }));
    get.mockResolvedValue(pending);
    const first = fetcher().getReportLink(SOURCE);
    const failedFirst = expect(first).rejects.toBeInstanceOf(ExportPendingError);
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await failedFirst;

    get.mockReset();
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv" }));
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe("https://csv");
    expect(urls()).toEqual([
      "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A1",
    ]);
  });

  it("reuses a finished export for later pages until its link expires", async () => {
    const expires = Math.floor(Date.now() / 1000) + 12 * 3600;
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: `https://csv?Expires=${expires}` }));

    await fetcher().getReportLink(SOURCE);
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe(`https://csv?Expires=${expires}`);
    expect(get).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 13 * 3600 * 1000);
    get
      .mockResolvedValueOnce(ok({ task_id: "t:2", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv2" }));
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe("https://csv2");
  });

  it("starts a fresh export for a report still processing, so a call after it finishes is not stale", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv?Expires=9999999999" }))
      .mockResolvedValueOnce(ok({ task_id: "t:2", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv2?Expires=9999999999" }));

    await fetcher().getReportLink(SOURCE, { stillProcessing: true });
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe(
      "https://csv2?Expires=9999999999",
    );
    expect(urls().filter((u) => u.includes("scan_run_id="))).toHaveLength(2);
  });

  it("continues a still-processing report's export while it is still processing", async () => {
    await pendingToken(SOURCE, { stillProcessing: true });
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv?Expires=9999999999" }));

    await expect(
      fetcher().getReportLink(SOURCE, { stillProcessing: true }),
    ).resolves.toBe("https://csv?Expires=9999999999");
    expect(urls()).toEqual([`${API}/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A1`]);
    expect(reportExports.size).toBe(0);
  });

  it("starts the finished report's export afresh rather than continuing one begun while it was processing", async () => {
    await pendingToken(SOURCE, { stillProcessing: true });
    get
      .mockResolvedValueOnce(ok({ task_id: "t:2", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv2?Expires=9999999999" }));

    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe(
      "https://csv2?Expires=9999999999",
    );
    expect(urls()[0]).toContain("scan_run_id=5678");
  });

  it("does not keep the CSV of an export begun while the report was processing, even once it has finished", async () => {
    const token = await pendingToken(SOURCE, { stillProcessing: true });
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv?Expires=9999999999" }));

    await fetcher().getReportLink(SOURCE, { exportTaskId: token });

    expect(reportExports.size).toBe(0);
  });

  it("remembers a bounded number of reports' exports", async () => {
    get.mockImplementation(async ({ url }: { url: string }) =>
      url.includes("scan_run_id=")
        ? ok({ task_id: "t:1", message: "started" })
        : ok({ reportLink: "https://csv?Expires=9999999999" }),
    );

    for (let run = 0; run < MAX_REPORT_EXPORTS + 5; run++) {
      await fetcher().getReportLink({ kind: "scan", scanId: "1234", scanRunId: String(run) });
    }

    expect(reportExports.size).toBe(MAX_REPORT_EXPORTS);
  });

  it("stops waiting when the API says the export failed", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce(ok({ message: "CSV file generation failed. Please initiate a new request by sharing the scan_run_id parameter." }));

    const link = fetcher().getReportLink(SOURCE);
    const outcome = expect(link).rejects.toThrow(/generation failed/);
    await vi.runAllTimersAsync();
    await outcome;
  });
});

describe("AccessibilityReportFetcher scan run history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds the run before a given run of the same scan", async () => {
    get.mockResolvedValueOnce(
      ok({
        scanRuns: [
          { id: 30, scanDate: "2026-10-22T05:54:23Z", issues: 147 },
          { id: 20, scanDate: "2026-10-21T11:31:00Z", issues: 150 },
          { id: 10, scanDate: "2026-10-21T11:14:51Z", issues: 160 },
        ],
        pagination: { hasNext: false },
      }),
    );

    await expect(fetcher().previousScanRun("1234", "30")).resolves.toMatchObject({
      id: 20,
      scanDate: "2026-10-21T11:31:00Z",
    });
    expect(get.mock.calls[0][0].url).toBe(`${API}/website-scanner/v1/scans/1234/scan_runs`);
  });

  it("reads every page of the scan's runs before picking the one before", async () => {
    get
      .mockResolvedValueOnce(
        ok({
          scanRuns: [
            { id: 30, scanDate: "2026-10-22T05:54:23Z", issues: 147 },
            { id: 20, scanDate: "2026-10-21T11:31:00Z", issues: 150 },
          ],
          pagination: { hasNext: true, nextPage: "p2" },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          scanRuns: [{ id: 10, scanDate: "2026-10-21T11:14:51Z", issues: 160 }],
          pagination: { hasNext: false, nextPage: null },
        }),
      );

    await expect(fetcher().previousScanRun("1234", "20")).resolves.toMatchObject({ id: 10 });
    expect(get.mock.calls.map(([o]) => o.url)).toEqual([
      `${API}/website-scanner/v1/scans/1234/scan_runs`,
      `${API}/website-scanner/v1/scans/1234/scan_runs?nextPage=p2`,
    ]);
  });

  it("has no previous run for a scan's first run", async () => {
    get.mockResolvedValueOnce(
      ok({ scanRuns: [{ id: 10, scanDate: "2026-10-21T11:14:51Z", issues: 160 }], pagination: { hasNext: false } }),
    );

    await expect(fetcher().previousScanRun("1234", "10")).resolves.toBeUndefined();
  });

  // The walk stops at MAX_SCAN_RUN_PAGES; a run it did not reach is not the scan's first.
  const runsPages = () => {
    let page = 0;
    get.mockImplementation(async () => {
      page++;
      return ok({
        scanRuns: [{ id: 100 - page, scanDate: `2026-10-${String(30 - page).padStart(2, "0")}T00:00:00Z` }],
        pagination: { hasNext: true, nextPage: `p${page + 1}` },
      });
    });
  };

  it("says when a run is not among the newest runs it read, rather than calling it the first", async () => {
    runsPages();

    await expect(fetcher().previousScanRun("1234", "5")).rejects.toThrow(
      /Run 5 is not among scan 1234's newest runs.*scanRunId as compareWith/s,
    );
    expect(get).toHaveBeenCalledTimes(MAX_SCAN_RUN_PAGES);
  });

  it("says when the run before is older than the runs it read", async () => {
    runsPages();

    await expect(
      fetcher().previousScanRun("1234", String(100 - MAX_SCAN_RUN_PAGES)),
    ).rejects.toThrow(/older than the runs read.*scanRunId as compareWith/s);
  });

  it("says when a run is not a run of the scan", async () => {
    get.mockResolvedValueOnce(
      ok({ scanRuns: [{ id: 10, scanDate: "2026-10-21T11:14:51Z", issues: 160 }], pagination: { hasNext: false } }),
    );

    await expect(fetcher().previousScanRun("1234", "99")).rejects.toThrow(
      /Run 99 is not a run of scan 1234/,
    );
  });

  it("reports a failed read of the scan's runs rather than calling the run the first", async () => {
    get.mockResolvedValueOnce(failed(500, ["Internal server Error"]));

    await expect(fetcher().previousScanRun("1234", "10")).rejects.toThrow(/HTTP 500/);
  });

  it("reads a run's changes since the previous run from its summary", async () => {
    get.mockResolvedValueOnce(
      ok({ scanRunId: 30, time: "2026-10-22T05:54:23Z", changesSinceLastRun: { newIssues: 2, retainedIssues: 145, resolvedIssues: 5 } }),
    );

    await expect(fetcher().changesSinceLastRun("1234", "30")).resolves.toEqual({
      newIssues: 2,
      retainedIssues: 145,
      resolvedIssues: 5,
    });
    expect(get.mock.calls[0][0].url).toBe(`${API}/website-scanner/v1/scans/1234/scan_runs/30`);
  });
});

describe("AccessibilityReportFetcher requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportExports.clear();
  });

  // apiClient sets no timeout of its own, so a hung request would hold the call forever.
  it("puts a timeout on each request, well inside a client's 60 s", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv" }))
      .mockResolvedValueOnce(ok({ scanRuns: [], pagination: { hasNext: false } }))
      .mockResolvedValueOnce(ok({ status: "completed" }))
      .mockResolvedValueOnce(ok({ changesSinceLastRun: null }));
    const f = fetcher();
    const source: IssueSource = { kind: "scan", scanId: "1234", scanRunId: "5678" };

    await f.getReportLink(source);
    await f.previousScanRun("1234", "5678").catch(() => undefined);
    await f.reportStatus(source);
    await f.changesSinceLastRun("1234", "5678");

    expect(get).toHaveBeenCalledTimes(5);
    for (const [options] of get.mock.calls) {
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThan(60_000);
    }
  });
});
