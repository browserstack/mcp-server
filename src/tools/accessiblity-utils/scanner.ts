import { apiClient } from "../../lib/apiClient.js";
import { randomUUID } from "node:crypto";
import logger from "../../logger.js";
import {
  isLocalURL,
  ensureLocalBinarySetup,
  killExistingBrowserStackLocalProcesses,
} from "../../lib/local.js";
import config from "../../config.js";

export interface AccessibilityScanResponse {
  success: boolean;
  data?: { id: string; scanRunId: string };
  errors?: string[];
  /** The name the scan was started under, when the name asked for was already taken. */
  scanName?: string;
}

/** How long startAccessibilityScan waits for a scan to finish before handing back its ids. */
export const SCAN_WAIT_MS = 5 * 60 * 1000;

/** Run statuses after which a scan does no more work. */
const FINAL_SCAN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * The wait ran out while the scan was still running. Only the wait ends: the scan carries
 * on server-side, so the caller still has a scan to come back to.
 */
export class ScanTimeoutError extends Error {
  constructor(public readonly waitedMs: number) {
    super(`Scan still running after ${Math.round(waitedMs / 60000)} minutes`);
    this.name = "ScanTimeoutError";
  }
}

/** How to scan through a tunnel the user starts, which the scan API takes by identifier. */
const OWN_TUNNEL_HINT =
  "Start BrowserStack Local yourself (the BrowserStack Local app, or BrowserStackLocal --key <your access key> --local-identifier <a name>) and pass that name as localIdentifier.";

/** The longest scan name the API takes. */
const MAX_SCAN_NAME_LENGTH = 255;

/**
 * The name with the time appended, as "<name> 2026-11-03 07:45:12 UTC". Only digits,
 * "-", ":" and spaces are added, all of which the API allows in a name, and the name is
 * shortened to keep the whole within the API's length limit.
 */
export function timestampedName(name: string, now: Date = new Date()): string {
  const stamp = `${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;
  return `${name.slice(0, MAX_SCAN_NAME_LENGTH - stamp.length - 1).trimEnd()} ${stamp}`;
}

/** The API's own reason for refusing a request, when its body gives one. */
function refusalReason(err: any): string | undefined {
  const data = err?.response?.data;
  return (
    data?.error ||
    data?.message ||
    (Array.isArray(data?.errors) ? data.errors.join(", ") : undefined)
  );
}

/**
 * A 422 for a name already in use. A 422 also refuses a setting (a WCAG version the API
 * does not take), so only one that says so, or gives no reason at all, is read this way.
 */
function nameIsTaken(err: any): boolean {
  if (err?.response?.status !== 422) return false;
  const reason = refusalReason(err);
  return !reason || /already exists/i.test(String(reason));
}

function scanStartError(err: any): Error {
  // apiClient throws generic errors, try to extract message.
  const reason = refusalReason(err);
  if (err?.response?.status === 422 && !reason) {
    return new Error(
      "A scan with this name already exists. please update the name and run again.",
    );
  }
  return new Error(
    `Failed to start scan: ${reason || err?.message || String(err)}`,
  );
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
    ownTunnel?: string,
  ): Promise<AccessibilityScanResponse> {
    if (!this.auth?.username || !this.auth?.password) {
      throw new Error(
        "BrowserStack credentials are not set for AccessibilityScanner.",
      );
    }
    // Check if any URL is local
    const hasLocal = urlList.some(isLocalURL);
    const localIdentifier = ownTunnel ?? randomUUID();
    const localHosts = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
    const BS_LOCAL_DOMAIN = "bs-local.com";

    // A tunnel the user started is theirs to run: none is started here, and none is killed,
    // as killing every BrowserStackLocal process would take theirs down with it.
    if (!ownTunnel) {
      if (config.USE_OWN_LOCAL_BINARY_PROCESS && hasLocal) {
        throw new Error(
          `Cannot start scan with local URLs when using own BrowserStack Local binary process. ${OWN_TUNNEL_HINT}`,
        );
      }

      // The hosted server cannot start a tunnel on the user's machine, but the scan API
      // takes the identifier of one the user started.
      if (config.REMOTE_MCP && hasLocal) {
        throw new Error(
          `This hosted BrowserStack MCP runs on BrowserStack's servers, so it cannot open a tunnel to a local URL on your machine. ${OWN_TUNNEL_HINT} Or scan a public URL.`,
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
    if (hasLocal || ownTunnel) {
      const localConfig = {
        localTestingInfo: {
          localIdentifier,
          localEnabled: true,
        },
      };
      requestBody = { ...baseRequestBody, ...localConfig };
    }

    const { username, password } = this.auth;
    const create = async (body: typeof requestBody) => {
      const response = await apiClient.post<AccessibilityScanResponse>({
        url: "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${username}:${password}`).toString("base64"),
          "Content-Type": "application/json",
        },
        body,
      });
      const data = response.data;
      if (!data.success)
        throw new Error(
          `Unable to start scan: ${data.errors?.join(", ") || JSON.stringify(data)}`,
        );
      return data;
    };

    try {
      return await create(requestBody);
    } catch (err: any) {
      if (!nameIsTaken(err)) throw scanStartError(err);
    }
    // Scan names are unique per account, so an agent re-scanning a page under the name it
    // used before is refused. Starting it once more under a timestamped name is what the
    // user would do by hand.
    const scanName = timestampedName(name);
    try {
      return {
        ...(await create({ ...requestBody, name: scanName })),
        scanName,
      };
    } catch (err: any) {
      throw scanStartError(err);
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
          url: `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${path}`,
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
        url: `https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/${scanId}/scan_runs/${scanRunId}/status`,
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
          const finished = FINAL_SCAN_STATUSES.has(status);
          const message = finished
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
          if (finished) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(status);
          }
        } catch (e) {
          clearInterval(interval);
          clearTimeout(timeout);
          reject(e);
        }
      }, 5000);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new ScanTimeoutError(SCAN_WAIT_MS));
      }, SCAN_WAIT_MS);
    });
  }
}
