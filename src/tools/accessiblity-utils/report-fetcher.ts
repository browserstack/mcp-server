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

  async getReportLink(source: IssueSource): Promise<string> {
    const urls = exportUrls(source);

    let basicAuthHeader = undefined;
    if (this.auth) {
      const { username, password } = this.auth;
      basicAuthHeader =
        "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
    }
    // Initiate CSV link generation
    const initResp = await apiClient.get({
      url: urls.start,
      headers: basicAuthHeader ? { Authorization: basicAuthHeader } : undefined,
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
        headers: basicAuthHeader
          ? { Authorization: basicAuthHeader }
          : undefined,
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
