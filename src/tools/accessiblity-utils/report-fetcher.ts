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

export class AccessibilityReportFetcher {
  private auth: { username: string; password: string } | undefined;

  public setAuth(auth: { username: string; password: string }): void {
    this.auth = auth;
  }

  async getReportLink(scanId: string, scanRunId: string): Promise<string> {
    // Initiate CSV link generation
    const initUrl = `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${scanId}/scan_runs/issues?scan_run_id=${scanRunId}`;

    let basicAuthHeader = undefined;
    if (this.auth) {
      const { username, password } = this.auth;
      basicAuthHeader =
        "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
    }
    const initResp = await apiClient.get({
      url: initUrl,
      headers: basicAuthHeader ? { Authorization: basicAuthHeader } : undefined,
    });
    const initData: ReportInitResponse = initResp.data;
    if (!initData.success) {
      throw new Error(
        `Failed to initiate report: ${initData.error || initData.data.message}`,
      );
    }
    const taskId = initData.data.task_id;

    // Poll for the generated CSV link (task is async, may take a few seconds)
    const reportUrl = `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${scanId}/scan_runs/issues?task_id=${encodeURIComponent(
      taskId,
    )}`;
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
