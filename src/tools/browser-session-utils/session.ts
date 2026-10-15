import { remote } from "webdriverio";
import logger from "../../logger.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  AUTOMATE_HUB_HOSTNAME,
  AUTOMATE_SESSION_DASHBOARD_URL,
  COMMAND_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  HUB_PATH,
  SESSION_START_TIMEOUT_MS,
} from "../device-session-utils/constants.js";
import {
  AutomateBrowser,
  listAutomateBrowsers,
  setSessionStatus,
} from "../device-session-utils/rest.js";
import { ownerKey, scrubSecrets } from "../device-session-utils/secrets.js";
import {
  ensureLocalTunnel,
  localCapabilities,
} from "../device-session-utils/local-tunnel.js";
import { takeSessionStart } from "../device-session-utils/rate-limit.js";
import appConfig from "../../config.js";

/**
 * Agent-drivable web browser sessions on BrowserStack Automate,
 * over the Selenium/W3C hub with the user's own username:access_key.
 */

export interface BrowserSession {
  sessionId: string;
  owner: string;
  target: string;
  dashboardUrl: string;
  local: boolean;
  startedAt: number;
  lastActionAt: number;
  actionCount: number;
  browser: WebdriverIO.Browser;
}

const sessions = new Map<string, BrowserSession>();

export function browserSessionsOwnedBy(config: BrowserStackConfig) {
  const owner = ownerKey(config);
  return [...sessions.values()].filter((s) => s.owner === owner);
}

export function getOwnedBrowserSession(
  sessionId: string,
  config: BrowserStackConfig,
): BrowserSession {
  const s = sessions.get(sessionId);
  if (!s || s.owner !== ownerKey(config)) {
    const open = browserSessionsOwnedBy(config).map((x) => x.sessionId);
    throw new Error(
      `No active browser session "${sessionId}" in this MCP server.` +
        (open.length
          ? ` Open sessions: ${open.join(", ")}.`
          : " Start one with startBrowserSession."),
    );
  }
  return s;
}

export function forgetBrowserSession(sessionId: string) {
  sessions.delete(sessionId);
}

export interface BrowserStartArgs {
  browser: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  device?: string;
  url?: string;
  local?: boolean;
  resolution?: string;
  sessionName?: string;
  buildName?: string;
  projectName?: string;
  idleTimeoutSeconds?: number;
  video?: boolean;
  networkLogs?: boolean;
  consoleLogs?: boolean;
}

const VERSION_KEYWORDS = /^(latest|latest-\d+|beta|dev)$/i;

/**
 * Exact matching against the hub's own list. The only conveniences are
 * case-insensitivity, version keywords the hub itself accepts, and a bare
 * major ("120" for "120.0"). Anything else fails with the valid options.
 */
export function resolveBrowserTarget(
  all: AutomateBrowser[],
  args: BrowserStartArgs,
): {
  browserName: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  device?: string;
  label: string;
} {
  const eq = (a: unknown, b: string) =>
    String(a ?? "").toLowerCase() === b.trim().toLowerCase();
  const browserName = args.browser.trim().toLowerCase();

  if (args.device) {
    const onDevice = all.filter((b) => b.device && eq(b.device, args.device!));
    if (!onDevice.length) {
      throw new Error(
        `No real-device browser is listed for device "${args.device}". Use listBrowsers with deviceOnly to see devices.`,
      );
    }
    const withBrowser = onDevice.filter((b) => eq(b.browser, browserName));
    if (!withBrowser.length) {
      throw new Error(
        `${onDevice[0].device} has no "${args.browser}" browser. Available: ${[...new Set(onDevice.map((b) => b.browser))].join(", ")}.`,
      );
    }
    const versions = [...new Set(withBrowser.map((b) => b.os_version))];
    const osVersion = args.osVersion
      ? versions.find((v) => eq(v, args.osVersion!))
      : versions.sort((a, b) => parseFloat(b) - parseFloat(a))[0];
    if (!osVersion) {
      throw new Error(
        `${onDevice[0].device} has no OS version "${args.osVersion}". Available: ${versions.join(", ")}.`,
      );
    }
    return {
      browserName,
      device: onDevice[0].device!,
      osVersion,
      label: `${browserName} on ${onDevice[0].device} (${withBrowser[0].os} ${osVersion})`,
    };
  }

  if (!args.os || !args.osVersion) {
    throw new Error(
      "Give os and osVersion (e.g. 'Windows' + '11', 'OS X' + 'Sonoma') for a desktop browser, or device for a mobile one.",
    );
  }
  const onOs = all.filter(
    (b) => !b.device && eq(b.os, args.os!) && eq(b.os_version, args.osVersion!),
  );
  if (!onOs.length) {
    const versions = [
      ...new Set(
        all
          .filter((b) => !b.device && eq(b.os, args.os!))
          .map((b) => b.os_version),
      ),
    ];
    throw new Error(
      versions.length
        ? `No desktop "${args.os} ${args.osVersion}". ${args.os} versions: ${versions.join(", ")}.`
        : `Unknown OS "${args.os}". Desktop OSes: ${[...new Set(all.filter((b) => !b.device).map((b) => b.os))].join(", ")}.`,
    );
  }
  const withBrowser = onOs.filter((b) => eq(b.browser, browserName));
  if (!withBrowser.length) {
    throw new Error(
      `${args.os} ${args.osVersion} has no "${args.browser}". Available: ${[...new Set(onOs.map((b) => b.browser))].join(", ")}.`,
    );
  }
  const requested = args.browserVersion?.trim() || "latest";
  let browserVersion: string | undefined;
  if (VERSION_KEYWORDS.test(requested)) {
    browserVersion = requested.toLowerCase();
  } else {
    const listed = withBrowser.map((b) => String(b.browser_version));
    browserVersion =
      listed.find((v) => eq(v, requested)) ??
      (/^\d+$/.test(requested)
        ? listed.find((v) => v === `${requested}.0`)
        : undefined);
    if (!browserVersion) {
      const recent = listed
        .filter((v) => !/beta|dev/i.test(v))
        .sort((a, b) => parseFloat(b) - parseFloat(a))
        .slice(0, 12);
      throw new Error(
        `${args.browser} ${requested} is not available on ${args.os} ${args.osVersion}. Recent versions: ${recent.join(", ")} (or 'latest', 'latest-1', 'beta').`,
      );
    }
  }
  return {
    browserName,
    browserVersion,
    os: onOs[0].os,
    osVersion: onOs[0].os_version,
    label: `${browserName} ${browserVersion} on ${onOs[0].os} ${onOs[0].os_version}`,
  };
}

