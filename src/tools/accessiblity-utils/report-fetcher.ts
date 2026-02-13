import { apiClient } from "../../lib/apiClient.js";
import { getA11yBaseURL } from "../../lib/a11y-base-url.js";
import { BrowserStackConfig } from "../../lib/types.js";

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
  private config: BrowserStackConfig;

  constructor(config: BrowserStackConfig) {
    this.config = config;
  }

  public setAuth(auth: { username: string; password: string }): void {
    this.auth = auth;
  }

  async getReportLink(scanId: string, scanRunId: string): Promise<string> {
    // Initiate CSV link generation
    const baseUrl = await getA11yBaseURL(this.config);
    const initUrl = `${baseUrl}/api/website-scanner/v1/scans/${scanId}/scan_runs/issues?scan_run_id=${scanRunId}`;

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

    // Fetch the generated CSV link
    const reportUrl = `${baseUrl}/api/website-scanner/v1/scans/${scanId}/scan_runs/issues?task_id=${encodeURIComponent(
      taskId,
    )}`;
    // Use apiClient for the report link request as well
    const reportResp = await apiClient.get({
      url: reportUrl,
      headers: basicAuthHeader ? { Authorization: basicAuthHeader } : undefined,
    });
    const reportData: ReportResponse = reportResp.data;
    if (!reportData.success) {
      throw new Error(`Failed to fetch report: ${reportData.error}`);
    }
    return reportData.data.reportLink;
  }
}
