import { apiClient } from "../../lib/apiClient.js";
import {
  AppAccessibilityApi,
  manualReportIdFromDashboardLink,
  manualReportStatus,
  type AppBuildIssues,
  type AppBuildRef,
  type AppBuildReport,
  type AppManualReport,
  type EarlierManualReport,
} from "./app-report-fetcher.js";
import { onErrorPage, samePage, type RunIssue } from "./report-parser.js";
import { sortBySeverity } from "./paginate.js";
import { SessionType } from "../../lib/constants.js";
import { sessionsListUrl } from "../automate-utils/list-session-ids.js";
import { getAutomationBaseUrl } from "../rca-agent-utils/constants.js";
import { getRegionalHost } from "../../lib/regional-host.js";

export { MAX_APP_BUILD_LIST_PAGES } from "./app-report-fetcher.js";

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

/**
 * What to read issues from: a Website Scanner run, an Automated Tests build, a Workflow
 * Analyzer report, or an App Accessibility build (a mobile app run through App Automate).
 * A Website Scanner run is named by its ids, or (`scanBuild`) by the build id its dashboard
 * link carries, which the API reads without the ids.
 */
export type IssueSource =
  | { kind: "scan"; scanId: string; scanRunId: string }
  | ScanBuildSource
  | { kind: "build"; buildId: string }
  | { kind: "workflow"; reportId: string }
  | { kind: "appBuild"; buildId: string }
  | { kind: "appReport"; reportId: string };

/** A Website Scanner run named by its build id (a dashboard link's thBuildId), and the scan's name when a link gave it. */
export type ScanBuildSource = {
  kind: "scanBuild";
  thBuildId: string;
  scanName?: string;
};

const apiBase = () => `${getRegionalHost("accessibilityApi")}/api`;
const dashboard = () => getRegionalHost("accessibilityDashboard");

/**
 * The API does not know a Website Scanner run by this build id, or not for this account:
 * a 404, which the API gives alike for an unknown id and one the caller may not see. An
 * API that does not have the route yet answers a 404 page instead (`routeMissing`).
 */
export class ScanRunNotFoundError extends Error {
  constructor(
    readonly thBuildId: string,
    readonly routeMissing = false,
  ) {
    super(
      routeMissing
        ? "This API does not read a Website Scanner run by its build id yet"
        : `No Website Scanner run with build id ${thBuildId} that this account can read`,
    );
    this.name = "ScanRunNotFoundError";
  }
}

/**
 * No scan the scan list was searched across has a run with this build id; `capped` when
 * the search stopped at the page limit rather than at the end of the list.
 */
export class ScanNotInListError extends Error {
  constructor(
    readonly capped: boolean,
    readonly pages: number,
  ) {
    super(
      `No Website Scanner scan${capped ? ` among the most recent scans (${pages} pages)` : ""} matches this link. Pass scanId and scanRunId instead`,
    );
    this.name = "ScanNotInListError";
  }
}

/** The dashboard link of a run named by its build id, without the extra query a copied link carries. */
export function scanRunLink(source: ScanBuildSource): string {
  return `${dashboard()}/site-scanner/projects/${encodeURIComponent(source.scanName ?? "")}/builds?thBuildId=${encodeURIComponent(source.thBuildId)}`;
}

/**
 * How far a report link's scan is searched for. The scan list has no name or link filter and
 * spans the whole organisation, so the walk covers only the newest scans, which is where a
 * link someone just opened will be. It runs at the list's default page size (~1.2 s a page):
 * at limit=50 or 100 the cursor skips scans, so a larger page cannot be used to go faster.
 */
export const MAX_SCAN_LIST_PAGES = 25;
/** How many pages of a scan's runs are read to find the run before a given one. */
const MAX_SCAN_RUN_PAGES = 10;

/** A build whose status is checked is one just run, so it sits at the top of its project's list. */
const MAX_BUILD_LIST_PAGES = 3;

/**
 * The Workflow Analyzer report list holds the whole account's reports, newest first, with no
 * page or date: a report is found in its newest pages, at the list's largest page size, and
 * the pages of the earlier ones after it are read from their summaries, a batch at a time.
 */
