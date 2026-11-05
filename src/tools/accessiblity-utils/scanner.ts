import { apiClient } from "../../lib/apiClient.js";
import logger from "../../logger.js";
import {
  isLocalURL,
  ensureOwnTunnel,
  otherBrowserStackLocalPids,
} from "../../lib/local.js";
import config from "../../config.js";

export interface AccessibilityScanResponse {
  success: boolean;
  data?: { id: string; scanRunId: string };
  errors?: string[];
  /** The name the scan was started under, when it differs from the name asked for. */
  scanName?: string;
  /** Why it differs: characters a scan name cannot hold, and/or a name already taken. */
  nameChanges?: ("characters" | "taken")[];
}

/** Why a run failed, as far as the API says: the run's own reason and each page's log. */
export interface ScanFailureDetails {
  reason?: string;
  pages: { pageUrl: string; status: string; reason: string }[];
}

const SCANS_API =
  "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans";

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

/**
 * A refusal whose message is the whole answer, given as a plain result: not as a failure to
 * start the scan with the advice to open an issue (or to send feedback, which an error
 * result gets), since nothing is broken and the message says what to do instead.
 */
export class ScanRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanRefusedError";
  }
}

/**
 * central-scanner's refusal of a scan over the plan's limit, "You don't have access to make
 * over 50 scans". It read as a failure to report on GitHub, with no hint of the limit.
 */
const SCAN_LIMIT_REFUSAL = /make over \d+ scans/i;

export const SCAN_LIMIT_MESSAGE =
  "Your plan allows 50 saved scans and this account has reached that limit. Delete scans you no longer need in the dashboard, or upgrade the plan to create more.";

/** Hosts on the user's own machine, which a scan reaches as bs-local.com through the tunnel. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
const BS_LOCAL_DOMAIN = "bs-local.com";

/** The URL as a scan is created with it, and so as the scan saves it. */
export function scanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (LOCAL_HOSTS.has(parsed.hostname)) {
      parsed.hostname = BS_LOCAL_DOMAIN;
      return parsed.toString();
    }
    return url;
  } catch (e) {
    logger.warn(`[AccessibilityScan] Invalid URL skipped: ${e}`);
    return url;
  }
}

/**
 * Whether a scan's saved URL is this page: the page is put as a scan would save it
 * (scanUrl), and the case of the host and a trailing slash are not told apart.
 */
export function samePage(savedUrl: string, pageURL: string): boolean {
  const key = (url: string) => {
    const trimmed = url.trim();
    try {
      const parsed = new URL(scanUrl(trimmed));
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      return parsed.toString();
    } catch {
      return trimmed.replace(/\/+$/, "");
    }
  };
  return key(savedUrl) === key(pageURL);
}

/** A scan id this account cannot see, or that is no scan's. */
function notVisible(scanId: string): string {
  return `No scan with id ${scanId} is visible to this account, so nothing was started. Leave out scanId to start a new scan.`;
}

/**
 * A scan's saved setup, from its overview: what a re-run of it runs with. A setting left out
 * is one the overview does not give.
 */
export interface SavedScan {
  name?: string;
  urlList: string[];
  settings: ScanSettings;
  /** Whether a login (auth config) is saved; which one, the overview does not say. */
  authEnabled?: boolean;
  /** Whether the scan goes through BrowserStack Local; its identifier is not given. */
  localTestingEnabled?: boolean;
}

/** How to scan through a tunnel the user starts, which the scan API takes by identifier. */
const OWN_TUNNEL_HINT =
  "Start BrowserStack Local yourself (the BrowserStack Local app, or BrowserStackLocal --key <your access key> --local-identifier <a name>) and pass that name as localIdentifier.";

/** The longest scan name the API takes. */
const MAX_SCAN_NAME_LENGTH = 255;

/**
 * One character central-scanner takes in a scan name (lib/util.rb validate_project_name),
 * which also refuses "--". It takes "(" but not ")", so both become square brackets.
 */
