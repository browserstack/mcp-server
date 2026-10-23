import { createHash } from "node:crypto";
import { apiClient, type RequestOptions } from "../../lib/apiClient.js";
import { SessionType } from "../../lib/constants.js";
import { sessionsListUrl } from "../automate-utils/list-session-ids.js";
import { getAutomationBaseUrl } from "../rca-agent-utils/constants.js";

interface ReportInitResponse {
  success: true;
  data: { task_id: string; message: string };
  error?: any;
}

interface ReportResponse {
  success: true;
  data: { reportLink: string };
  error?: any;
}

/** What to read issues from: a Website Scanner run, an Automated Tests build or a Workflow Analyzer report. */
export type IssueSource =
  | { kind: "scan"; scanId: string; scanRunId: string }
  | { kind: "build"; buildId: string }
  | { kind: "workflow"; reportId: string };

const API_BASE = "https://api-accessibility.browserstack.com/api";

/**
 * How far a report link's scan is searched for. The scan list has no name or link filter and
 * spans the whole organisation, so the walk covers only the newest scans, which is where a
 * link someone just opened will be. It runs at the list's default page size (~1.2 s a page):
 * at limit=50 or 100 the cursor skips scans, so a larger page cannot be used to go faster.
 */
export const MAX_SCAN_LIST_PAGES = 15;
/** How many pages of a scan's runs are read to find the run before a given one. */
export const MAX_SCAN_RUN_PAGES = 10;

/**
 * How many of an Automate build's sessions are tried for the SDK build they ran in. A build
 * can mix sessions run through the SDK with ones that were not, so one session is not enough.
 */
const AUTOMATE_SESSIONS_TRIED = 5;

/**
 * Each request's timeout. apiClient sets none, so a request the API never answers would hold
 * the call past the 60 s MCP clients wait; these endpoints answer in a second or two.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** A build whose status is checked is one just run, so it sits at the top of its project's list. */
const MAX_BUILD_LIST_PAGES = 3;

interface ScanListPage {
  scans?: {
    id: number;
    name: string;
    scanUrl?: string;
    lastScanDetails?: { scanRunId?: number };
  }[];
  pagination?: { hasNext?: boolean; nextPage?: string };
}

/**
 * How long one call waits on a CSV export, counted from its start request. Export time grows
 * with the report's rows: a few seconds for hundreds, ~17 s for 18k rows, over 2 minutes for
 * 30k issues. With the start request and a last poll inside it, a call stays clear of the
 * 60 s request timeout MCP clients default to; an export still running after this is handed
 * back to be continued by the next call rather than started again.
 */
export const EXPORT_WAIT_MS = 40_000;
const EXPORT_POLL_MS = [1000, 2000, 3000, 5000];

/**
 * An export still pending this long after it started is taken to be stuck and is started
 * again: the largest reports export in a few minutes, and a task the API has lost would
 * otherwise be polled by every later call.
 */
export const EXPORT_TASK_MAX_AGE_MS = 10 * 60 * 1000;

/** A finished export's link is reused until shortly before it expires (about 12 hours). */
const LINK_EXPIRY_MARGIN_MS = 10 * 60 * 1000;
const LINK_FALLBACK_TTL_MS = 60 * 60 * 1000;

/** An export the API is generating: its task, and when it was started. */
interface ExportTask {
  taskId: string;
  startedAt: number;
  /** Started while the report was still adding issues: its CSV is a snapshot, never kept. */
  partial?: boolean;
}

type ExportEntry = { link: string; expiresAt: number } | ExportTask;

/**
 * Exports per report: the finished link to reuse for later pages, or the task of an export
 * still running, to continue instead of starting another. Keyed by the account and the
 * report, so one account never sees another's, and bounded, oldest dropped first.
 */
export const reportExports = new Map<string, ExportEntry>();
export const MAX_REPORT_EXPORTS = 200;

function rememberExport(key: string, entry: ExportEntry): void {
  reportExports.delete(key);
  reportExports.set(key, entry);
  for (const oldest of reportExports.keys()) {
    if (reportExports.size <= MAX_REPORT_EXPORTS) break;
    reportExports.delete(oldest);
  }
}

/**
 * An export still being generated when a call stopped waiting on it. `taskId` is the token
 * to continue it with (see exportToken), not the API's task id.
 */
