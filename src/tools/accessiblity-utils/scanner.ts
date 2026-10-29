import { apiClient } from "../../lib/apiClient.js";
import { randomUUID } from "node:crypto";
import logger from "../../logger.js";
import {
  isLocalURL,
  ensureLocalBinarySetup,
  killExistingBrowserStackLocalProcesses,
} from "../../lib/local.js";
import config from "../../config.js";
import { getRegionalHost } from "../../lib/regional-host.js";

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

/**
 * What a Website Scanner scan checks for, as the create-scan API takes it under
 * scanSettings. A setting left out takes the API's default.
 */
export interface ScanSettings {
  /** The WCAG version and level, such as "wcag22aa", or "rgaa41" (API default "wcag21aa"). */
  wcagVersion?: string;
  /** Report best-practice issues too (API default false). */
  bestPractices?: boolean;
  /** Report issues that need a manual review (API default true). */
  needsReview?: boolean;
  /** Run the advanced rules (API default true). */
  advancedRules?: boolean;
  /** Run the experimental rules (API default true). */
  experimentalRules?: boolean;
}

export class AccessibilityScanner {
  private auth: { username: string; password: string } | undefined;

  public setAuth(auth: { username: string; password: string }): void {
    this.auth = auth;
  }

  async startScan(
    name: string,
    urlList: string[],
    authConfigId?: number,
    settings: ScanSettings = {},
  ): Promise<AccessibilityScanResponse> {
    if (!this.auth?.username || !this.auth?.password) {
      throw new Error(
        "BrowserStack credentials are not set for AccessibilityScanner.",
      );
    }
    // Check if any URL is local
    const hasLocal = urlList.some(isLocalURL);
    const localIdentifier = randomUUID();
    const localHosts = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
    const BS_LOCAL_DOMAIN = "bs-local.com";

    if (config.USE_OWN_LOCAL_BINARY_PROCESS && hasLocal) {
      throw new Error(
        "Cannot start scan with local URLs when using own BrowserStack Local binary process. Please set USE_OWN_LOCAL_BINARY_PROCESS to false.",
      );
    }

    if (config.REMOTE_MCP && hasLocal) {
      throw new Error(
        "Local URLs are not supported in this remote mcp. Please use a public URL.",
      );
    }

    if (hasLocal) {
      await ensureLocalBinarySetup(
        this.auth.username,
        this.auth.password,
        localIdentifier,
      );
    } else {
      await killExistingBrowserStackLocalProcesses();
    }

    const transformedUrlList = urlList.map((url) => {
      try {
        const parsed = new URL(url);
        if (localHosts.has(parsed.hostname)) {
          parsed.hostname = BS_LOCAL_DOMAIN;
          return parsed.toString();
        }
        return url;
      } catch (e) {
        logger.warn(`[AccessibilityScan] Invalid URL skipped: ${e}`);
        return url;
      }
    });

    const scanSettings = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined),
    );
    const baseRequestBody = {
      name,
      urlList: transformedUrlList,
      recurring: false,
      ...(authConfigId && { authConfigId }),
      ...(Object.keys(scanSettings).length > 0 && { scanSettings }),
    };

    let requestBody = baseRequestBody;
    if (hasLocal) {
      const localConfig = {
        localTestingInfo: {
          localIdentifier,
          localEnabled: true,
        },
      };
      requestBody = { ...baseRequestBody, ...localConfig };
    }

    try {
      const response = await apiClient.post<AccessibilityScanResponse>({
        url: `${getRegionalHost("accessibilityApi")}/api/website-scanner/v1/scans`,
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.auth.username}:${this.auth.password}`).toString(
              "base64",
            ),
          "Content-Type": "application/json",
        },
        body: requestBody,
      });
      const data = response.data;
      if (!data.success)
        throw new Error(
          `Unable to start scan: ${data.errors?.join(", ") || JSON.stringify(data)}`,
        );
      return data;
    } catch (err: any) {
      // apiClient throws generic errors, try to extract message. A 422 also refuses a
      // setting (a WCAG version the API does not take), so its own reason comes first.
      const data = err?.response?.data;
      const reason =
        data?.error ||
        data?.message ||
        (Array.isArray(data?.errors) ? data.errors.join(", ") : undefined);
      if (err?.response?.status === 422 && !reason) {
        throw new Error(
          "A scan with this name already exists. please update the name and run again.",
        );
      }
      throw new Error(
        `Failed to start scan: ${reason || err?.message || String(err)}`,
      );
    }
  }

  /**
   * The settings a run actually ran with, from its summary, or undefined when it cannot be
   * read. A setting left out takes the API's default, and the plan can turn advanced rules
   * off, so what was asked for is not always what ran. The summary has no experimental
   * rules: they come from the scan's own settings, which a scan started here has for this
   * run alone.
   */
  async runSettings(
    scanId: string,
    scanRunId: string,
  ): Promise<ScanSettings | undefined> {
    const read = (path: string) =>
      apiClient
        .get({
          url: `${getRegionalHost("accessibilityApi")}/api/website-scanner/v1/scans/${path}`,
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                `${this.auth?.username}:${this.auth?.password}`,
              ).toString("base64"),
          },
          raise_error: false,
        })
        .catch(() => undefined);
    const [resp, overview] = await Promise.all([
      read(`${scanId}/scan_runs/${scanRunId}`),
      read(`${scanId}/overview`),
    ]);
    const run = resp?.ok ? resp.data?.data : undefined;
    if (!run) return undefined;
    const experimental = overview?.ok
      ? overview.data?.data?.scanConfigInfo?.experimental
      : undefined;
    return {
      ...(run.wcagVersion ? { wcagVersion: run.wcagVersion } : {}),
      ...(typeof run.bestPractices === "boolean"
        ? { bestPractices: run.bestPractices }
        : {}),
      ...(typeof run.needsReview === "boolean"
        ? { needsReview: run.needsReview }
        : {}),
      ...(typeof run.advanced === "boolean"
        ? { advancedRules: run.advanced }
        : {}),
      ...(typeof experimental === "boolean"
        ? { experimentalRules: experimental }
        : {}),
    };
  }

  /**
   * A scan's own page in the dashboard, as the scans list links it (`scanUrl`), or
   * undefined when it cannot be read. The page is named by the scan's build, so it cannot
   * be made from the scan's name; a scan just started is on the list's first page.
   */
  async dashboardLink(scanId: string): Promise<string | undefined> {
    const resp = await apiClient
      .get({
        url: "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${this.auth?.username}:${this.auth?.password}`,
            ).toString("base64"),
        },
        raise_error: false,
      })
      .catch(() => undefined);
    if (!resp?.ok) return undefined;
    const scans: { id?: unknown; scanUrl?: unknown }[] =
      resp.data?.data?.scans ?? [];
    const link = scans.find(
      (scan) => String(scan.id) === String(scanId),
    )?.scanUrl;
    return typeof link === "string" && link ? link : undefined;
  }

  async pollStatus(
    scanId: string,
    scanRunId: string,
  ): Promise<AccessibilityScanStatus> {
    try {
      const response = await apiClient.get<AccessibilityScanStatus>({
        url: `${getRegionalHost("accessibilityApi")}/api/website-scanner/v1/scans/${scanId}/scan_runs/${scanRunId}/status`,
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${this.auth?.username}:${this.auth?.password}`,
            ).toString("base64"),
        },
      });
      const data = response.data;
      if (!data.success)
        throw new Error(`Failed to get status: ${data.errors?.join(", ")}`);
      return data;
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || String(err);
      throw new Error(`Failed to get scan status: ${msg}`);
    }
  }

  async waitUntilComplete(
    scanId: string,
    scanRunId: string,
    context: any,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let timepercent = 0;
      let dotCount = 1;
      const interval = setInterval(async () => {
        try {
          const statusResp = await this.pollStatus(scanId, scanRunId);
          const status = statusResp.data!.status;
          timepercent += 1.67;
          const progress = status === "completed" ? 100 : timepercent;
          const dots = ".".repeat(dotCount);
          dotCount = (dotCount % 4) + 1;
          const message =
            status === "completed" || status === "failed"
              ? `Scan completed with status: ${status}`
              : `Scan in progress${dots}`;
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
