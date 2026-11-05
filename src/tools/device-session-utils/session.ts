import { remote } from "webdriverio";
import logger from "../../logger.js";
import { customFuzzySearch } from "../../lib/fuzzy.js";
import { resolveVersion } from "../../lib/version-resolver.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  COMMAND_TIMEOUT_MS,
  DEFAULT_APPIUM_VERSION,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DEFAULT_NEW_COMMAND_TIMEOUT_SECONDS,
  HUB_HOSTNAME,
  HUB_PATH,
  SESSION_DASHBOARD_URL,
  SESSION_START_TIMEOUT_MS,
} from "./constants.js";
import {
  AppAutomateDevice,
  listAppAutomateDevices,
  setSessionStatus,
  uploadMobileApp,
} from "./rest.js";
import { ownerKey, scrubSecrets } from "./secrets.js";
import { ensureLocalTunnel, localCapabilities } from "./local-tunnel.js";
import { takeSessionStart } from "./rate-limit.js";
import appConfig from "../../config.js";

export type Platform = "android" | "ios";
export type DeviceBrowser = WebdriverIO.Browser;

export interface DeviceSession {
  sessionId: string;
  /** ownerKey() of the credentials that opened the session; only they may drive it. */
  owner: string;
  platform: Platform;
  device: string;
  osVersion: string;
  appUrl: string;
  /** Package (Android) or bundle id (iOS) of the app under test, when known. */
  appId?: string;
  dashboardUrl: string;
  startedAt: number;
  lastActionAt: number;
  actionCount: number;
  /** iOS pixels-per-point, resolved on first screenshot. */
  iosScale?: number;
  browser: DeviceBrowser;
}

const sessions = new Map<string, DeviceSession>();

export function sessionsOwnedBy(config: BrowserStackConfig): DeviceSession[] {
  const owner = ownerKey(config);
  return [...sessions.values()].filter((s) => s.owner === owner);
}

/**
 * Look up a live session for this caller. A session another BrowserStack
 * user opened is reported as not found, so a shared (remote) process never
 * lets one tenant drive another tenant's device.
 */
export function getOwnedSession(
  sessionId: string,
  config: BrowserStackConfig,
): DeviceSession {
  const session = sessions.get(sessionId);
  if (!session || session.owner !== ownerKey(config)) {
    const open = sessionsOwnedBy(config).map((s) => s.sessionId);
    throw new Error(
      `No active device session "${sessionId}" in this MCP server.` +
        (open.length
          ? ` Open sessions: ${open.join(", ")}.`
          : " Start one with startDeviceSession."),
    );
  }
  return session;
}

export interface StartArgs {
  platform: Platform;
  device: string;
  osVersion?: string;
  app?: string;
  appPath?: string;
  appDownloadUrl?: string;
  sessionName?: string;
  buildName?: string;
  projectName?: string;
  idleTimeoutSeconds?: number;
  interactiveDebugging?: boolean;
  video?: boolean;
  networkLogs?: boolean;
  language?: string;
  locale?: string;
  timezone?: string;
  gpsLocation?: string;
  appiumVersion?: string;
  /** Route the device's traffic through BrowserStack Local. */
  local?: boolean;
  /** Instrument the app so simulateBiometric works. */
  enableBiometric?: boolean;
  /** Instrument the app so injectCameraImage works. */
  enableCameraImageInjection?: boolean;
  /** media:// files (from uploadMediaFile) to preload on the device. */
  uploadMedia?: string[];
  /** Network profile at start, e.g. "3g-umts-good". */
  networkProfile?: string;
  /** Device tunnel for a local framework MCP (private dedicated devices only). */
  deviceTunnel?: boolean;
}

