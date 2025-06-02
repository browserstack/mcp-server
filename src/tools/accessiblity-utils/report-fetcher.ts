import axios from "axios";
import config from "../../config.js";

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
  private auth = {
    username: config.browserstackUsername,
    password: config.browserstackAccessKey,
  };

  async getReportLink(scanId: string, scanRunId: string): Promise<string> {
    // Initiate CSV link generation
    const initUrl = `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${scanId}/scan_runs/issues?scan_run_id=${scanRunId}`;
    const initResp = await axios.get<ReportInitResponse>(initUrl, {
      auth: this.auth,
    });
    if (!initResp.data.success) {
      throw new Error(
        `Failed to initiate report: ${initResp.data.error || initResp.data.data.message}`,
      );
    }
    const taskId = initResp.data.data.task_id;

    // Fetch the generated CSV link
    const reportUrl = `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${scanId}/scan_runs/issues?task_id=${encodeURIComponent(
      taskId,
    )}`;
    const reportResp = await axios.get<ReportResponse>(reportUrl, {
      auth: this.auth,
    });
    if (!reportResp.data.success) {
      throw new Error(`Failed to fetch report: ${reportResp.data.error}`);
    }
    return reportResp.data.data.reportLink;
  }
}