const MAX_WORKFLOW_LIST_PAGES = 3;
const WORKFLOW_LIST_PAGE_SIZE = 99;
const MAX_WORKFLOW_CANDIDATES = 30;
const WORKFLOW_SUMMARY_BATCH = 10;

/** An earlier Workflow Analyzer report: of the same page, or else of the same site. */
export interface EarlierWorkflowReport {
  reportId: string;
  /** When it started, as the API writes it. */
  time?: string;
  samePage: boolean;
  link: string;
}

/** A page's site: its host, without a leading "www.". */
function siteOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

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
 * Exports per report: the finished link to reuse for later pages, or the task of an export
 * still running, to continue instead of starting another. Keyed by the account and the
 * report, so one account never sees another's, and bounded, oldest dropped first.
 */
export const reportExports = new Map<
  string,
  { link?: string; expiresAt?: number; taskId?: string }
>();
export const MAX_REPORT_EXPORTS = 200;

function rememberExport(
  key: string,
  entry: { link?: string; expiresAt?: number; taskId?: string },
): void {
  reportExports.delete(key);
  reportExports.set(key, entry);
  for (const oldest of reportExports.keys()) {
    if (reportExports.size <= MAX_REPORT_EXPORTS) break;
    reportExports.delete(oldest);
  }
}

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

/** An Automated Tests (web) build, as its overview names it. */
export interface WebBuild {
  buildId: string;
  name: string;
  projectName?: string;
  buildNumber?: number;
  /** When the build started, as the API writes it (ISO 8601). */
  startedAt?: string;
}

/** The compare API's three lists, in its own words (`retained` is still open). */
export type CompareStatus = "new" | "resolved" | "retained";
const COMPARE_STATUSES: CompareStatus[] = ["new", "retained", "resolved"];

/** Two Automated Tests builds as the compare API compares them. */
export interface WebBuildComparison {
  /** The older build; `autoResolved` when the API chose it (no baseReport was passed). */
  base: WebBuild & { autoResolved: boolean };
  after: WebBuild;
  counts: Record<CompareStatus, number>;
  /** The first issues of each list, up to the list limit, most severe first. */
  issues: Record<CompareStatus, RunIssue[]>;
}

/** Why the compare API gave no comparison, in its words. */
export interface WebCompareRefusal {
  refused: string;
  /** The build has no earlier completed run with its name in its project. */
  noPrevious?: true;
}

/**
 * How long a call to the compare API is waited on. The API stops itself at 30 s and answers
 * 504 "Request timed out"; this covers a gateway that never answers.
 */
export const WEB_COMPARE_TIMEOUT_MS = 40_000;
/** The most issues the compare API hands out in one call. */
const WEB_COMPARE_PAGE = 100;

/**
 * A compare API row as a comparison lists it. Its key is the API's own (signatureKey), which
 * tells apart more than rule, element and page: a changed element's markup, for one.
 */
function comparedIssue(row: any): RunIssue {
  const selector = [row?.target ?? []].flat().filter(Boolean).join(" ");
  const issue_type = row?.ruleData?.id ?? "";
  const affected_page = row?.url ?? "";
  return {
    key:
      row?.signatureKey ||
      [issue_type, selector || row?.componentId || "", affected_page].join("|"),
    issue_type,
    severity: (row?.impact || "unknown").trim(),
    component: row?.componentId ?? "",
    ...(selector ? { selector } : {}),
    affected_page,
    ...(onErrorPage(row?.html) ? { on_error_page: true as const } : {}),
  };
}

