import { apiClient } from "../../lib/apiClient.js";

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
const MAX_SCAN_RUN_PAGES = 10;

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
 * How long one call waits on a CSV export. Export time grows with the report's rows: a few
 * seconds for hundreds, ~17 s for 18k rows, over 2 minutes for 30k issues. A call stays well
 * under the 60 s request timeout MCP clients default to; an export still running after this
 * is handed back to be continued by the next call rather than started again.
 */
export const EXPORT_WAIT_MS = 45_000;
const EXPORT_POLL_MS = [1000, 2000, 3000, 5000];

/** A finished export's link is reused until shortly before it expires (about 12 hours). */
const LINK_EXPIRY_MARGIN_MS = 10 * 60 * 1000;
const LINK_FALLBACK_TTL_MS = 60 * 60 * 1000;

/**
 * Exports per report, kept for the life of the server: the finished link to reuse for later
 * pages, or the task of an export still running, to continue instead of starting another.
 * Keyed by the account and the report, so one account never sees another's.
 */
export const reportExports = new Map<
  string,
  { link?: string; expiresAt?: number; taskId?: string }
>();

/** An export still being generated when a call stopped waiting on it. */
export class ExportPendingError extends Error {
  constructor(
    readonly taskId: string,
    readonly waitedMs: number,
  ) {
    super(
      `The report's CSV export is still being generated after ${Math.round(waitedMs / 1000)}s (export task ${taskId}).`,
    );
    this.name = "ExportPendingError";
  }
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
      ? ". Pass the Accessibility build id: the thBuildId in the build's accessibility report link (40 lowercase letters and digits), not the Automate build id or the build name"
      : "";
  return `Failed to initiate report: ${reason}${hint}`;
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
   * id itself. A Website Scanner link carries the thBuildId of one run, which only the scan
   * list can map to ids: each scan there carries its latest run's link. A link to an older
   * run therefore matches no scan, and is reported as such rather than guessed at.
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
      "This link does not name a report the API can look up. Pass an Automated Tests or Website Scanner report link from the Accessibility dashboard (both carry thBuildId), or the ids: scanId with scanRunId, buildId, or workflowReportId",
    );
  }

  /** Walk the newest scans for the one whose own link carries this thBuildId. */
  private async findScanRun(
    thBuildId: string,
    scanName: string,
  ): Promise<IssueSource> {
    let nextPage: string | undefined;
    let sameName: number | undefined;
    for (let page = 0; page < MAX_SCAN_LIST_PAGES; page++) {
      const resp = await apiClient.get({
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
   * back as an ExportPendingError carrying its task id.
   */
  async getReportLink(
    source: IssueSource,
    options: {
      exportTaskId?: string;
      onWait?: (waitedMs: number) => Promise<void>;
    } = {},
  ): Promise<string> {
    const key = `${this.auth?.username ?? ""}|${JSON.stringify(source)}`;
    const known = reportExports.get(key);
    if (known?.link && (known.expiresAt ?? 0) > Date.now()) return known.link;

    const urls = exportUrls(source);
    let taskId = options.exportTaskId ?? known?.taskId;
    if (!taskId) {
      const initResp = await apiClient.get({
        url: urls.start,
        headers: this.authHeaders(),
        raise_error: false,
      });
      const initData: ReportInitResponse = initResp.data;
      if (!initResp.ok || !initData?.success) {
        throw new Error(startFailure(source, initResp.status, initData));
      }
      taskId = initData.data.task_id;
    }
    reportExports.set(key, { taskId });

    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const reportResp = await apiClient.get({
        url: urls.poll(taskId),
        headers: this.authHeaders(),
      });
      const reportData: ReportResponse & { data?: { message?: string } } =
        reportResp.data;
      if (!reportData.success) {
        reportExports.delete(key);
        throw new Error(`Failed to fetch report: ${reportData.error}`);
      }
      const link = reportData.data?.reportLink;
      if (link) {
        reportExports.set(key, { link, expiresAt: linkExpiry(link) });
        return link;
      }
      const message = reportData.data?.message ?? "";
      if (/generation failed/i.test(message)) {
        reportExports.delete(key);
        throw new Error(`The report's CSV export failed: ${message}`);
      }
      const waited = Date.now() - started;
      if (waited >= EXPORT_WAIT_MS)
        throw new ExportPendingError(taskId, waited);
      await options.onWait?.(waited);
      const pause =
        EXPORT_POLL_MS[Math.min(attempt, EXPORT_POLL_MS.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }

  /** The run before `scanRunId` in its scan's history, or undefined for the first run. */
  async previousScanRun(
    scanId: string,
    scanRunId: string,
  ): Promise<ScanRun | undefined> {
    // The runs come a page at a time; the one before may be on a later page.
    const runs: ScanRun[] = [];
    const base = `${API_BASE}/website-scanner/v1/scans/${encodeURIComponent(scanId)}/scan_runs`;
    let nextPage: string | undefined;
    for (let page = 0; page < MAX_SCAN_RUN_PAGES; page++) {
      const data = await this.getData(
        nextPage ? `${base}?nextPage=${encodeURIComponent(nextPage)}` : base,
      );
      runs.push(...(data?.scanRuns ?? []));
      if (!data?.pagination?.hasNext || !data.pagination.nextPage) break;
      nextPage = data.pagination.nextPage;
    }
    const newestFirst = [...runs].sort((a, b) =>
      b.scanDate.localeCompare(a.scanDate),
    );
    const at = newestFirst.findIndex((run) => String(run.id) === scanRunId);
    return at >= 0 ? newestFirst[at + 1] : undefined;
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
    const resp = await apiClient.get({
      url,
      headers: this.authHeaders(),
      raise_error: false,
    });
    return resp.ok ? resp.data?.data : undefined;
  }
}