export function resolveDevice(
  devices: AppAutomateDevice[],
  platform: Platform,
  deviceName: string,
  osVersion: string | undefined,
): { device: string; osVersion: string } {
  const onPlatform = devices.filter((d) => d.os?.toLowerCase() === platform);
  if (!onPlatform.length) {
    throw new Error(`No ${platform} devices are available on this account.`);
  }
  // Exact names only: picking among similar devices is the agent's (or the
  // user's) decision, so near misses come back as suggestions.
  const named = onPlatform.filter(
    (d) => d.device.toLowerCase() === deviceName.trim().toLowerCase(),
  );
  if (!named.length) {
    const near = [
      ...new Set(
        customFuzzySearch(onPlatform, ["device"], deviceName, 8).map(
          (d) => d.device,
        ),
      ),
    ];
    throw new Error(
      `No ${platform} device is named "${deviceName}".` +
        (near.length ? ` Similar: ${near.join(", ")}.` : "") +
        " Use listMobileDevices for exact names.",
    );
  }
  const versions = [...new Set(named.map((d) => d.os_version))];
  const requested = osVersion?.trim() || "latest";
  let picked: string | undefined;
  if (requested === "latest" || requested === "oldest") {
    picked = resolveVersion(requested, versions);
  } else {
    // Exact, or a bare major ("14" for "14.0"). No nearest-version substitution.
    picked =
      versions.find((v) => v.toLowerCase() === requested.toLowerCase()) ??
      versions.find(
        (v) =>
          /^\d+$/.test(requested) &&
          (v === `${requested}.0` || v.split(".")[0] === requested) &&
          !/beta/i.test(v),
      );
  }
  if (!picked) {
    throw new Error(
      `${named[0].device} has no OS version "${requested}". Available: ${versions.join(", ")}.`,
    );
  }
  return { device: named[0].device, osVersion: picked };
}

export function buildCapabilities(
  args: StartArgs,
  resolved: { device: string; osVersion: string },
  appUrl: string,
  local?: Record<string, unknown>,
): Record<string, unknown> {
  // Credentials are deliberately NOT in bstack:options: the hub gets them as
  // a Basic auth header (webdriverio user/key), so they never appear in the
  // capabilities a server error might echo back.
  const bstack: Record<string, unknown> = {
    deviceName: resolved.device,
    osVersion: resolved.osVersion,
    projectName: args.projectName || "BrowserStack MCP",
    buildName: args.buildName || "MCP device sessions",
    sessionName: (args.sessionName || "MCP agent session").slice(0, 255),
    appiumVersion: args.appiumVersion || DEFAULT_APPIUM_VERSION,
    idleTimeout: args.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
    interactiveDebugging: args.interactiveDebugging ?? true,
    video: args.video ?? true,
    source: "browserstack-mcp",
  };
  if (args.networkLogs) bstack.networkLogs = true;
  if (args.timezone) bstack.timezone = args.timezone;
  if (args.gpsLocation) bstack.gpsLocation = args.gpsLocation;
  if (args.enableBiometric) bstack.enableBiometric = true;
  if (args.enableCameraImageInjection) bstack.enableCameraImageInjection = true;
  if (args.uploadMedia?.length) bstack.uploadMedia = args.uploadMedia;
  if (args.networkProfile) bstack.networkProfile = args.networkProfile;
  if (args.deviceTunnel) bstack.deviceTunnel = true;
  if (local) Object.assign(bstack, local);

  const caps: Record<string, unknown> = {
    platformName: args.platform,
    "appium:automationName":
      args.platform === "ios" ? "XCUITest" : "UiAutomator2",
    "appium:app": appUrl,
    "appium:newCommandTimeout": DEFAULT_NEW_COMMAND_TIMEOUT_SECONDS,
    "bstack:options": bstack,
  };
  if (args.platform === "android") {
    caps["appium:autoGrantPermissions"] = true;
  } else {
    // The agent sees and handles system dialogs itself.
    caps["appium:autoAcceptAlerts"] = false;
  }
  if (args.language) caps["appium:language"] = args.language;
  if (args.locale) caps["appium:locale"] = args.locale;
  return caps;
}

async function resolveApp(
  args: StartArgs,
  config: BrowserStackConfig,
): Promise<string> {
  const given = [args.app, args.appPath, args.appDownloadUrl].filter(Boolean);
  if (given.length !== 1) {
    throw new Error(
      "Provide exactly one of app (a bs:// url or custom_id from uploadMobileApp), appPath, or appDownloadUrl.",
    );
  }
  if (args.app) return args.app.trim();
  const uploaded = await uploadMobileApp(
    {
      filePath: args.appPath,
      url: args.appDownloadUrl,
    },
    config,
  );
  return uploaded.app_url;
}

