import { apiClient } from "../../lib/apiClient.js";
import {
  AppAccessibilityApi,
  manualReportIdFromDashboardLink,
  manualReportStatus,
  type AppBuildReport,
  type AppManualReport,
} from "./app-report-fetcher.js";

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
 */
export type IssueSource =
  | { kind: "scan"; scanId: string; scanRunId: string }
  | { kind: "build"; buildId: string }
  | { kind: "workflow"; reportId: string }
  | { kind: "appBuild"; buildId: string }
  | { kind: "appReport"; reportId: string };

const API_BASE = "https://api-accessibility.browserstack.com/api";

/**
 * How far a report link's scan is searched for. The scan list has no name or link filter and
 * spans the whole organisation, so the walk covers only the newest scans, which is where a
 * link someone just opened will be. It runs at the list's default page size (~1.2 s a page):
 * at limit=50 or 100 the cursor skips scans, so a larger page cannot be used to go faster.
 */
export const MAX_SCAN_LIST_PAGES = 15;

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
      ? ". Pass the Accessibility build id: the thBuildId in the build's accessibility report link (40 lowercase letters and digits), not the Automate build id or the build name"
      : "";
  return `Failed to initiate report: ${reason}${hint}`;
}

export class AccessibilityReportFetcher {
  private auth: { username: string; password: string } | undefined;
  private readonly app = new AppAccessibilityApi(() => this.authHeaders());
  /** Web builds whose overview was read, by id, so a status check need not read it again. */
  private readonly webBuildProjects = new Map<string, string>();

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
   * run therefore matches no scan, and is reported as such rather than guessed at. An App
   * Accessibility link names its build by project, name and number, which the project's
   * build list maps to the id. An App Automate build or session link maps to the
   * accessibility build through a session's test code.
   */
  async sourceFromReportUrl(reportUrl: string): Promise<IssueSource> {
    let url: URL | undefined;
    try {
      url = new URL(reportUrl);
    } catch {
      url = undefined;
    }
    const manualReportId = url && manualReportIdFromDashboardLink(url);
    if (manualReportId) return { kind: "appReport", reportId: manualReportId };
    const appBuildId =
      url &&
      ((await this.app.buildIdFromDashboardLink(url)) ??
        (await this.app.buildIdFromAppAutomateLink(url)));
    if (appBuildId) return { kind: "appBuild", buildId: appBuildId };
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
      "This link does not name a report the API can look up. Pass an Automated Tests or Website Scanner report link from the Accessibility dashboard (both carry thBuildId), an App Accessibility build link (automated-tests/projects/…/builds/…), an App Automate build or session link, an App Accessibility manual report link (report/…), or the ids: scanId with scanRunId, buildId, workflowReportId, or appReportId",
    );
  }

  /**
   * A build id names a web build or a mobile app build: both are TestHub ids, and only the
   * API that ran the build knows it. The web API is asked first; a build it does not know
   * that the App Accessibility API does is an app build. One neither knows is refused
   * here, naming both.
   */
  async resolveBuild(source: IssueSource): Promise<IssueSource> {
    if (source.kind !== "build") return source;
    // Only a 404 means the web API does not know the id: any other failure is not an
    // answer about the build, and asking the app API next would hide it.
    const resp = await apiClient.get({
      url: `${API_BASE}/automated-tests/v1/builds/${encodeURIComponent(source.buildId)}`,
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
      if (web.projectName) {
        this.webBuildProjects.set(source.buildId, web.projectName);
      }
      return source;
    }
    const meta = await this.app.buildMeta(source.buildId);
    if (meta) return { kind: "appBuild", buildId: source.buildId };
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

  /** A manual (Workflow Analyzer) app report's issues, read inline from its screens. */
  appReportIssues(
    reportId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppManualReport> {
    return this.app.appReportIssues(reportId, cursor, maxCharacterLength);
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
        `This link is to an earlier run of scan "${scanName}" (scanId ${sameName}). A link resolves only to a scan's latest run; ask the user for that run's scanRunId and pass it with scanId ${sameName}`,
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

  async getReportLink(source: IssueSource): Promise<string> {
    const urls = exportUrls(source);

    // Initiate CSV link generation
    const initResp = await apiClient.get({
      url: urls.start,
      headers: this.authHeaders(),
      raise_error: false,
    });
    const initData: ReportInitResponse = initResp.data;
    if (!initResp.ok || !initData?.success) {
      throw new Error(startFailure(source, initResp.status, initData));
    }
    const taskId = initData.data.task_id;

    // Poll for the generated CSV link (task is async, may take a few seconds)
    const reportUrl = urls.poll(taskId);
    const maxAttempts = 3;
    const pollIntervalMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const reportResp = await apiClient.get({
        url: reportUrl,
        headers: this.authHeaders(),
      });
      const reportData: ReportResponse = reportResp.data;
      if (!reportData.success) {
        throw new Error(`Failed to fetch report: ${reportData.error}`);
      }
      const link = reportData.data?.reportLink;
      if (link) {
        return link;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Report link was not available after ${maxAttempts} attempts. The CSV generation may still be in progress.`,
    );
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

  private async buildStatus(buildId: string): Promise<string | undefined> {
    const q = encodeURIComponent;
    const project =
      this.webBuildProjects.get(buildId) ??
      (
        await this.getData(
          `${API_BASE}/automated-tests/v1/builds/${q(buildId)}`,
        )
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