/** A build as the compare API's summary names it. */
function comparedBuild(report: any): WebBuild {
  return {
    buildId: report?.id,
    name: report?.buildName,
    projectName: report?.projectName,
    buildNumber: report?.buildNumber,
    startedAt: report?.createdOn,
  };
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
      const route = `${apiBase()}/website-scanner/v1/scans/${q(source.scanId)}/scan_runs/issues`;
      return {
        start: `${route}?scan_run_id=${q(source.scanRunId)}`,
        poll: (taskId) => `${route}?task_id=${q(taskId)}`,
      };
    }
    case "scanBuild": {
      // The run's issues by its build id; the poll finds the run again from the task id.
      const route = `${apiBase()}/website-scanner/v1/scan_runs/issues`;
      return {
        start: `${route}?thBuildId=${q(source.thBuildId)}`,
        poll: (taskId) => `${route}?task_id=${q(taskId)}`,
      };
    }
    case "build": {
      const route = `${apiBase()}/automated-tests/v1/builds/issues`;
      return {
        start: `${route}?buildUuid=${q(source.buildId)}`,
        poll: (taskId) => `${route}?taskId=${q(taskId)}`,
      };
    }
    case "workflow": {
      const route = `${apiBase()}/workflow-analyzer/v1/reports/issues`;
      return {
        start: `${route}?reportId=${q(source.reportId)}`,
        poll: (taskId) => `${route}?taskId=${q(taskId)}`,
      };
    }
    case "appBuild":
    case "appReport":
      throw new Error(
        "An App Accessibility build or report has no CSV export; its issues are read inline",
      );
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
  private readonly app = new AppAccessibilityApi(() => this.authHeaders());
  /** Web builds whose overview was read, by id, so a status check need not read it again. */
  private readonly webBuilds = new Map<string, WebBuild>();

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
   * id itself, and a Workflow Analyzer report link its report id (`ids`). An Automate build
   * or session link is mapped to that build through a session (see buildOfAutomateSession).
   * A Website Scanner link carries the build id (thBuildId) of one run, which the API reads
   * directly (`scanBuild`); only what needs the scan's ids searches the scan list for it
   * (findScanRun). An App Accessibility link names its build by project, name and number,
   * which the project's build list maps to the id. An App Automate build or session link
   * maps to the accessibility build through a session's test code.
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
    const reportPage = url?.pathname.match(
      /\/(workflow-analyzer|reports|assisted-test)\/report\/?$/,
    )?.[1];
    if (url && reportPage === "assisted-test") {
      throw new Error(
        "This is an Assisted Test report link: fetchAccessibilityIssues does not read Assisted Test reports. It reads Website Scanner runs, Automated Tests and App Accessibility builds, and Workflow Analyzer reports",
      );
    }
    const reportIds = reportPage ? url?.searchParams.get("ids") : null;
    if (reportIds) {
      const ids = reportIds.split(",").map((id) => id.trim());
      if (ids.length > 1) {
        throw new Error(
          `This link opens several Workflow Analyzer reports (${ids.length}). Pass the one to read as workflowReportId`,
        );
      }
      return { kind: "workflow", reportId: ids[0] };
    }
    const manualReportId = url && manualReportIdFromDashboardLink(url);
    if (manualReportId) return { kind: "appReport", reportId: manualReportId };
    const appBuildId =
      url &&
      ((await this.app.buildIdFromDashboardLink(url)) ??
        (await this.app.buildIdFromAppAutomateLink(url)));
    if (appBuildId) return { kind: "appBuild", buildId: appBuildId };
    const automate = url && automateIds(url);
    if (automate?.sessionId) {
      return this.buildOfAutomateSession(automate.sessionId);
    }
    if (automate?.buildId) {
      const session = await this.automateSession(automate.buildId);
      if (!session) {
        throw new Error(`No Automate build with id ${automate.buildId}`);
      }
      return this.buildOfAutomateSession(session);
    }
    const thBuildId = url?.searchParams.get("thBuildId");
    if (url && thBuildId && url.pathname.includes("/automated-tests/")) {
      return { kind: "build", buildId: thBuildId };
    }
    const scanName = url?.pathname.match(
      /\/site-scanner\/projects\/([^/]+)\/builds/,
    )?.[1];
    if (thBuildId && scanName) {
      return {
        kind: "scanBuild",
        thBuildId,
        scanName: decodeURIComponent(scanName),
      };
    }
    throw new Error(
      "This link does not name a report the API can look up. Pass an Automated Tests or Website Scanner report link from the Accessibility dashboard (both carry thBuildId), a Workflow Analyzer report link (workflow-analyzer/report?ids=…), an App Accessibility build link (automated-tests/projects/…/builds/…), an Automate or App Automate build or session link, a scanner share link, an App Accessibility manual report link (report/…), or the ids: scanId with scanRunId, buildId, workflowReportId, or appReportId",
    );
  }

  /**
   * A build id names a web build or a mobile app build: both are TestHub ids, and only the
   * API that ran the build knows it. The web API is asked first; a build it does not know
   * that the App Accessibility API does is an app build. One neither knows is refused
   * here, naming both, or with `orScanRun` taken as a Website Scanner run's build id.
   */
  async resolveBuild(
    source: IssueSource,
    { orScanRun = false }: { orScanRun?: boolean } = {},
  ): Promise<IssueSource> {
    if (source.kind !== "build") return source;
    // Only a 404 means the web API does not know the id: any other failure is not an
    // answer about the build, and asking the app API next would hide it.
    const resp = await apiClient.get({
      url: `${apiBase()}/automated-tests/v1/builds/${encodeURIComponent(source.buildId)}`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(
        `Could not look up build "${source.buildId}" in Automated Tests: HTTP ${resp.status}`,
      );
    }
    const web = resp.ok ? resp.data?.data : undefined;
    if (web) {
      this.rememberWebBuild(source.buildId, web);
      return source;
    }
    const meta = await this.app.buildMeta(source.buildId);
    if (meta) return { kind: "appBuild", buildId: source.buildId };
    // An Automate or App Automate build's own id, its hashed_id (40 hex characters; a TestHub
    // id has other letters too), as the SDK prints it at the end of a run: its sessions name
    // the accessibility build they ran in, as for the build's link. Asked before the scan list.
    if (/^[0-9a-f]{40}$/.test(source.buildId)) {
      const session = await this.automateSession(source.buildId);
      if (session) return this.buildOfAutomateSession(session);
      const appBuildId = await this.app.buildIdOfAppAutomateBuild(
        source.buildId,
      );
      if (appBuildId) return { kind: "appBuild", buildId: appBuildId };
    }
    // A Website Scanner run's build id (a scanner link's thBuildId) is a TestHub id too, which
    // only the scanner's issues route knows: the caller reads it there, and says so if not.
    if (orScanRun) return { kind: "scanBuild", thBuildId: source.buildId };
    throw new Error(
      `No Automated Tests (web) or App Accessibility build with id "${source.buildId}". Pass the id the BrowserStack SDK printed as "testhub id" at the end of the run (40 lowercase letters and digits), or the report's dashboard link as reportUrl`,
    );
  }

  /** An app build's issues, read inline from its scanned screens. */
  appBuildReport(
    buildId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppBuildReport> {
    return this.app.report(buildId, cursor, maxCharacterLength);
  }

  /** Every issue of an app build at once, to compare it with another. */
  appBuildIssues(buildId: string): Promise<AppBuildIssues> {
    return this.app.buildIssues(buildId);
  }

  /** The build before an app build in its project, if it has one. */
  previousAppBuild(buildId: string): Promise<AppBuildRef | undefined> {
    return this.app.previousBuild(buildId);
  }

  /** A manual (Workflow Analyzer) app report's issues, read inline from its screens. */
  appReportIssues(
    reportId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppManualReport> {
    return this.app.appReportIssues(reportId, cursor, maxCharacterLength);
  }

  /** The newest manual report of the same app recorded before this one, if any. */
  previousManualReport(
    reportId: string,
  ): Promise<EarlierManualReport | undefined> {
    return this.app.previousManualReport(reportId);
  }

  /**
   * Any one session of an Automate build; every session of an SDK run names the same build.
   * Undefined when Automate does not know the build (its 404).
   */
  private async automateSession(
    automateBuildId: string,
  ): Promise<string | undefined> {
    const resp = await apiClient.get({
      url: `${sessionsListUrl(SessionType.Automate, automateBuildId)}?limit=1`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (resp.status === 404) return undefined;
    if (!resp.ok) {
      throw new Error(
        `Could not list the sessions of Automate build ${automateBuildId}: HTTP ${resp.status}`,
      );
    }
    const sessionId = resp.data?.[0]?.automation_session?.hashed_id;
    if (!sessionId) {
      throw new Error(`Automate build ${automateBuildId} has no sessions`);
    }
    return sessionId;
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
    const resp = await apiClient.get({
      url: `${getAutomationBaseUrl()}/ext/v1/sessions/${encodeURIComponent(sessionId)}/testCode`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(
        `Could not read Automate session ${sessionId}: HTTP ${resp.status}`,
      );
    }
    const buildId: string | undefined = resp.ok
      ? resp.data?.build_uuid
      : undefined;
    if (!buildId) {
      throw new Error(
        `Automate session ${sessionId} is not linked to a BrowserStack SDK build (it was not run through the SDK, or belongs to another account), so it has no accessibility results`,
      );
    }
    const build = await apiClient.get({
      url: `${apiBase()}/automated-tests/v1/builds/${encodeURIComponent(buildId)}`,
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

  /**
   * A run named by its build id, as its scan's ids: the newest scans are walked for the one
   * whose own link carries this thBuildId. What needs the ids (comparing runs) uses this, as
   * does a link the API does not know by its build id.
   */
  async findScanRun({ thBuildId, scanName }: ScanBuildSource): Promise<{
    kind: "scan";
    scanId: string;
    scanRunId: string;
  }> {
    let nextPage: string | undefined;
    let sameName: number | undefined;
    for (let page = 0; page < MAX_SCAN_LIST_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${apiBase()}/website-scanner/v1/scans${
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
        if (sameName === undefined && scanName && scan.name === scanName) {
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
    throw new ScanNotInListError(nextPage !== undefined, MAX_SCAN_LIST_PAGES);
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
      /**
       * The report is still adding issues: its export is a snapshot, so it is neither
       * reused nor kept, or a call after it finishes would read the stale one.
       */
      stillProcessing?: boolean;
    } = {},
  ): Promise<string> {
    const key = `${this.auth?.username ?? ""}|${JSON.stringify(source)}`;
    const known = options.stillProcessing ? undefined : reportExports.get(key);
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
      if (source.kind === "scanBuild" && initResp.status === 404) {
        reportExports.delete(key);
        // The API's own 404 is JSON; a 404 page means the route is not there.
        const routeMissing = typeof initData !== "object" || initData === null;
        throw new ScanRunNotFoundError(source.thBuildId, routeMissing);
      }
      if (!initResp.ok || !initData?.success) {
        throw new Error(startFailure(source, initResp.status, initData));
      }
      taskId = initData.data.task_id;
    }
    rememberExport(key, { taskId });

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
        if (options.stillProcessing) reportExports.delete(key);
        else rememberExport(key, { link, expiresAt: linkExpiry(link) });
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

  /**
   * A scan's runs, newest first, and whether the whole list was read: a list cut short at
   * the page limit, or by a page that could not be read, may not hold a run that is the scan's.
   */
  async scanRuns(
    scanId: string,
  ): Promise<{ runs: ScanRun[]; complete: boolean }> {
    // The runs come a page at a time.
    const runs: ScanRun[] = [];
    const base = `${apiBase()}/website-scanner/v1/scans/${encodeURIComponent(scanId)}/scan_runs`;
    let nextPage: string | undefined;
    let complete = false;
    for (let page = 0; page < MAX_SCAN_RUN_PAGES; page++) {
      const data = await this.getData(
        nextPage ? `${base}?nextPage=${encodeURIComponent(nextPage)}` : base,
      );
      runs.push(...(data?.scanRuns ?? []));
      if (!data?.pagination?.hasNext || !data.pagination.nextPage) {
        complete = data !== undefined;
        break;
      }
      nextPage = data.pagination.nextPage;
    }
    return {
      runs: runs.sort((a, b) => b.scanDate.localeCompare(a.scanDate)),
      complete,
    };
  }

  /** The run before `scanRunId` in its scan's history, or undefined for the first run. */
  async previousScanRun(
    scanId: string,
    scanRunId: string,
  ): Promise<ScanRun | undefined> {
    const { runs } = await this.scanRuns(scanId);
    const at = runs.findIndex((run) => String(run.id) === scanRunId);
    return at >= 0 ? runs[at + 1] : undefined;
  }

  /** The dashboard's new / retained / resolved counts against the run before this one. */
  async changesSinceLastRun(
    scanId: string,
    scanRunId: string,
  ): Promise<RunChanges | undefined> {
    const q = encodeURIComponent;
    const changes = (
      await this.getData(
        `${apiBase()}/website-scanner/v1/scans/${q(scanId)}/scan_runs/${q(scanRunId)}`,
      )
    )?.changesSinceLastRun;
    return changes ?? undefined;
  }

  /**
   * Where the report is in its processing, as the report's own status reads it: `completed`,
   * or `queued` / `running` / `processing` / `finalizing` while issues are still being added
   * (an app build reads `running` / `rule_processing` until its rules have run). Undefined
   * when it cannot be read. A web build's overview carries no status, so a build's comes
   * from its project's build list (newest first), found by id.
   */
  async reportStatus(source: IssueSource): Promise<string | undefined> {
    const q = encodeURIComponent;
    try {
      switch (source.kind) {
        case "scan":
          return (
            await this.getData(
              `${apiBase()}/website-scanner/v1/scans/${q(source.scanId)}/scan_runs/${q(source.scanRunId)}/status`,
            )
          )?.status;
        case "scanBuild":
          // A run's status is read by its scan's ids, which a build id does not give.
          return undefined;
        case "workflow":
          return (
            await this.getData(
              `${apiBase()}/workflow-analyzer/v1/reports/${q(source.reportId)}`,
            )
          )?.summary?.status;
        case "build":
          return await this.buildStatus(source.buildId);
        case "appBuild":
          return (await this.app.buildMeta(source.buildId))?.status;
        case "appReport": {
          const detail = await this.app.manualReport(source.reportId);
          return detail ? manualReportStatus(detail) : undefined;
        }
      }
    } catch {
      return undefined;
    }
  }

  /** A Workflow Analyzer report's start and the pages it scanned, from its summary. */
  private async workflowReportPages(
    reportId: string,
  ): Promise<{ time?: string; pages: string[] } | undefined> {
    const summary = (
      await this.getData(
        `${apiBase()}/workflow-analyzer/v1/reports/${encodeURIComponent(reportId)}`,
      )
    )?.summary;
    if (!summary) return undefined;
    const rows: { url?: unknown }[] = summary.issueCount?.issueCountByUrl ?? [];
    return {
      time: summary.time,
      pages: rows
        .map((row) => row?.url)
        .filter((url): url is string => typeof url === "string"),
    };
  }

  /**
   * The newest Workflow Analyzer report before this one that scanned one of its pages, or
   * else one on its site; undefined when none is among the account's newest reports.
   */
  async previousWorkflowReport(
    reportId: string,
  ): Promise<EarlierWorkflowReport | undefined> {
    const own = await this.workflowReportPages(reportId);
    if (!own?.pages.length) return undefined;
    // Newest first: the completed reports listed after this one are earlier.
    const earlier: string[] = [];
    let reached = false;
    let nextPage: string | undefined;
    for (
      let page = 0;
      page < MAX_WORKFLOW_LIST_PAGES &&
      earlier.length < MAX_WORKFLOW_CANDIDATES;
      page++
    ) {
      const data = await this.getData(
        `${apiBase()}/workflow-analyzer/v1/reports?limit=${WORKFLOW_LIST_PAGE_SIZE}${
          nextPage ? `&next_page=${encodeURIComponent(nextPage)}` : ""
        }`,
      );
      for (const row of data?.reports ?? []) {
        if (String(row.id) === reportId) reached = true;
        else if (reached && row.status === "completed") {
          earlier.push(String(row.id));
        }
      }
      if (!data?.pagination?.hasNext || !data.pagination.nextPage) break;
      nextPage = data.pagination.nextPage;
    }
    const pages = new Set(own.pages.map(samePage));
    const sites = new Set(own.pages.map(siteOf));
    const started = (time?: string) => Date.parse(time ?? "");
    let sameSite: EarlierWorkflowReport | undefined;
    const candidates = earlier.slice(0, MAX_WORKFLOW_CANDIDATES);
    for (let i = 0; i < candidates.length; i += WORKFLOW_SUMMARY_BATCH) {
      const batch = candidates.slice(i, i + WORKFLOW_SUMMARY_BATCH);
      const summaries = await Promise.all(
        batch.map((id) => this.workflowReportPages(id)),
      );
      for (const [j, summary] of summaries.entries()) {
        if (!summary || started(summary.time) >= started(own.time)) continue;
        const report = {
          reportId: batch[j],
          time: summary.time,
          link: `${dashboard()}/workflow-analyzer/report?ids=${encodeURIComponent(batch[j])}`,
        };
        if (summary.pages.some((url) => pages.has(samePage(url)))) {
          return { ...report, samePage: true };
        }
        if (!sameSite && summary.pages.some((url) => sites.has(siteOf(url)))) {
          sameSite = { ...report, samePage: false };
        }
      }
    }
    return sameSite;
  }

  /**
   * When the run or build behind a report started, as its API writes it (ISO 8601), or
   * undefined when it cannot be read.
   */
  async reportStartedAt(source: IssueSource): Promise<string | undefined> {
    try {
      switch (source.kind) {
        case "build":
          return (await this.webBuild(source.buildId))?.startedAt;
        case "scan":
          return (await this.scanRuns(source.scanId)).runs.find(
            (run) => String(run.id) === source.scanRunId,
          )?.scanDate;
        case "workflow":
          return (
            await this.getData(
              `${apiBase()}/workflow-analyzer/v1/reports/${encodeURIComponent(source.reportId)}`,
            )
          )?.summary?.time;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  private async buildStatus(buildId: string): Promise<string | undefined> {
    const q = encodeURIComponent;
    const project = (await this.webBuild(buildId))?.projectName;
    if (!project) return undefined;
    let nextPage: string | undefined;
    for (let page = 0; page < MAX_BUILD_LIST_PAGES; page++) {
      const data = await this.getData(
        `${apiBase()}/automated-tests/v1/builds?project_name=${q(project)}&limit=100${
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

  private rememberWebBuild(buildId: string, overview: any): WebBuild {
    const build: WebBuild = {
      buildId,
      name: overview.name,
      projectName: overview.projectName,
      buildNumber: overview.buildNumber,
      startedAt: overview.time,
    };
    this.webBuilds.set(buildId, build);
    return build;
  }

  /** An Automated Tests build's name, project, number and start, from its overview. */
  async webBuild(buildId: string): Promise<WebBuild | undefined> {
    const known = this.webBuilds.get(buildId);
    if (known) return known;
    const overview = await this.getData(
      `${apiBase()}/automated-tests/v1/builds/${encodeURIComponent(buildId)}`,
    );
    return overview ? this.rememberWebBuild(buildId, overview) : undefined;
  }

  /**
   * The run before a build that the compare API would pick: the newest earlier build with
   * the same name in its project whose accessibility run completed (`failed` in the build
   * list is one that completed with no test cases). Found in the project's newest builds.
   */
  async previousWebBuild(
    build: WebBuild,
  ): Promise<(WebBuild & { status: string }) | undefined> {
    if (!build.projectName) return undefined;
    const q = encodeURIComponent;
    let passed = false;
    let nextPage: string | undefined;
    for (let page = 0; page < MAX_BUILD_LIST_PAGES; page++) {
      const data = await this.getData(
        `${apiBase()}/automated-tests/v1/builds?project_name=${q(build.projectName)}&limit=100${
          nextPage ? `&next_page=${q(nextPage)}` : ""
        }`,
      );
      for (const row of data?.builds ?? []) {
        if (row.id === build.buildId) passed = true;
        else if (
          passed &&
          row.name === build.name &&
          (row.status === "completed" || row.status === "failed")
        ) {
          return {
            buildId: row.id,
            name: row.name,
            projectName: build.projectName,
            buildNumber: row.buildNumber,
            startedAt: row.time,
            status: row.status,
          };
        }
      }
      if (!data?.pagination?.has_next || !data.pagination.next_page) break;
      nextPage = data.pagination.next_page;
    }
    return undefined;
  }

  /**
   * Two builds of one build name and project, compared by the Automated Tests compare API
   * as the dashboard compares them: `newReport` against `baseReport`, or against the run
   * before it when no base is given. The API takes them in that order and does not check it.
   * The counts are the API's; each list holds up to `listLimit` issues, read from the first
   * page and, for a list that page does not cover, a page of that list alone. The API refuses
   * builds of different names or projects, builds over its issue-count threshold and calls
   * that outlast its 30 s budget; any refusal is handed back in its words.
   */
  async compareWebBuilds(
    newReport: string,
    baseReport: string | undefined,
    listLimit: number,
  ): Promise<WebBuildComparison | WebCompareRefusal> {
    const call = async (
      params: Record<string, string>,
    ): Promise<any | WebCompareRefusal> => {
      const url = `${apiBase()}/automated-tests/v1/builds/compare/issues?${new URLSearchParams(params)}`;
      let resp;
      try {
        resp = await apiClient.get({
          url,
          headers: this.authHeaders(),
          raise_error: false,
          timeout: WEB_COMPARE_TIMEOUT_MS,
        });
      } catch (error) {
        const timedOut = /timeout|ECONNABORTED/i.test(
          error instanceof Error
            ? `${error.message} ${(error as any).code}`
            : "",
        );
        return {
          refused: timedOut
            ? `no answer within ${WEB_COMPARE_TIMEOUT_MS / 1000} s`
            : error instanceof Error
              ? error.message
              : "the request failed",
        };
      }
      const body = resp.data;
      if (resp.ok && body?.data?.summary) return body.data;
      const reason =
        (typeof body?.message === "string" && body.message) ||
        [body?.error].flat().filter(Boolean).join("; ") ||
        `HTTP ${resp.status}`;
      return {
        refused: reason,
        ...(resp.status === 404 && /no previous completed run/i.test(reason)
          ? { noPrevious: true as const }
          : {}),
      };
    };

    const first = await call({
      newReport,
      ...(baseReport ? { baseReport } : {}),
      limit: String(WEB_COMPARE_PAGE),
    });
    if ("refused" in first) return first;
    const summary = first.summary;
    const counts: Record<CompareStatus, number> = {
      new: Number(summary.newIssues) || 0,
      retained: Number(summary.retainedIssues) || 0,
      resolved: Number(summary.resolvedIssues) || 0,
    };
    const base = comparedBuild(summary.baseReport);
    const rowsOf = (data: any, status: CompareStatus) =>
      (data?.issues ?? [])
        .filter((row: any) => row?.status === status)
        .map(comparedIssue);
    const issues = {} as Record<CompareStatus, RunIssue[]>;
    for (const status of COMPARE_STATUSES) {
      issues[status] = rowsOf(first, status);
    }
    // The first page runs new, then still open, then resolved: a list it cuts short is read
    // on its own, against the base the first call settled on.
    const short = COMPARE_STATUSES.filter(
      (status) => issues[status].length < Math.min(counts[status], listLimit),
    );
    const pages = await Promise.all(
      short.map((status) =>
        call({
          newReport,
          baseReport: base.buildId ?? baseReport ?? "",
          status,
          limit: String(Math.max(10, Math.min(listLimit, WEB_COMPARE_PAGE))),
        }),
      ),
    );
    for (const [i, status] of short.entries()) {
      const page = pages[i];
      if ("refused" in page) return page;
      issues[status] = rowsOf(page, status);
    }
    for (const status of COMPARE_STATUSES) {
      issues[status] = sortBySeverity(issues[status].slice(0, listLimit));
    }
    return {
      base: {
        ...base,
        autoResolved: Boolean(summary.baseReport?.autoResolved),
      },
      after: comparedBuild(summary.newReport),
      counts,
      issues,
    };
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