function appIdFromCapabilities(
  caps: any,
  platform: Platform,
): string | undefined {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = caps?.[k];
      if (typeof v === "string" && v) return v;
    }
    return undefined;
  };
  return platform === "ios"
    ? pick("bundleId", "appium:bundleId", "CFBundleIdentifier")
    : pick("appPackage", "appium:appPackage");
}

export async function startDeviceSession(
  args: StartArgs,
  config: BrowserStackConfig,
  maxConcurrent: number,
): Promise<{ session: DeviceSession; notes: string[] }> {
  const open = sessionsOwnedBy(config);
  if (open.length >= maxConcurrent) {
    throw new Error(
      `This MCP server already holds ${open.length} device session(s) (${open
        .map((s) => s.sessionId)
        .join(
          ", ",
        )}); the limit is ${maxConcurrent}. End one with endDeviceSession first.`,
    );
  }

  takeSessionStart(
    config["browserstack-username"],
    appConfig.SESSION_STARTS_PER_HOUR,
  );
  const devices = await listAppAutomateDevices(config);
  const resolved = resolveDevice(
    devices,
    args.platform,
    args.device,
    args.osVersion,
  );
  const appUrl = await resolveApp(args, config);
  const local = args.local
    ? localCapabilities(await ensureLocalTunnel(config))
    : undefined;
  const capabilities = buildCapabilities(args, resolved, appUrl, local);

  logger.info(
    "Starting device session on %s (%s %s)",
    resolved.device,
    args.platform,
    resolved.osVersion,
  );

  let browser: DeviceBrowser;
  try {
    browser = await remote({
      protocol: "https",
      hostname: HUB_HOSTNAME,
      port: 443,
      path: HUB_PATH,
      user: config["browserstack-username"],
      key: config["browserstack-access-key"],
      capabilities: capabilities as WebdriverIO.Capabilities,
      // stdout is the MCP stdio channel: webdriverio must never write to it.
      logLevel: "silent",
      connectionRetryTimeout: SESSION_START_TIMEOUT_MS,
      connectionRetryCount: 0,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `BrowserStack could not start the session: ${scrubSecrets(msg, config).split("\n")[0]}`,
    );
  }

  // Later commands should not wait as long as session creation may.
  try {
    (browser as any).options.connectionRetryTimeout = COMMAND_TIMEOUT_MS;
  } catch {
    // Non-fatal: the start timeout simply stays in effect.
  }

  const sessionId = browser.sessionId;
  const now = Date.now();
  const session: DeviceSession = {
    sessionId,
    owner: ownerKey(config),
    platform: args.platform,
    device: resolved.device,
    osVersion: resolved.osVersion,
    appUrl,
    appId: appIdFromCapabilities(browser.capabilities, args.platform),
    dashboardUrl: SESSION_DASHBOARD_URL(sessionId),
    startedAt: now,
    lastActionAt: now,
    actionCount: 0,
    browser,
  };
  sessions.set(sessionId, session);
  return { session, notes: [] };
}

export async function endDeviceSession(
  sessionId: string,
  config: BrowserStackConfig,
  status?: { status: "passed" | "failed"; reason?: string },
): Promise<{ statusError?: string }> {
  const session = getOwnedSession(sessionId, config);
  sessions.delete(sessionId);
  let statusError: string | undefined;
  if (status) {
    try {
      await setSessionStatus(
        sessionId,
        status.status,
        status.reason || "",
        config,
      );
    } catch (error) {
      statusError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    await session.browser.deleteSession();
  } catch (error) {
    // Already gone (idle timeout, closed from the dashboard): nothing to release.
    logger.debug("deleteSession after session end: %s", error);
  }
  return { statusError };
}

/** Forget a session BrowserStack has already ended, so it stops counting toward the limit. */
export function forgetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Test seam: register a session without going through the hub. */
export function __registerSessionForTests(session: DeviceSession): void {
  sessions.set(session.sessionId, session);
}

export function __clearSessionsForTests(): void {
  sessions.clear();
}
