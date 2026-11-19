import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
// Web builds are read from the Accessibility dashboard with a minted token; no auth server here.
vi.mock("../../src/tools/capability-registry/egress.js", async (original) => ({
  ...(await original<typeof import("../../src/tools/capability-registry/egress.js")>()),
  authHeaders: vi.fn(async () => ({ Authorization: "Bearer test-token" })),
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { getAutomationBaseUrl } from "../../src/tools/rca-agent-utils/constants.js";
import {
  AccessibilityReportFetcher,
  EXPORT_WAIT_MS,
  ExportPendingError,
  IssueSource,
  MAX_SCAN_LIST_PAGES,
  SCORE_SCAN_LIST_PAGES,
  reportExports,
  MAX_REPORT_EXPORTS,
  foundScanRuns,
} from "../../src/tools/accessiblity-utils/report-fetcher.js";

// Runs found by build id are cached for the process; each test starts without them.
beforeEach(() => foundScanRuns.clear());

const get = apiClient.get as Mock;
const post = apiClient.post as Mock;
const API = "https://api-accessibility.browserstack.com/api";
const BUILD_ID = "q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja";

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  data: { success: true, data },
});
/** The dashboard's build metadata answer: `metaData`, not `data`. */
const meta = (metaData: unknown) => ({
  ok: true,
  status: 200,
  data: { success: true, metaData, info: [] },
});
const WEB = "https://accessibility.browserstack.com/api";
const BUILD_META = `${WEB}/projects/_/test_runs/_/meta?th_build_id=${BUILD_ID}`;
const BUILD_OVERVIEW = `${WEB}/projects/_/test_runs/_/overview?th_build_id=${BUILD_ID}`;
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

  it("exports a Website Scanner run named by its scan's ids through the External API", async () => {
    get
      .mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv" }));

    await expect(
      fetcher().getReportLink({ kind: "scan", scanId: "1234", scanRunId: "5678" }),
    ).resolves.toBe("https://csv");
    expect(get.mock.calls.map(([options]) => options.url)).toEqual([
      `${API}/website-scanner/v1/scans/1234/scan_runs/issues?scan_run_id=5678`,
      `${API}/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A1`,
    ]);
    expect(get.mock.calls[0][0].headers).toEqual({
      Authorization: `Basic ${Buffer.from("u:p").toString("base64")}`,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it.each<[string, IssueSource, Record<string, unknown>]>([
    ["an Automated Tests build", { kind: "build", buildId: BUILD_ID }, { type: "automatedTest", th_build_id: BUILD_ID }],
    ["a Workflow Analyzer report", { kind: "workflow", reportId: "123456" }, { type: "workflowScan", report_id: "123456" }],
    ["a Website Scanner run named by its build id", { kind: "scanBuild", thBuildId: BUILD_ID }, { type: "websiteScan", th_build_id: BUILD_ID }],
  ])("exports %s through the dashboard", async (_label, source, body) => {
    post.mockResolvedValueOnce(ok({ id: 42 }));
    get.mockResolvedValueOnce(ok({ url: "https://csv" }));

    await expect(fetcher().getReportLink(source)).resolves.toBe("https://csv");
    expect(post.mock.calls[0][0]).toMatchObject({ url: `${WEB}/export_reports`, body });
    expect(post.mock.calls[0][0].headers.Authorization).toBe("Bearer test-token");
    expect(get.mock.calls.map(([options]) => options.url)).toEqual([`${WEB}/export_reports/42`]);
  });

  it("says which id a build needs when the dashboard does not find it", async () => {
    post.mockResolvedValueOnce({ ok: false, status: 404, data: { success: false, message: "TestRun Not Found" } });

    await expect(
      fetcher().getReportLink({
        kind: "build",
        buildId: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
      }),
    ).rejects.toThrow(/TestRun Not Found.*thBuildId.*not the Automate build id/s);
  });

  it("passes on the dashboard's reason when it rejects a report id", async () => {
    post.mockResolvedValueOnce({ ok: false, status: 422, data: { success: false, message: "Report id must be an Integer" } });

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

  // A Website Scanner link is read by its run's build id; the scan list is searched only for
  // what needs the scan's ids (comparing runs), or when the API does not know the build id.
  const linkRun = (scanName: string, thBuildId: string) =>
    ({ kind: "scanBuild", thBuildId, scanName }) as const;

  it("finds a Website Scanner link's scan and latest run by paging the scan list", async () => {
    get
      .mockResolvedValueOnce(scansPage([scan(1, "other", "aaa", 11)], "tok2"))
      .mockResolvedValueOnce(
        scansPage([scan(1234, "checkout fix", "bbb", 5678)]),
      );

    await expect(
      fetcher().findScanRun(linkRun("checkout fix", "bbb")),
    ).resolves.toEqual({ kind: "scan", scanId: "1234", scanRunId: "5678" });
    // No limit: larger pages make the list skip scans, so it is walked at its default size.
    expect(get.mock.calls.map(([options]) => options.url)).toEqual([
      `${API}/website-scanner/v1/scans`,
      `${API}/website-scanner/v1/scans?nextPage=tok2`,
    ]);
  });

  it("remembers the run a link's build id names, so a second lookup does not walk the list again", async () => {
    get
      .mockResolvedValueOnce(scansPage([scan(1, "other", "aaa", 11)], "tok2"))
      .mockResolvedValueOnce(scansPage([scan(1234, "checkout fix", "bbb", 5678)]));

    const first = await fetcher().findScanRun(linkRun("checkout fix", "bbb"));
    get.mockClear();
    const again = await fetcher().findScanRun(linkRun("checkout fix", "bbb"));

    expect(again).toEqual(first);
    expect(get).not.toHaveBeenCalled();
  });

  it("names the scan when the link is to one of its earlier runs", async () => {
    get.mockResolvedValueOnce(
      scansPage([scan(1234, "checkout fix", "newer", 5678)]),
    );

    await expect(
      fetcher().findScanRun(linkRun("checkout fix", "older")),
    ).rejects.toThrow(/earlier run of scan "checkout fix" \(scanId 1234\)/);
  });

  it("stops after the newest scans and asks for the ids", async () => {
    get.mockResolvedValue(scansPage([scan(1, "other", "aaa", 11)], "more"));

    await expect(
      fetcher().findScanRun(linkRun("checkout fix", "bbb")),
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

    await expect(
      fetcher().findScanRun({ kind: "scanBuild", thBuildId: "bbb", scanName: "checkout" }),
    ).rejects.toThrow(/scan 1234 has no completed run/);
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
      .mockResolvedValueOnce(meta({ name: "Checkout", projectName: "Web" }));

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/${AUTOMATE_BUILD}/sessions/${SESSION}`,
      ),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(urls()).toEqual([testCodeUrl, BUILD_META]);
  });

  it("maps a build link through one of its sessions", async () => {
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ automation_session: { hashed_id: SESSION } }],
      })
      .mockResolvedValueOnce(testCode(BUILD_ID))
      .mockResolvedValueOnce(meta({ name: "Checkout", projectName: "Web" }));

    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/${AUTOMATE_BUILD}`),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(urls()[0]).toBe(
      `https://api.browserstack.com/automate/builds/${AUTOMATE_BUILD}/sessions.json?limit=1`,
    );
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

  it("reads a Workflow Analyzer report's status from its dashboard summary", async () => {
    get.mockResolvedValueOnce(ok({ meta_v2: { "workflowScan:123456": { status: "completed" } } }));

    await expect(
      fetcher().reportStatus({ kind: "workflow", reportId: "123456" }),
    ).resolves.toBe("completed");
    expect(urls()).toEqual([`${WEB}/tests/consolidate?ids=123456&view=summary`]);
  });

  it("reads a build's status from its dashboard metadata", async () => {
    get.mockResolvedValueOnce(meta({ status: "finalizing", projectName: "Checkout" }));

    await expect(
      fetcher().reportStatus({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toBe("finalizing");
    expect(urls()).toEqual([BUILD_META]);
  });

  it("reads a completed build with no test cases as failed, as the dashboard's build list does", async () => {
    get
      .mockResolvedValueOnce(meta({ status: "completed" }))
      .mockResolvedValueOnce(ok({ healthSummary: { total: 0, passed: 0, failed: 0 } }));

    await expect(
      fetcher().reportStatus({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toBe("failed");
    expect(urls()).toEqual([BUILD_META, BUILD_OVERVIEW]);

    get
      .mockResolvedValueOnce(meta({ status: "completed" }))
      .mockResolvedValueOnce(ok({ healthSummary: { total: 4 } }));
    await expect(
      fetcher().reportStatus({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toBe("completed");
  });

  it("returns nothing when the status cannot be read", async () => {
    get.mockResolvedValueOnce(failed(500, ["Internal server Error"]));

    await expect(
      fetcher().reportStatus({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toBeUndefined();
  });
});

// The run the compare API would pick is matched by TestHub's own build name, which a list row
// carries escaped as `normalisedName`; the displayed `name` can be an account's original name.
describe("AccessibilityReportFetcher.previousWebBuild", () => {
  beforeEach(() => vi.clearAllMocks());

  const list = (testRuns: unknown[]) => ({
    ok: true,
    status: 200,
    data: { success: true, info: { next: null }, testRuns },
  });
  const row = (thBuildId: string, name: string, normalisedName: string, buildNumber: number) => ({
    thBuildId,
    name,
    normalisedName,
    buildNumber,
    createdAt: `2026-11-0${buildNumber}T00:00:00Z`,
    status: "completed",
  });

  it("matches by TestHub's name, not the displayed one", async () => {
    get.mockResolvedValueOnce(
      list([
        row(BUILD_ID, "Checkout (renamed)", "nightly", 3),
        row("b2", "Checkout nightly", "other", 2),
        row("b1", "Some original name", "nightly", 1),
      ]),
    );

    await expect(
      fetcher().previousWebBuild({ buildId: BUILD_ID, name: "Checkout (renamed)", projectName: "Web" }),
    ).resolves.toMatchObject({ buildId: "b1", buildNumber: 1, status: "completed" });
    expect(get.mock.calls[0][0].url).toBe(
      `${WEB}/test_runs?project_name=Web&sort_by=id-desc&page_size=30&page=1`,
    );
  });

  it("finds none before the build's own row is reached", async () => {
    get.mockResolvedValueOnce(list([row("older", "x", "nightly", 1)]));

    await expect(
      fetcher().previousWebBuild({ buildId: BUILD_ID, name: "x", projectName: "Web" }),
    ).resolves.toBeUndefined();
  });
});

// The report before a Workflow Analyzer report: the newest earlier one that scanned one of its
// pages. Each candidate's pages come from a whole consolidation, so only reports that started
// before this one are read, at most 10, a few at a time; sample reports are never candidates.
describe("AccessibilityReportFetcher.previousWorkflowReport", () => {
  beforeEach(() => vi.clearAllMocks());

  const summary = (id: string, time: string, urls: string[]) =>
    ok({
      meta_v2: { [`workflowScan:${id}`]: { status: "completed", startTimestamp: time } },
      chartData: { issueCountByURL: urls.map((url) => ({ url, count: 1 })) },
    });
  const reports = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
    ok: true,
    status: 200,
    data: { reports: rows, info: { next: null }, isColdStart: false, ...extra },
  });
  const row = (id: number, time: string, status = "completed") => ({ id, time, status });
  const route = (answers: Record<string, unknown>) =>
    get.mockImplementation(async ({ url }: { url: string }) => {
      const id = new URL(url).searchParams.get("ids");
      if (id) return answers[id] ?? { ok: false, status: 404, data: {} };
      return answers.list;
    });

  it("returns the newest earlier report of the same page, reading only earlier ones", async () => {
    route({
      "10": summary("10", "2026-11-10T00:00:00Z", ["https://shop.example/cart"]),
      list: reports([
        row(12, "2026-11-12T00:00:00Z"), // newer: never read
        row(10, "2026-11-10T00:00:00Z"), // this report
        row(9, "2026-11-09T00:00:00Z", "processing"), // not completed: skipped
        row(8, "2026-11-08T00:00:00Z"),
        row(7, "2026-11-07T00:00:00Z"),
      ]),
      "8": summary("8", "2026-11-08T00:00:00Z", ["https://shop.example/other"]),
      "7": summary("7", "2026-11-07T00:00:00Z", ["https://shop.example/cart"]),
    });

    await expect(fetcher().previousWorkflowReport("10")).resolves.toMatchObject({
      reportId: "7",
      samePage: true,
    });
    const read = get.mock.calls.map(([o]) => new URL(o.url).searchParams.get("ids")).filter(Boolean);
    expect(read).toEqual(["10", "8", "7"]);
    expect(get.mock.calls[1][0].url).toBe(
      `${WEB}/v1/reports?product=workflow-analyzer&page_size=99&page=1`,
    );
  });

  it("falls back to an earlier report of the same site", async () => {
    route({
      "10": summary("10", "2026-11-10T00:00:00Z", ["https://shop.example/cart"]),
      list: reports([row(10, "2026-11-10T00:00:00Z"), row(8, "2026-11-08T00:00:00Z")]),
      "8": summary("8", "2026-11-08T00:00:00Z", ["https://shop.example/other"]),
    });

    await expect(fetcher().previousWorkflowReport("10")).resolves.toMatchObject({
      reportId: "8",
      samePage: false,
    });
  });

  it("does not take sample reports an account with no reports is shown", async () => {
    route({
      "10": summary("10", "2026-11-10T00:00:00Z", ["https://shop.example/cart"]),
      list: reports([row(10, "2026-11-10T00:00:00Z"), row(1, "2026-01-01T00:00:00Z")], {
        isColdStart: true,
      }),
    });

    await expect(fetcher().previousWorkflowReport("10")).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reads at most 10 candidates", async () => {
    const rows = [row(100, "2026-11-30T00:00:00Z")];
    const answers: Record<string, unknown> = {
      "100": summary("100", "2026-11-30T00:00:00Z", ["https://shop.example/cart"]),
    };
    for (let i = 1; i <= 15; i++) {
      rows.push(row(100 - i, `2026-11-${String(30 - i).padStart(2, "0")}T00:00:00Z`));
      answers[String(100 - i)] = summary(String(100 - i), "2026-01-01T00:00:00Z", ["https://elsewhere.example/"]);
    }
    route({ ...answers, list: reports(rows) });

    await expect(fetcher().previousWorkflowReport("100")).resolves.toBeUndefined();
    const read = get.mock.calls.map(([o]) => new URL(o.url).searchParams.get("ids")).filter(Boolean);
    expect(read).toHaveLength(1 + 10);
  });
});

describe("AccessibilityReportFetcher.sourceFromReportUrl and a shared report link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the dashboard link a scanner share link carries", async () => {
    const inner = `https://accessibility.browserstack.com/site-scanner/projects/checkout/builds?thBuildId=bbb&recurring=false`;
    const share = `https://scanner.browserstack.com/site-scanner/checkout/a11y-report?reportUrl=${encodeURIComponent(inner)}&minimal=true&report_source=private_share`;

    await expect(fetcher().sourceFromReportUrl(share)).resolves.toEqual({
      kind: "scanBuild",
      thBuildId: "bbb",
      scanName: "checkout",
    });
    expect(get).not.toHaveBeenCalled();
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

  it("hands back the export's task id when it is still running after the wait", async () => {
    get.mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }));
    get.mockResolvedValue(pending);

    const link = fetcher().getReportLink(SOURCE);
    const outcome = expect(link).rejects.toMatchObject({ taskId: "t:1" });
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await outcome;
    await expect(link).rejects.toBeInstanceOf(ExportPendingError);
  });

  it("continues an export it was given instead of starting another", async () => {
    get.mockResolvedValueOnce(ok({ reportLink: "https://csv" }));

    await expect(
      fetcher().getReportLink(SOURCE, { exportTaskId: "t:9" }),
    ).resolves.toBe("https://csv");
    expect(urls()).toEqual([
      "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/1234/scan_runs/issues?task_id=t%3A9",
    ]);
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

  it("does not keep the task of an export started while the report is processing", async () => {
    get.mockResolvedValueOnce(ok({ task_id: "t:1", message: "started" }));
    get.mockResolvedValue(pending);
    const first = fetcher().getReportLink(SOURCE, { stillProcessing: true });
    const pendingFirst = expect(first).rejects.toBeInstanceOf(ExportPendingError);
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await pendingFirst;

    // Once the report has finished, the next call starts a new export instead of taking
    // the snapshot that one was making as final.
    get.mockReset();
    get
      .mockResolvedValueOnce(ok({ task_id: "t:2", message: "started" }))
      .mockResolvedValueOnce(ok({ reportLink: "https://csv2?Expires=9999999999" }));
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe("https://csv2?Expires=9999999999");
    expect(urls()[0]).toBe(
      "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/1234/scan_runs/issues?scan_run_id=5678",
    );
    expect(urls().some((u) => u.includes("task_id=t%3A1"))).toBe(false);
  });

  it("reuses a run read by its build id for 5 minutes at most, as its processing status is not checked", async () => {
    const BY_BUILD_ID: IssueSource = { kind: "scanBuild", thBuildId: BUILD_ID };
    const expires = Math.floor(Date.now() / 1000) + 12 * 3600;
    post.mockResolvedValueOnce(ok({ id: 1 }));
    get.mockResolvedValueOnce(ok({ url: `https://csv?Expires=${expires}` }));

    await fetcher().getReportLink(BY_BUILD_ID);
    vi.setSystemTime(Date.now() + 4 * 60 * 1000);
    await expect(fetcher().getReportLink(BY_BUILD_ID)).resolves.toBe(`https://csv?Expires=${expires}`);
    expect(post).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    post.mockResolvedValueOnce(ok({ id: 2 }));
    get.mockResolvedValueOnce(ok({ url: "https://csv2?Expires=9999999999" }));
    await expect(fetcher().getReportLink(BY_BUILD_ID)).resolves.toBe("https://csv2?Expires=9999999999");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("remembers a bounded number of reports' exports", async () => {
    get.mockResolvedValue(ok({ reportLink: "https://csv?Expires=9999999999" }));

    for (let run = 0; run < MAX_REPORT_EXPORTS + 5; run++) {
      await fetcher().getReportLink(
        { kind: "scan", scanId: "1234", scanRunId: String(run) },
        { exportTaskId: `t:${run}` },
      );
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

// The dashboard's export: POST queues it and returns an id; GET answers 410 until it finishes
// (and the same for a failed or expired one), then a presigned link. A 422 means another
// export of the same report is running, one this call has no id for.
describe("AccessibilityReportFetcher.getReportLink through the dashboard", () => {
  const SOURCE: IssueSource = { kind: "build", buildId: BUILD_ID };
  const notReady = { ok: false, status: 410, data: { success: false, message: "Link has expired" } };
  const running = { ok: false, status: 422, data: { success: false, message: "Previous CSV export already in progress" } };

  beforeEach(() => {
    vi.clearAllMocks();
    get.mockReset();
    post.mockReset();
    reportExports.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("waits through 410s on the export it queued until the link is ready", async () => {
    post.mockResolvedValueOnce(ok({ id: 7 }));
    for (let i = 0; i < 4; i++) get.mockResolvedValueOnce(notReady);
    get.mockResolvedValueOnce(ok({ url: "https://csv?Expires=9999999999" }));

    const link = fetcher().getReportLink(SOURCE);
    await vi.runAllTimersAsync();

    await expect(link).resolves.toBe("https://csv?Expires=9999999999");
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(5);
  });

  it("hands back the export id after the wait, and the next call continues that export", async () => {
    post.mockResolvedValueOnce(ok({ id: 7 }));
    get.mockResolvedValue(notReady);
    const first = fetcher().getReportLink(SOURCE);
    const pending = expect(first).rejects.toMatchObject({ taskId: "7" });
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await pending;

    get.mockReset();
    get.mockResolvedValueOnce(ok({ url: "https://csv" }));
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe("https://csv");
    expect(post).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0].url).toBe(`${WEB}/export_reports/7`);
  });

  it("retries the create while another export of the report is running, then follows its own", async () => {
    post.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValueOnce(ok({ id: 8 }));
    get.mockResolvedValueOnce(ok({ url: "https://csv" }));

    const link = fetcher().getReportLink(SOURCE);
    await vi.runAllTimersAsync();

    await expect(link).resolves.toBe("https://csv");
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("says so without an id when the other export is still running after the wait", async () => {
    post.mockResolvedValue(running);

    const link = fetcher().getReportLink(SOURCE);
    const outcome = expect(link).rejects.toMatchObject({ taskId: undefined });
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await outcome;
    await expect(link).rejects.toBeInstanceOf(ExportPendingError);
  });

  it("starts a new export instead of following one left running for over 15 minutes", async () => {
    post.mockResolvedValueOnce(ok({ id: 7 }));
    get.mockResolvedValue(notReady);
    const first = fetcher().getReportLink(SOURCE);
    const pending = expect(first).rejects.toBeInstanceOf(ExportPendingError);
    await vi.advanceTimersByTimeAsync(EXPORT_WAIT_MS + 10_000);
    await pending;

    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    get.mockReset();
    post.mockResolvedValueOnce(ok({ id: 9 }));
    get.mockResolvedValueOnce(ok({ url: "https://csv" }));
    await expect(fetcher().getReportLink(SOURCE)).resolves.toBe("https://csv");
    expect(get.mock.calls[0][0].url).toBe(`${WEB}/export_reports/9`);
  });

  it("fails on an answer other than 410 while waiting", async () => {
    post.mockResolvedValueOnce(ok({ id: 7 }));
    get.mockResolvedValueOnce({ ok: false, status: 403, data: { success: false } });

    await expect(fetcher().getReportLink(SOURCE)).rejects.toThrow(/HTTP 403/);
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

describe("AccessibilityReportFetcher.score", () => {
  beforeEach(() => vi.clearAllMocks());

  // As the API returns it (scan 4320391 run 2442237): the bare severity is the share of points lost.
  const SCORE_DATA = {
    score: 52,
    impact: {
      critical: 19, criticalPassed: 5, criticalFailed: 3,
      serious: 27, seriousPassed: 14, seriousFailed: 6,
      moderate: 2, moderatePassed: 5, moderateFailed: 1,
      minor: 0, minorPassed: 2, minorFailed: 0,
    },
  };
  const SCORE = {
    score: 52,
    severities: [
      { severity: "critical", lost: 19, passed: 5, failed: 3 },
      { severity: "serious", lost: 27, passed: 14, failed: 6 },
      { severity: "moderate", lost: 2, passed: 5, failed: 1 },
      { severity: "minor", lost: 0, passed: 2, failed: 0 },
    ],
  };

  it.each<[string, IssueSource, string]>([
    ["a Website Scanner run", { kind: "scan", scanId: "1234", scanRunId: "30" }, `${API}/website-scanner/v1/scans/1234/scan_runs/30`],
    ["an Automated Tests build", { kind: "build", buildId: BUILD_ID }, BUILD_OVERVIEW],
    ["a Workflow Analyzer report", { kind: "workflow", reportId: "278684" }, `${WEB}/tests/consolidate?ids=278684&view=summary`],
  ])("reads %s's score from its summary", async (_name, source, url) => {
    get.mockResolvedValueOnce(ok({ scoreData: SCORE_DATA }));

    await expect(fetcher().score(source)).resolves.toEqual(SCORE);
    expect(get.mock.calls[0][0].url).toBe(url);
  });

  it("has no score when the summary carries none: a plan without scores, or an unfinished report", async () => {
    get.mockResolvedValueOnce(ok({ scoreData: {} }));
    await expect(fetcher().score({ kind: "workflow", reportId: "1" })).resolves.toBeUndefined();

    get.mockResolvedValueOnce(ok({ status: "completed" }));
    await expect(fetcher().score({ kind: "scan", scanId: "1", scanRunId: "2" })).resolves.toBeUndefined();
  });

  it("has no score when the summary cannot be read", async () => {
    get.mockResolvedValueOnce(failed(404, ["Scan run not found"]));
    await expect(fetcher().score({ kind: "scan", scanId: "1", scanRunId: "2" })).resolves.toBeUndefined();

    get.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(fetcher().score({ kind: "build", buildId: BUILD_ID })).resolves.toBeUndefined();
  });

  it("finds a scanner run known only by its build id in the scan list, then reads its score", async () => {
    get
      .mockResolvedValueOnce(
        ok({
          scans: [{ id: 4320391, name: "home", scanUrl: `https://accessibility.browserstack.com/site-scanner/projects/home/builds?thBuildId=${BUILD_ID}`, lastScanDetails: { scanRunId: 2442237 } }],
          pagination: { hasNext: false },
        }),
      )
      .mockResolvedValueOnce(ok({ scoreData: SCORE_DATA }));

    await expect(fetcher().score({ kind: "scanBuild", thBuildId: BUILD_ID })).resolves.toEqual(SCORE);
    expect(get.mock.calls[1][0].url).toBe(`${API}/website-scanner/v1/scans/4320391/scan_runs/2442237`);
  });

  it("has no score for a scanner build id the scan list does not have", async () => {
    get.mockResolvedValueOnce(ok({ scans: [], pagination: { hasNext: false } }));

    await expect(fetcher().score({ kind: "scanBuild", thBuildId: BUILD_ID })).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("looks for a scanner run's score in the newest 2 pages of the scan list only", async () => {
    // A link to an earlier run is never in the list, which shows each scan's latest run only:
    // a full walk (~1.2 s a page) would hold up the issues read with it, on every first page.
    const page = (n: number) =>
      ok({
        scans: [{ id: n, name: `scan ${n}`, scanUrl: `https://accessibility.browserstack.com/site-scanner/projects/p/builds?thBuildId=latest-${n}`, lastScanDetails: { scanRunId: n } }],
        pagination: { hasNext: true, nextPage: `p${n + 1}` },
      });
    get.mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(2));

    await expect(fetcher().score({ kind: "scanBuild", thBuildId: "an-earlier-run" })).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(SCORE_SCAN_LIST_PAGES);
    expect(SCORE_SCAN_LIST_PAGES).toBeLessThan(MAX_SCAN_LIST_PAGES);
  });

  it.each<[string, IssueSource]>([
    ["an app build", { kind: "appBuild", buildId: "app-1" }],
    ["an app report", { kind: "appReport", reportId: "9" }],
  ])("does not look for a score on %s", async (_name, source) => {
    await expect(fetcher().score(source)).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
});
