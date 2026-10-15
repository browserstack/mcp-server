import FormData from "form-data";
import fs from "fs";
import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  APP_BINARY_EXTENSIONS,
  MAX_APP_UPLOAD_BYTES,
  validateUploadPath,
} from "../../lib/upload-validator.js";
import appConfig from "../../config.js";
import { APP_AUTOMATE_API_BASE, AUTOMATE_API_BASE } from "./constants.js";

/** Which REST surface a hub session belongs to: App Automate (devices) or Automate (browsers). */
export type SessionProduct = "app-automate" | "automate";

const sessionsBase = (product: SessionProduct) =>
  product === "automate" ? AUTOMATE_API_BASE : APP_AUTOMATE_API_BASE;

function basicAuth(config: BrowserStackConfig): string {
  return "Basic " + Buffer.from(getBrowserStackAuth(config)).toString("base64");
}

function failure(prefix: string, error: any): Error {
  const status = error?.response?.status;
  const msg =
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    String(error);
  return new Error(`${prefix}${status ? ` (HTTP ${status})` : ""}: ${msg}`);
}

export interface UploadResult {
  app_url: string;
  custom_id?: string;
  shareable_id?: string;
}

/**
 * Upload an app build to App Automate from a local file (restricted to
 * MCP_UPLOAD_BASE_DIR) or a public download URL. Agent sessions run on App
 * Automate, so that is the only upload target.
 */
export async function uploadMobileApp(
  args: {
    filePath?: string;
    url?: string;
    customId?: string;
  },
  config: BrowserStackConfig,
): Promise<UploadResult> {
  if (!!args.filePath === !!args.url) {
    throw new Error("Provide exactly one of filePath or url.");
  }

  const form = new FormData();
  if (args.filePath) {
    if (appConfig.REMOTE_MCP) {
      // Files on the server's disk belong to the operator, not to the remote user.
      throw new Error(
        "Uploading a local file is not available on the remote server; use a public https url instead.",
      );
    }
    const safePath = validateUploadPath(args.filePath, {
      allowedExtensions: APP_BINARY_EXTENSIONS,
      maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      allowedBaseDir: appConfig.UPLOAD_BASE_DIR,
    });
    form.append("file", fs.createReadStream(safePath));
  } else {
    let parsed: URL;
    try {
      parsed = new URL(args.url!);
    } catch {
      throw new Error("url must be a valid https:// download link.");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("url must use https://.");
    }
    form.append("url", parsed.toString());
  }
  if (args.customId) form.append("custom_id", args.customId);

  const url = `${APP_AUTOMATE_API_BASE}/upload`;
  try {
    const response = await apiClient.post<UploadResult>({
      url,
      headers: { ...form.getHeaders(), Authorization: basicAuth(config) },
      body: form,
      timeout: 600_000,
    });
    if (!response.data?.app_url) {
      throw new Error(
        `upload returned no app_url: ${JSON.stringify(response.data).slice(0, 300)}`,
      );
    }
    return response.data;
  } catch (error) {
    throw failure("App upload failed", error);
  }
}

export interface RecentApp {
  app_name?: string;
  app_version?: string;
  app_url?: string;
  app_id?: string;
  custom_id?: string;
  uploaded_at?: string;
  expiry?: string;
}

/** Apps uploaded to App Automate, newest first. `scope: "group"` includes teammates' uploads. */
export async function listRecentApps(
  args: { scope: "mine" | "group"; customId?: string; limit: number },
  config: BrowserStackConfig,
): Promise<RecentApp[]> {
  const endpoint = args.scope === "group" ? "recent_group_apps" : "recent_apps";
  const path = args.customId
    ? `${endpoint}/${encodeURIComponent(args.customId)}`
    : endpoint;
  const response = await apiClient.get<RecentApp[] | { message?: string }>({
    url: `${APP_AUTOMATE_API_BASE}/${path}`,
    headers: { Authorization: basicAuth(config) },
    params: { limit: args.limit },
    raise_error: false,
  });
  // BrowserStack answers "no apps yet" with a message object (sometimes a 404).
  if (Array.isArray(response.data)) return response.data;
  if (response.ok || response.status === 404) return [];
  throw new Error(
    `Listing uploaded apps failed (HTTP ${response.status}): ${JSON.stringify(response.data).slice(0, 300)}`,
  );
}

export interface AppAutomatePlan {
  automate_plan?: string;
  parallel_sessions_running?: number;
  parallel_sessions_max_allowed?: number;
  team_parallel_sessions_max_allowed?: number;
  queued_sessions?: number;
  queued_sessions_max_allowed?: number;
}

/** App Automate plan and parallel usage. */
export async function getAppAutomatePlan(
  config: BrowserStackConfig,
): Promise<AppAutomatePlan> {
  try {
    const response = await apiClient.get<AppAutomatePlan>({
      url: `${APP_AUTOMATE_API_BASE}/plan.json`,
      headers: { Authorization: basicAuth(config) },
    });
    return response.data;
  } catch (error) {
    throw failure("Fetching the App Automate plan failed", error);
  }
}

export interface AppAutomateDevice {
  os: string;
  os_version: string;
  device: string;
  realMobile?: boolean;
  device_tier?: string;
  device_limit?: number;
}

/** Devices the account can start App Automate sessions on (authoritative for this account). */
export async function listAppAutomateDevices(
  config: BrowserStackConfig,
): Promise<AppAutomateDevice[]> {
  try {
    const response = await apiClient.get<AppAutomateDevice[]>({
      url: `${APP_AUTOMATE_API_BASE}/devices.json`,
      headers: { Authorization: basicAuth(config) },
    });
    if (!Array.isArray(response.data)) {
      throw new Error("unexpected response shape");
    }
    return response.data;
  } catch (error) {
    throw failure("Listing App Automate devices failed", error);
  }
}

