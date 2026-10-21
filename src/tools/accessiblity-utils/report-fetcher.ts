import { apiClient } from "../../lib/apiClient.js";
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
    const automate = url && automateIds(url);
    if (automate?.sessionId) {
      return this.buildOfAutomateSession(automate.sessionId);
    }
    if (automate?.buildId) {
      return this.buildOfAutomateSession(
        await this.anyAutomateSession(automate.buildId),
      );
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

  /** Any one session of an Automate build; every session of an SDK run names the same build. */
  private async anyAutomateSession(automateBuildId: string): Promise<string> {
    const resp = await apiClient.get({
      url: `${sessionsListUrl(SessionType.Automate, automateBuildId)}?limit=1`,
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
      url: `${API_BASE}/automated-tests/v1/builds/${encodeURIComponent(buildId)}`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (build.status === 404) {
      throw new Error(
        `This Automate run belongs to build ${buildId}, which has no accessibility results: accessibility testing was not on for it`,
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
}