const NAME_CHARACTER = /[A-Za-z0-9_:*.@!$ '{}[\]-]/;

/**
 * The name with every character central-scanner refuses replaced, rather than the scan
 * refused: agents name scans after page titles and paths, with "/", "|", "&" or ",". Accents
 * are dropped first ("Café" becomes "Cafe"), and a run of replaced characters becomes one
 * "-", or " - " where it stood between words. A name left with no letters or digits, as a
 * name in another script is, falls back to the given one.
 */
export function cleanScanName(name: string, fallback: string): string {
  const cleaned = Array.from(
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\(/g, "[")
      .replace(/\)/g, "]")
      .replace(/\s+/g, " "),
  )
    .map((ch) => (NAME_CHARACTER.test(ch) ? ch : "-"))
    .join("")
    .replace(/[\s-]*-[\s-]*/g, (run) => (/\s/.test(run) ? " - " : "-"))
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .slice(0, MAX_SCAN_NAME_LENGTH)
    .replace(/[\s-]+$/, "");
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
}

/** A scan name to fall back on: the first page's host, which is always a valid name. */
function hostName(urlList: string[]): string {
  try {
    return new URL(urlList[0]).hostname || "Accessibility scan";
  } catch {
    return "Accessibility scan";
  }
}

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
  if (
    err?.response?.status === 402 &&
    SCAN_LIMIT_REFUSAL.test(String(reason ?? ""))
  ) {
    return new ScanRefusedError(SCAN_LIMIT_MESSAGE);
  }
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

    // A tunnel the user started is theirs to run: none is started here. A public URL needs
    // no tunnel. Either way no BrowserStack Local already running is stopped.
    let localIdentifier = ownTunnel;
    if (!ownTunnel && hasLocal) {
      // Both are limits of how this MCP runs, not failures: the scan API takes the
      // identifier of a tunnel the user started.
      if (config.USE_OWN_LOCAL_BINARY_PROCESS) {
        throw new ScanRefusedError(
          `This BrowserStack MCP is set to use your own BrowserStack Local (USE_OWN_LOCAL_BINARY_PROCESS), so it starts no tunnel for a local URL. ${OWN_TUNNEL_HINT} Or scan a public URL.`,
        );
      }
      if (config.REMOTE_MCP) {
        throw new ScanRefusedError(
          `This hosted BrowserStack MCP runs on BrowserStack's servers, so it cannot open a tunnel to a local URL on your machine. ${OWN_TUNNEL_HINT} Or scan a public URL.`,
        );
      }
      localIdentifier = await this.mcpTunnel();
    }

    const transformedUrlList = urlList.map(scanUrl);

    const scanSettings = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined),
    );
    const cleanName = cleanScanName(name, hostName(urlList));
    const baseRequestBody = {
      name: cleanName,
      urlList: transformedUrlList,
      recurring: false,
      ...(authConfigId && { authConfigId }),
      ...(Object.keys(scanSettings).length > 0 && { scanSettings }),
    };

    let requestBody = baseRequestBody;
    if (localIdentifier) {
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

    const cleaned = cleanName !== name;
    try {
      const data = await create(requestBody);
      return cleaned
        ? { ...data, scanName: cleanName, nameChanges: ["characters"] }
        : data;
    } catch (err: any) {
      if (!nameIsTaken(err)) throw scanStartError(err);
    }
    // Scan names are unique per account, so an agent re-scanning a page under the name it
    // used before is refused. Starting it once more under a timestamped name is what the
    // user would do by hand.
    const scanName = timestampedName(cleanName);
    try {
      return {
        ...(await create({ ...requestBody, name: scanName })),
        scanName,
        nameChanges: cleaned ? ["characters", "taken"] : ["taken"],
      };
    } catch (err: any) {
      throw scanStartError(err);
    }
  }

  /**
   * This MCP's own tunnel, started or reused, under its own identifier. It runs alongside
   * any tunnel the user has up. Should it fail to start while another is running, the way
   * forward is to scan through theirs, which is left running.
   */
  private async mcpTunnel(): Promise<string> {
    const { username, password } = this.auth!;
    try {
      return await ensureOwnTunnel(username, password);
    } catch (error) {
      const others = otherBrowserStackLocalPids();
      if (!others.length) throw error;
      const reason = (error instanceof Error ? error.message : String(error))
        .trim()
        .replace(/[.\s]+$/, "");
      throw new Error(
        `${reason}. Another BrowserStack Local is running on this machine (pid ${others.join(", ")}), and this MCP leaves it running. If it is your tunnel, pass the name it runs under (its --local-identifier) as localIdentifier to scan through it`,
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

  /**
   * Why a run failed. The run's own reason is only on the scans list (lastScanDetails.error,
   * such as "The requested page is not reachable"), so it is taken only when the list's last
   * run is this one; each page's reason is in the run's scan logs ("[HTTP 403] Forbidden",
   * "Failed to start the test"). Either can be missing, and a read that fails gives nothing
   * rather than an error on top of the failed scan.
   */
  async failureDetails(
    scanId: string,
    scanRunId: string,
  ): Promise<ScanFailureDetails> {
    const [list, pages] = await Promise.all([
      this.readQuietly(SCANS_API),
      this.unscannedPages(scanId, scanRunId),
    ]);
    const last = (
      list?.ok
        ? ((list.data?.data?.scans ?? []) as any[]).find(
            (scan) => String(scan?.id) === String(scanId),
          )
        : undefined
    )?.lastScanDetails;
    const reason =
      last &&
      String(last.scanRunId) === String(scanRunId) &&
      typeof last.error === "string" &&
      last.error.trim()
        ? last.error.trim()
        : undefined;
    return { ...(reason ? { reason } : {}), pages };
  }

  /**
   * The pages of a run whose scan log is not a success, each with the log's reason. Only
   * the run's logs are read, not the scans list failureDetails also reads: a completed run
   * names the pages it could not scan here too, and they are otherwise simply absent from
   * its report. A read that fails gives none.
   */
  async unscannedPages(
    scanId: string,
    scanRunId: string,
  ): Promise<ScanFailureDetails["pages"]> {
    const logs = await this.readQuietly(
      `${SCANS_API}/${encodeURIComponent(scanId)}/scan_runs/${encodeURIComponent(scanRunId)}/scan_logs`,
    );
    const entries: unknown = logs?.ok ? logs.data?.data?.scanLogs : undefined;
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => entry && entry.status !== "success")
      .map((entry) => {
        const said = [entry.description, entry.error]
          .filter((part) => typeof part === "string" && part.trim())
          .map((part: string) => part.trim());
        const redirect =
          typeof entry.finalRedirectUrl === "string" && entry.finalRedirectUrl
            ? `redirected to ${entry.finalRedirectUrl}`
            : "";
        return {
          pageUrl: String(entry.pageUrl ?? ""),
          status: String(entry.status ?? ""),
          reason:
            [...new Set(said), redirect].filter(Boolean).join("; ") ||
            String(entry.status ?? "unknown"),
        };
      });
  }

  /**
   * A GET of the scanner API, or undefined when it fails: for reads that only add detail to
   * an answer, so their failure must not become the answer.
   */
  private async readQuietly(url: string) {
    try {
      return await apiClient.get({
        url,
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${this.auth?.username}:${this.auth?.password}`,
            ).toString("base64"),
        },
        raise_error: false,
      });
    } catch {
      return undefined;
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization:
        "Basic " +
        Buffer.from(`${this.auth?.username}:${this.auth?.password}`).toString(
          "base64",
        ),
    };
  }

  /**
   * A scan's saved setup, which a re-run of it runs with. An id that is no scan this account
   * can see is a refusal to say as it is; the API takes only a number.
   */
  async savedScan(scanId: string): Promise<SavedScan> {
    if (!/^\d+$/.test(scanId)) throw new ScanRefusedError(notVisible(scanId));
    const resp = await apiClient.get({
      url: `${SCANS_API}/${scanId}/overview`,
      headers: this.authHeaders(),
      raise_error: false,
    });
    if (resp.status === 404) throw new ScanRefusedError(notVisible(scanId));
    if (!resp.ok) {
      const reason = refusalReason({ response: resp });
      throw new Error(
        `Could not read scan ${scanId} to check it is for this page (${reason || `HTTP ${resp.status}`}); nothing was started`,
      );
    }
    const data = resp.data?.data ?? {};
    const info = data.scanConfigInfo ?? {};
    const flag = (value: unknown) =>
      typeof value === "boolean" ? value : undefined;
    const settings: ScanSettings = {
      ...(typeof info.wcagVersion === "string" && info.wcagVersion
        ? { wcagVersion: info.wcagVersion }
        : {}),
      ...(flag(info.bestPractices) !== undefined
        ? { bestPractices: info.bestPractices }
        : {}),
      ...(flag(info.needsReview) !== undefined
        ? { needsReview: info.needsReview }
        : {}),
      ...(flag(info.advanced) !== undefined
        ? { advancedRules: info.advanced }
        : {}),
      ...(flag(info.experimental) !== undefined
        ? { experimentalRules: info.experimental }
        : {}),
    };
    return {
      ...(typeof info.name === "string" && info.name
        ? { name: info.name }
        : {}),
      urlList: Array.isArray(data.urlList) ? data.urlList.map(String) : [],
      settings,
      authEnabled: flag(info.authEnabled),
      localTestingEnabled: flag(info.localTestingEnabled),
    };
  }

  /**
   * Starts a new run of a saved scan. The endpoint takes no settings: the run has the
   * scan's saved ones, Local and login included. Its refusals are said as they are.
   */
  async rerunScan(scanId: string): Promise<{ scanRunId: string }> {
    let data: any;
    try {
      const response = await apiClient.post({
        url: `${SCANS_API}/${scanId}/new_scan`,
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
        },
        body: {},
      });
      data = response.data;
    } catch (err: any) {
      throw await this.rerunRefusal(scanId, err);
    }
    const scanRunId = data?.data?.scanRunId;
    if (!data?.success || scanRunId === undefined || scanRunId === null) {
      throw new Error(
        `Unable to re-run scan ${scanId}: ${data?.error || JSON.stringify(data)}`,
      );
    }
    return { scanRunId: String(scanRunId) };
  }

  private async rerunRefusal(scanId: string, err: any): Promise<Error> {
    const status = err?.response?.status;
    const reason = refusalReason(err);
    const said = String(reason ?? "");
    if (status === 422 && /already in progress/i.test(said)) {
      const run = await this.runInProgress(scanId);
      return new ScanRefusedError(
        run
          ? `A run of scan ${scanId} is still going (run ${run.id}, ${run.status}), so a new run was not started. Read that run's issues with fetchAccessibilityIssues (scanId "${scanId}", scanRunId "${run.id}") once it finishes, or wait for it to finish and call startAccessibilityScan with scanId "${scanId}" again for another run.`
          : `A run of scan ${scanId} is still going, so a new run was not started; its run id could not be read (the scan's page in the dashboard shows it). Wait for it to finish, then read its issues with fetchAccessibilityIssues, or call startAccessibilityScan with scanId "${scanId}" again for another run.`,
      );
    }
    if (status === 403 && /auth config/i.test(said)) {
      return new ScanRefusedError(
        `Scan ${scanId} can't be re-run: the login config (auth config) it was saved with has been deleted. Start a new scan instead: call startAccessibilityScan without scanId, with an authConfigId that exists if the page needs a login.`,
      );
    }
    if (status === 404) return new ScanRefusedError(notVisible(scanId));
    if (typeof status === "number" && status >= 400 && status < 500 && said) {
      // 402 is the plan: its message names what the plan does not include.
      return new ScanRefusedError(
        `Scan ${scanId} was not re-run: ${said}${/[.!?]$/.test(said) ? "" : "."}`,
      );
    }
    return new Error(
      `Failed to re-run scan ${scanId}: ${said || err?.message || String(err)}`,
    );
  }

  /**
   * The run of a scan that is still going, or undefined when it cannot be told. The scans
   * list gives each scan's last run with its status, but only for a scan on its first page;
   * the scan's own runs list has every run, newest by date, but no status.
   */
  async runInProgress(
    scanId: string,
  ): Promise<{ id: string; status: string } | undefined> {
    const read = (url: string) =>
      apiClient
        .get({ url, headers: this.authHeaders(), raise_error: false })
        .catch(() => undefined);
    const going = (status: unknown): status is string =>
      typeof status === "string" && !FINAL_SCAN_STATUSES.has(status);
    const [list, runs] = await Promise.all([
      read(SCANS_API),
      read(`${SCANS_API}/${scanId}/scan_runs`),
    ]);
    const last = (
      list?.ok
        ? ((list.data?.data?.scans ?? []) as any[]).find(
            (scan) => String(scan?.id) === String(scanId),
          )
        : undefined
    )?.lastScanDetails;
    if (last?.scanRunId && going(last.scanStatus)) {
      return { id: String(last.scanRunId), status: last.scanStatus };
    }
    const newest = (
      runs?.ok ? ((runs.data?.data?.scanRuns ?? []) as any[]) : []
    )
      .filter((run) => run?.id !== undefined)
      .sort((a, b) => String(b.scanDate).localeCompare(String(a.scanDate)))[0];
    if (!newest) return undefined;
    const status = (
      await read(`${SCANS_API}/${scanId}/scan_runs/${newest.id}/status`)
    )?.data?.data?.status;
    return going(status) ? { id: String(newest.id), status } : undefined;
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
