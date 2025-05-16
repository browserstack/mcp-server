import axios from "axios";
import config from "../../config.js";

export interface AccessibilityScanResponse {
  success: boolean;
  data?: { id: string; scanRunId: string };
  errors?: string[];
}

export interface AccessibilityScanStatus {
  success: boolean;
  data?: { status: string };
  errors?: string[];
}

export class AccessibilityScanner {
  private auth = {
    username: config.browserstackUsername,
    password: config.browserstackAccessKey,
  };

  async startScan(
    name: string,
    urlList: string[],
  ): Promise<AccessibilityScanResponse> {
    try {
      const { data } = await axios.post<AccessibilityScanResponse>(
        "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans",
        { name, urlList, recurring: false },
        { auth: this.auth },
      );
      if (!data.success)
        throw new Error(`Unable to start scan: ${data.errors?.join(", ")}`);
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const msg =
          (err.response.data as any).error ||
          (err.response.data as any).message ||
          err.message;
        throw new Error(`Failed to start scan: ${msg}`);
      }
      throw err;
    }
  }

  async pollStatus(
    scanId: string,
    scanRunId: string,
  ): Promise<AccessibilityScanStatus> {
    try {
      const { data } = await axios.get<AccessibilityScanStatus>(
        `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${scanId}/scan_runs/${scanRunId}/status`,
        { auth: this.auth },
      );
      if (!data.success)
        throw new Error(`Failed to get status: ${data.errors?.join(", ")}`);
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const msg = (err.response.data as any).message || err.message;
        throw new Error(`Failed to get scan status: ${msg}`);
      }
      throw err;
    }
  }

  async waitUntilComplete(
    scanId: string,
    scanRunId: string,
    context: any,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const statusResp = await this.pollStatus(scanId, scanRunId);
          const status = statusResp.data!.status;
          const progress = status === "completed" ? 100 : 0;
          const message =
            status === "completed" || status === "failed"
              ? `Scan completed with status : ${status}`
              : `Scan in progress ...`;
          await context.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken: context._meta?.progressToken ?? "NOT_FOUND",
              message: message,
              progress: progress,
              total: 100,
            },
          });
          if (status === "completed" || status === "failed") {
            clearInterval(interval);
            resolve(status);
          }
        } catch (e) {
          clearInterval(interval);
          reject(e);
        }
      }, 5000);

      setTimeout(
        () => {
          clearInterval(interval);
          reject(new Error("Scan timed out after 5 minutes"));
        },
        5 * 60 * 1000,
      );
    });
  }
}