export function buildBrowserCapabilities(
  args: BrowserStartArgs,
  t: ReturnType<typeof resolveBrowserTarget>,
  local?: Record<string, unknown>,
): Record<string, unknown> {
  const bstack: Record<string, unknown> = {
    projectName: args.projectName || "BrowserStack MCP",
    buildName: args.buildName || "MCP browser sessions",
    sessionName: (args.sessionName || "MCP agent session").slice(0, 255),
    idleTimeout: args.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
    video: args.video ?? true,
    source: "browserstack-mcp",
  };
  if (t.device) {
    bstack.deviceName = t.device;
    bstack.osVersion = t.osVersion;
    bstack.realMobile = "true";
  } else {
    bstack.os = t.os;
    bstack.osVersion = t.osVersion;
    if (args.resolution) bstack.resolution = args.resolution;
  }
  if (args.networkLogs) bstack.networkLogs = true;
  if (args.consoleLogs) bstack.consoleLogs = "info";
  if (local) Object.assign(bstack, local);
  const caps: Record<string, unknown> = {
    browserName: t.browserName,
    "bstack:options": bstack,
  };
  if (t.browserVersion) caps.browserVersion = t.browserVersion;
  return caps;
}

export async function startBrowserSession(
  args: BrowserStartArgs,
  config: BrowserStackConfig,
  maxConcurrent: number,
): Promise<{ session: BrowserSession; label: string }> {
  const open = browserSessionsOwnedBy(config);
  if (open.length >= maxConcurrent) {
    throw new Error(
      `This MCP server already holds ${open.length} browser session(s); the limit is ${maxConcurrent}. End one with endBrowserSession first.`,
    );
  }
  takeSessionStart(
    config["browserstack-username"],
    appConfig.SESSION_STARTS_PER_HOUR,
  );
  const target = resolveBrowserTarget(await listAutomateBrowsers(config), args);
  const local = args.local
    ? localCapabilities(await ensureLocalTunnel(config))
    : undefined;
  const capabilities = buildBrowserCapabilities(args, target, local);
  logger.info("Starting browser session: %s", target.label);

  let browser: WebdriverIO.Browser;
  try {
    browser = await remote({
      protocol: "https",
      hostname: AUTOMATE_HUB_HOSTNAME,
      port: 443,
      path: HUB_PATH,
      user: config["browserstack-username"],
      key: config["browserstack-access-key"],
      capabilities: capabilities as WebdriverIO.Capabilities,
      logLevel: "silent",
      connectionRetryTimeout: SESSION_START_TIMEOUT_MS,
      connectionRetryCount: 0,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `BrowserStack could not start the browser session: ${scrubSecrets(msg, config).split("\n")[0]}`,
    );
  }
  try {
    (browser as any).options.connectionRetryTimeout = COMMAND_TIMEOUT_MS;
  } catch {
    // Non-fatal.
  }
  const now = Date.now();
  const session: BrowserSession = {
    sessionId: browser.sessionId,
    owner: ownerKey(config),
    target: target.label,
    dashboardUrl: AUTOMATE_SESSION_DASHBOARD_URL(browser.sessionId),
    local: !!args.local,
    startedAt: now,
    lastActionAt: now,
    actionCount: 0,
    browser,
  };
  sessions.set(session.sessionId, session);
  if (args.url) {
    try {
      await browser.url(args.url);
    } catch (error) {
      logger.debug("initial navigation failed: %s", error);
    }
  }
  return { session, label: target.label };
}

export async function endBrowserSession(
  sessionId: string,
  config: BrowserStackConfig,
  status?: { status: "passed" | "failed"; reason?: string },
): Promise<{ statusError?: string }> {
  const session = getOwnedBrowserSession(sessionId, config);
  sessions.delete(sessionId);
  let statusError: string | undefined;
  if (status) {
    try {
      await setSessionStatus(
        sessionId,
        status.status,
        status.reason || "",
        config,
        "automate",
      );
    } catch (error) {
      statusError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    await session.browser.deleteSession();
  } catch (error) {
    logger.debug("deleteSession after browser session end: %s", error);
  }
  return { statusError };
}

export function __registerBrowserSessionForTests(s: BrowserSession) {
  sessions.set(s.sessionId, s);
}
export function __clearBrowserSessionsForTests() {
  sessions.clear();
}