export class ExportPendingError extends Error {
  constructor(
    readonly taskId: string,
    readonly waitedMs: number,
  ) {
    super(
      `The report's CSV export is still being generated after ${Math.round(waitedMs / 1000)}s.`,
    );
    this.name = "ExportPendingError";
  }
}

/** A report's key, the same whether its ids came as numbers (from the API) or strings. */
function reportKey(source: IssueSource): string {
  switch (source.kind) {
    case "scan":
      return `scan:${source.scanId}:${source.scanRunId}`;
    case "build":
      return `build:${source.buildId}`;
    case "workflow":
      return `workflow:${source.reportId}`;
  }
}

const reportHash = (key: string) =>
  createHash("sha256").update(key).digest("hex").slice(0, 16);

/**
 * What a call hands out to continue an export: the task, bound to its report and carrying
 * when it started. The task id alone would let another report's export be continued here,
 * and its CSV kept and served as this report's.
 */
function exportToken(task: ExportTask, key: string): string {
  return Buffer.from(
    JSON.stringify({
      t: task.taskId,
      r: reportHash(key),
      s: task.startedAt,
      ...(task.partial ? { p: 1 } : {}),
    }),
  ).toString("base64url");
}

/** The task a token names, if the token is one handed out for this report. */
function readExportToken(token: string, key: string): ExportTask {
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    parsed = undefined;
  }
  if (
    typeof parsed?.t !== "string" ||
    !parsed.t ||
    typeof parsed.r !== "string" ||
    !Number.isFinite(parsed.s)
  ) {
    throw new Error(
      "exportTaskId is not an export this tool handed out: call without it to start this report's export",
    );
  }
  if (parsed.r !== reportHash(key)) {
    throw new Error(
      "exportTaskId is another report's export: pass it with the report it was handed out for, or call without it to start this report's export",
    );
  }
  return {
    taskId: parsed.t,
    startedAt: parsed.s,
    ...(parsed.p ? { partial: true } : {}),
  };
}

/** When a presigned export link stops working, from its Expires parameter. */
function linkExpiry(link: string): number {
  try {
    const expires = Number(new URL(link).searchParams.get("Expires"));
    if (expires > 0) return expires * 1000 - LINK_EXPIRY_MARGIN_MS;
  } catch {
    // Not a URL we can read; fall back below.
  }
  return Date.now() + LINK_FALLBACK_TTL_MS;
}

/** A run in a scan's history, newest first in the API's list. */
export interface ScanRun {
  id: number;
  scanDate: string;
  issues?: number;
}

/** What the dashboard counts between a run and the run before it. */
export interface RunChanges {
  newIssues: number;
  retainedIssues: number;
  resolvedIssues: number;
}

/** The thBuildId a dashboard report link carries, if any. */
function thBuildIdOf(link: string | undefined): string | null {
  try {
    return link ? new URL(link).searchParams.get("thBuildId") : null;
  } catch {
    return null;
  }
}

/**
 * Each source exports its issues the same way: one call starts a CSV export and returns a
 * task id, and the same route polled with that task id returns the link. Only the route and
 * its parameter names differ (the scanner's are snake_case, the other two camelCase).
 */
function exportUrls(source: IssueSource): {
  start: string;
  poll: (taskId: string) => string;
} {
  const q = encodeURIComponent;
  switch (source.kind) {
    case "scan": {
      const route = `${API_BASE}/website-scanner/v1/scans/${q(source.scanId)}/scan_runs/issues`;
      return {
        start: `${route}?scan_run_id=${q(source.scanRunId)}`,
        poll: (taskId) => `${route}?task_id=${q(taskId)}`,
      };
    }
    case "build": {
      const route = `${API_BASE}/automated-tests/v1/builds/issues`;
      return {
        start: `${route}?buildUuid=${q(source.buildId)}`,
        poll: (taskId) => `${route}?taskId=${q(taskId)}`,
      };
    }
    case "workflow": {
      const route = `${API_BASE}/workflow-analyzer/v1/reports/issues`;
      return {
        start: `${route}?reportId=${q(source.reportId)}`,
        poll: (taskId) => `${route}?taskId=${q(taskId)}`,
      };
    }
  }
}

/** Why an export did not start, in the API's words, and where a build's id comes from when it is not found. */
function startFailure(source: IssueSource, status: number, body: any): string {
  const reason =
    [body?.error].flat().filter(Boolean).join("; ") ||
    body?.data?.message ||
    `HTTP ${status}`;
  // The API takes only its own build id; the Automate build id is a 404 "Build not found".
  const hint =
    status === 404 && source.kind === "build"
      ? ". Pass the Accessibility build id: the thBuildId in the build's accessibility report link (40 lowercase letters and digits), not the Automate build id or the build name. For an Automate build or session, pass its Automate dashboard link as reportUrl"
      : "";
  return `Failed to initiate report: ${reason}${hint}`;
}