export interface AutomationSessionDetails {
  name?: string;
  status?: string;
  reason?: string;
  duration?: number;
  os?: string;
  os_version?: string;
  device?: string;
  build_name?: string;
  project_name?: string;
  browser_url?: string;
  public_url?: string;
  video_url?: string;
  app_details?: Record<string, unknown>;
  created_at?: string;
  hashed_id?: string;
}

/** REST session details, including the shareable public_url. */
export async function getSessionDetails(
  sessionId: string,
  config: BrowserStackConfig,
  product: SessionProduct = "app-automate",
): Promise<AutomationSessionDetails> {
  try {
    const response = await apiClient.get<{
      automation_session?: AutomationSessionDetails;
    }>({
      url: `${sessionsBase(product)}/sessions/${encodeURIComponent(sessionId)}.json`,
      headers: { Authorization: basicAuth(config) },
    });
    return response.data?.automation_session ?? {};
  } catch (error) {
    throw failure("Fetching session details failed", error);
  }
}

/** Mark the session passed/failed on the dashboard. Works after the session ended too. */
export async function setSessionStatus(
  sessionId: string,
  status: "passed" | "failed",
  reason: string,
  config: BrowserStackConfig,
  product: SessionProduct = "app-automate",
): Promise<void> {
  try {
    await apiClient.put({
      url: `${sessionsBase(product)}/sessions/${encodeURIComponent(sessionId)}.json`,
      headers: {
        Authorization: basicAuth(config),
        "Content-Type": "application/json",
      },
      body: { status, reason: reason.slice(0, 255) },
    });
  } catch (error) {
    throw failure("Setting session status failed", error);
  }
}

export interface AutomateBrowser {
  os: string;
  os_version: string;
  browser: string;
  browser_version: string | null;
  device: string | null;
  real_mobile: boolean | null;
}

/** Every OS / browser / device combination the Automate hub accepts. */
export async function listAutomateBrowsers(
  config: BrowserStackConfig,
): Promise<AutomateBrowser[]> {
  try {
    const response = await apiClient.get<AutomateBrowser[]>({
      url: `${AUTOMATE_API_BASE}/browsers.json`,
      headers: { Authorization: basicAuth(config) },
    });
    if (!Array.isArray(response.data))
      throw new Error("unexpected response shape");
    return response.data;
  } catch (error) {
    throw failure("Listing browsers failed", error);
  }
}

/** Automate (web) plan and parallel usage. */
export async function getAutomatePlan(
  config: BrowserStackConfig,
): Promise<AppAutomatePlan> {
  try {
    const response = await apiClient.get<AppAutomatePlan>({
      url: `${AUTOMATE_API_BASE}/plan.json`,
      headers: { Authorization: basicAuth(config) },
    });
    return response.data;
  } catch (error) {
    throw failure("Fetching the Automate plan failed", error);
  }
}

export const MEDIA_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".mp4",
  ".mov",
  ".3gp",
  ".mp3",
  ".wav",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".zip",
  ".vcf",
] as const;

/** Upload a media file for use on devices (uploadMedia, camera injection). */
export async function uploadMedia(
  args: { filePath: string; customId?: string },
  config: BrowserStackConfig,
): Promise<{ media_url: string; custom_id?: string }> {
  if (appConfig.REMOTE_MCP) {
    // Files on the server's disk belong to the operator, not to the remote user.
    throw new Error(
      "Uploading a local file is not available on the remote server; use the local server for media uploads.",
    );
  }
  const safePath = validateUploadPath(args.filePath, {
    allowedExtensions: MEDIA_EXTENSIONS,
    maxSizeBytes: 50 * 1024 * 1024,
    allowedBaseDir: appConfig.UPLOAD_BASE_DIR,
  });
  const form = new FormData();
  form.append("file", fs.createReadStream(safePath));
  if (args.customId) form.append("custom_id", args.customId);
  try {
    const response = await apiClient.post<{
      media_url: string;
      custom_id?: string;
    }>({
      url: `${APP_AUTOMATE_API_BASE}/upload-media`,
      headers: { ...form.getHeaders(), Authorization: basicAuth(config) },
      body: form,
      timeout: 300_000,
    });
    if (!response.data?.media_url) {
      throw new Error(
        `upload returned no media_url: ${JSON.stringify(response.data).slice(0, 300)}`,
      );
    }
    return response.data;
  } catch (error) {
    throw failure("Media upload failed", error);
  }
}

/** Change network conditions of a running App Automate session. */
export async function updateSessionNetwork(
  sessionId: string,
  body: { networkProfile: string },
  config: BrowserStackConfig,
): Promise<void> {
  try {
    await apiClient.put({
      url: `${APP_AUTOMATE_API_BASE}/sessions/${encodeURIComponent(sessionId)}/update_network.json`,
      headers: {
        Authorization: basicAuth(config),
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (error) {
    throw failure("Updating network conditions failed", error);
  }
}

/**
 * The account's private (dedicated) devices. Entries are returned as
 * BrowserStack sends them; an account without dedicated devices gets [].
 */
export async function listDedicatedDevices(
  config: BrowserStackConfig,
): Promise<Record<string, unknown>[]> {
  try {
    const response = await apiClient.get<Record<string, unknown>[]>({
      url: `${APP_AUTOMATE_API_BASE}/dedicated_devices.json`,
      headers: { Authorization: basicAuth(config) },
    });
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    throw failure("Listing dedicated devices failed", error);
  }
}