/** The build and session ids an Automate dashboard link carries, if it is one. */
function automateIds(
  url: URL,
): { buildId?: string; sessionId?: string } | undefined {
  if (url.hostname !== "automate.browserstack.com") return undefined;
  return {
    buildId: url.pathname.match(/\/builds\/([0-9a-f]{40})(?:\/|$)/i)?.[1],
    sessionId: url.pathname.match(/\/sessions\/([0-9a-f]{40})(?:\/|$)/i)?.[1],
  };
}

export class AccessibilityReportFetcher {
  private auth: { username: string; password: string } | undefined;

  public setAuth(auth: { username: string; password: string }): void {
    this.auth = auth;
  }

  private authHeaders(): Record<string, string> | undefined {
    if (!this.auth) return undefined;
    const { username, password } = this.auth;
    return {
      Authorization:
        "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    };
  }

  /**
   * The source a dashboard report link points at. An Automated Tests link carries the build
   * id itself. An Automate build or session link is mapped to that build through a session
   * (see buildOfAutomateSession). A Website Scanner link carries the thBuildId of one run,
   * which only the scan list can map to ids: each scan there carries its latest run's link.
   * A link to an older run therefore matches no scan, and is reported as such rather than
   * guessed at.
   */
  async sourceFromReportUrl(reportUrl: string): Promise<IssueSource> {
    let url: URL | undefined;
    try {
      url = new URL(reportUrl);
    } catch {
      url = undefined;
    }
    // A scanner share link (scanner.browserstack.com/.../a11y-report) carries the dashboard
    // link it shows as its reportUrl parameter.
    const shared = url?.searchParams.get("reportUrl");
    if (shared && shared !== reportUrl) return this.sourceFromReportUrl(shared);
    const automate = url && automateIds(url);
    if (automate?.sessionId) {
      return this.buildOfAutomateSession(automate.sessionId);
    }
    if (automate?.buildId) {
      return this.buildOfAutomateBuild(automate.buildId);
    }
    const thBuildId = url?.searchParams.get("thBuildId");
    if (url && thBuildId && url.pathname.includes("/automated-tests/")) {
      return { kind: "build", buildId: thBuildId };
    }
    const scanName = url?.pathname.match(
      /\/site-scanner\/projects\/([^/]+)\/builds/,
    )?.[1];
    if (thBuildId && scanName) {
      return this.findScanRun(thBuildId, decodeURIComponent(scanName));
    }
    throw new Error(
      "This link does not name a report the API can look up. Pass an Automated Tests or Website Scanner report link from the Accessibility dashboard (both carry thBuildId), an Automate build or session link, or the ids: scanId with scanRunId, buildId, or workflowReportId",
    );
  }

  /**
   * The Accessibility build an Automate build's SDK run made, through its sessions: every
   * session run through the SDK names the same build, but a build can also hold sessions run
   * without it, so its first few are tried in turn until one names a build.
   */
  private async buildOfAutomateBuild(
    automateBuildId: string,
  ): Promise<IssueSource> {
    const resp = await this.get({
      url: `${sessionsListUrl(SessionType.Automate, automateBuildId)}?limit=${AUTOMATE_SESSIONS_TRIED}`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (resp.status === 404) {
      throw new Error(`No Automate build with id ${automateBuildId}`);
    }
    if (!resp.ok) {
      throw new Error(
        `Could not list the sessions of Automate build ${automateBuildId}: HTTP ${resp.status}`,
      );
    }
    const sessionIds: string[] = (Array.isArray(resp.data) ? resp.data : [])
      .map((row: any) => row?.automation_session?.hashed_id)
      .filter(Boolean);
    if (sessionIds.length === 0) {
      throw new Error(`Automate build ${automateBuildId} has no sessions`);
    }
    for (const sessionId of sessionIds) {
      const buildId = await this.sdkBuildOfSession(sessionId);
      if (buildId) return this.accessibilityBuild(buildId);
    }
    throw new Error(
      `Automate build ${automateBuildId} is not linked to a BrowserStack SDK build (none of its first ${sessionIds.length} sessions was run through the SDK, or it belongs to another account), so it has no accessibility results`,
    );
  }

  /**
   * The Accessibility build an Automate session ran in. A session run through the BrowserStack
   * SDK belongs to the SDK's build, whose id is also the Accessibility build id, and the
   * session's test-code record names it (build_uuid). A session run without the SDK has no
   * such record, and an SDK run without accessibility testing has a build the Accessibility
   * API does not know; both are said plainly instead of surfacing later as a bare 404.
   */
  private async buildOfAutomateSession(
    sessionId: string,
  ): Promise<IssueSource> {
    const buildId = await this.sdkBuildOfSession(sessionId);
    if (!buildId) {
      throw new Error(
        `Automate session ${sessionId} is not linked to a BrowserStack SDK build (it was not run through the SDK, or belongs to another account), so it has no accessibility results`,
      );
    }
    return this.accessibilityBuild(buildId);
  }

  /** The SDK build a session's test-code record names, or undefined when it has none. */
  private async sdkBuildOfSession(
    sessionId: string,
  ): Promise<string | undefined> {
    const resp = await this.get({
      url: `${getAutomationBaseUrl()}/ext/v1/sessions/${encodeURIComponent(sessionId)}/testCode`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(
        `Could not read Automate session ${sessionId}: HTTP ${resp.status}`,
      );
    }
    return (resp.ok && resp.data?.build_uuid) || undefined;
  }

  /** An SDK build as an Accessibility build, if accessibility testing was on for it. */
  private async accessibilityBuild(buildId: string): Promise<IssueSource> {
    const build = await this.get({
      url: `${API_BASE}/automated-tests/v1/builds/${encodeURIComponent(buildId)}`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (build.status === 404) {
      throw new Error(
        `This Automate run belongs to build ${buildId}, which has no accessibility results: accessibility testing was not on for it`,
      );
    }
    if (!build.ok) {
      throw new Error(
        `Could not read accessibility build ${buildId} of this Automate run: HTTP ${build.status}`,
      );
    }
    return { kind: "build", buildId };
  }

  /** Walk the newest scans for the one whose own link carries this thBuildId. */
  private async findScanRun(
    thBuildId: string,
    scanName: string,
  ): Promise<IssueSource> {
    let nextPage: string | undefined;
    let sameName: number | undefined;
    for (let page = 0; page < MAX_SCAN_LIST_PAGES; page++) {
      const resp = await this.get({
        url: `${API_BASE}/website-scanner/v1/scans${
          nextPage ? `?nextPage=${encodeURIComponent(nextPage)}` : ""
        }`,
        headers: this.authHeaders(),
      });
      const data: ScanListPage | undefined = resp.data?.data;
      for (const scan of data?.scans ?? []) {
        if (thBuildIdOf(scan.scanUrl) === thBuildId) {
          const scanRunId = scan.lastScanDetails?.scanRunId;
          if (scanRunId === undefined) {
            throw new Error(
              `Website Scanner scan ${scan.id} has no completed run to read yet; wait for it to finish, or pass scanId and scanRunId`,
            );
          }
          return {
            kind: "scan",
            scanId: String(scan.id),
            scanRunId: String(scanRunId),
          };
        }
        if (sameName === undefined && scan.name === scanName) {
          sameName = scan.id;
        }
      }
      if (!data?.pagination?.hasNext || !data.pagination.nextPage) {
        nextPage = undefined;
        break;
      }
      nextPage = data.pagination.nextPage;
    }
    if (sameName !== undefined) {
      throw new Error(
        `This link is to an earlier run of scan "${scanName}" (scanId ${sameName}). A link resolves only to a scan's latest run; ask the user for that run's scanRunId and pass it with scanId ${sameName}, or read the latest run with compareWith: "previous" to compare it with the run before it`,
      );
    }
    // nextPage is still set only when the walk stopped at the page cap, not at the end.
    const searched = nextPage
      ? ` among the most recent scans (${MAX_SCAN_LIST_PAGES} pages)`
      : "";
    throw new Error(
      `No Website Scanner scan${searched} matches this link. Pass scanId and scanRunId instead`,
    );
  }

  /**
   * The CSV link of a report's issues. A finished export is reused until its link expires.
   * Otherwise an export is started, or continued (`exportTaskId`, or the one an earlier call
   * left running), and waited on for up to EXPORT_WAIT_MS; one still running then is handed
   * back as an ExportPendingError carrying the token to continue it with.
   */
  async getReportLink(
    source: IssueSource,
    options: {
      /** A token an earlier ExportPendingError handed out for this report. */
      exportTaskId?: string;
      onWait?: (waitedMs: number) => Promise<void>;
      /**
       * The report is still adding issues: its export is a snapshot, so it is neither
       * reused nor kept, or a call after it finishes would read the stale one.
       */
      stillProcessing?: boolean;
    } = {},
  ): Promise<string> {
    const report = reportKey(source);
    const key = `${this.auth?.username ?? ""}|${report}`;
    const given =
      options.exportTaskId !== undefined
        ? readExportToken(options.exportTaskId, report)
        : undefined;
    const partial = Boolean(options.stillProcessing);
    const known = reportExports.get(key);
    if (!partial && known && "link" in known && known.expiresAt > Date.now()) {
      return known.link;
    }
    // A remembered task is continued only while the report is in the state it was started
    // in, so an export begun mid-processing never stands in for the finished report's.
    const knownTask =
      known && "taskId" in known && Boolean(known.partial) === partial
        ? known
        : undefined;

    const urls = exportUrls(source);
    const started = Date.now();
    let task = given ?? knownTask ?? (await this.startExport(source, partial));
    rememberExport(key, task);

    for (let attempt = 0; ; attempt++) {
      const reportResp = await this.get({
        url: urls.poll(task.taskId),
        headers: this.authHeaders(),
        raise_error: false,
      });
      const reportData:
        | (ReportResponse & { data?: { message?: string } })
        | undefined =
        reportResp.data && typeof reportResp.data === "object"
          ? reportResp.data
          : undefined;
      if (!reportResp.ok || !reportData?.success) {
        reportExports.delete(key);
        const reason = [
          reportResp.ok ? "" : `HTTP ${reportResp.status}`,
          [reportData?.error].flat().filter(Boolean).join("; "),
        ]
          .filter(Boolean)
          .join(": ");
        throw new Error(
          `Failed to fetch report: ${reason || "the API's answer was not a report"}. Call again without exportTaskId to start a new export`,
        );
      }
      const link = reportData.data?.reportLink;
      if (link) {
        if (task.partial || partial) reportExports.delete(key);
        else rememberExport(key, { link, expiresAt: linkExpiry(link) });
        return link;
      }
      const message = reportData.data?.message ?? "";
      if (/generation failed/i.test(message)) {
        reportExports.delete(key);
        throw new Error(`The report's CSV export failed: ${message}`);
      }
      if (Date.now() - task.startedAt >= EXPORT_TASK_MAX_AGE_MS) {
        // Pending this long, the task is taken to be stuck: start the export again.
        task = await this.startExport(source, partial);
        rememberExport(key, task);
        attempt = -1;
        continue;
      }
      const waited = Date.now() - started;
      const pause =
        EXPORT_POLL_MS[Math.min(attempt, EXPORT_POLL_MS.length - 1)];
      // Stop before a pause that would end past the budget, not after it.
      if (waited + pause >= EXPORT_WAIT_MS) {
        throw new ExportPendingError(exportToken(task, report), waited);
      }
      await options.onWait?.(waited);
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }

  /** Start a report's CSV export; `partial` while the report is still adding issues. */
  private async startExport(
    source: IssueSource,
    partial: boolean,
  ): Promise<ExportTask> {
    const startedAt = Date.now();
    const initResp = await this.get({
      url: exportUrls(source).start,
      headers: this.authHeaders(),
      raise_error: false,
    });
    const initData: ReportInitResponse = initResp.data;
    if (!initResp.ok || !initData?.success) {
      throw new Error(startFailure(source, initResp.status, initData));
    }
    return {
      taskId: initData.data.task_id,
      startedAt,
      ...(partial ? { partial: true } : {}),
    };
  }

  /**
   * The run before `scanRunId` in its scan's history, or undefined for the scan's first run.
   * The runs are read newest first, up to MAX_SCAN_RUN_PAGES pages; a run the walk does not
   * reach, or one whose predecessor lies past it, is said as such rather than taken for the
   * first run.
   */
  async previousScanRun(
    scanId: string,
    scanRunId: string,
  ): Promise<ScanRun | undefined> {
    // The runs come a page at a time; the one before may be on a later page.
    const runs: ScanRun[] = [];
    const base = `${API_BASE}/website-scanner/v1/scans/${encodeURIComponent(scanId)}/scan_runs`;
    let nextPage: string | undefined;
    for (let page = 0; page < MAX_SCAN_RUN_PAGES; page++) {
      const resp = await this.get({
        url: nextPage
          ? `${base}?nextPage=${encodeURIComponent(nextPage)}`
          : base,
        headers: this.authHeaders(),
        raise_error: false,
      });
      if (!resp.ok) {
        throw new Error(
          `Could not read the runs of scan ${scanId}: HTTP ${resp.status}`,
        );
      }
      const data = resp.data?.data;
      runs.push(...(data?.scanRuns ?? []));
      if (!data?.pagination?.hasNext || !data.pagination.nextPage) {
        nextPage = undefined;
        break;
      }
      nextPage = data.pagination.nextPage;
    }
    // nextPage is still set only when the walk stopped at the page cap, not at the end.
    const morePages = nextPage !== undefined;
    const newestFirst = [...runs].sort((a, b) =>
      b.scanDate.localeCompare(a.scanDate),
    );
    const at = newestFirst.findIndex((run) => String(run.id) === scanRunId);
    if (at < 0) {
      throw new Error(
        morePages
          ? `Run ${scanRunId} is not among scan ${scanId}'s newest runs (${MAX_SCAN_RUN_PAGES} pages read), so the run before it was not found: pass the earlier run's scanRunId as compareWith`
          : `Run ${scanRunId} is not a run of scan ${scanId}: check the scanId and scanRunId`,
      );
    }
    if (at === newestFirst.length - 1 && morePages) {
      throw new Error(
        `The run before run ${scanRunId} is older than the runs read of scan ${scanId} (${MAX_SCAN_RUN_PAGES} pages): pass the earlier run's scanRunId as compareWith`,
      );
    }
    return newestFirst[at + 1];
  }

  /** The dashboard's new / retained / resolved counts against the run before this one. */
  async changesSinceLastRun(
    scanId: string,
    scanRunId: string,
  ): Promise<RunChanges | undefined> {
    const q = encodeURIComponent;
    const changes = (
      await this.getData(
        `${API_BASE}/website-scanner/v1/scans/${q(scanId)}/scan_runs/${q(scanRunId)}`,
      )
    )?.changesSinceLastRun;
    return changes ?? undefined;
  }

  /**
   * Where the report is in its processing, as the report's own status reads it: `completed`,
   * or `queued` / `running` / `processing` / `finalizing` while issues are still being added.
   * Undefined when it cannot be read. A build's overview carries no status, so a build's comes
   * from its project's build list (newest first), found by id.
   */
  async reportStatus(source: IssueSource): Promise<string | undefined> {
    const q = encodeURIComponent;
    try {
      switch (source.kind) {
        case "scan":
          return (
            await this.getData(
              `${API_BASE}/website-scanner/v1/scans/${q(source.scanId)}/scan_runs/${q(source.scanRunId)}/status`,
            )
          )?.status;
        case "workflow":
          return (
            await this.getData(
              `${API_BASE}/workflow-analyzer/v1/reports/${q(source.reportId)}`,
            )
          )?.summary?.status;
        case "build":
          return await this.buildStatus(source.buildId);
      }
    } catch {
      return undefined;
    }
  }

  private async buildStatus(buildId: string): Promise<string | undefined> {
    const q = encodeURIComponent;
    const project = (
      await this.getData(`${API_BASE}/automated-tests/v1/builds/${q(buildId)}`)
    )?.projectName;
    if (!project) return undefined;
    let nextPage: string | undefined;
    for (let page = 0; page < MAX_BUILD_LIST_PAGES; page++) {
      const data = await this.getData(
        `${API_BASE}/automated-tests/v1/builds?project_name=${q(project)}&limit=100${
          nextPage ? `&next_page=${q(nextPage)}` : ""
        }`,
      );
      const row = data?.builds?.find((build: any) => build.id === buildId);
      if (row) return row.status;
      if (!data?.pagination?.has_next || !data.pagination.next_page) break;
      nextPage = data.pagination.next_page;
    }
    return undefined;
  }

  /** The `data` of a successful API response, or undefined. */
  private async getData(url: string): Promise<any> {
    const resp = await this.get({
      url,
      headers: this.authHeaders(),
      raise_error: false,
    });
    return resp.ok ? resp.data?.data : undefined;
  }

  /** Every request goes through here, so none waits on the API without a timeout. */
  private get(options: RequestOptions) {
    return apiClient.get({ ...options, timeout: REQUEST_TIMEOUT_MS });
  }
}
