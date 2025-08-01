import logger from "../../logger.js";
import childProcess from "child_process";
import { filterDesktop } from "./desktop-filter.js";
import { filterMobile } from "./mobile-filter.js";
import {
  DesktopSearchArgs,
  MobileSearchArgs,
  DesktopEntry,
  MobileEntry,
  PlatformType,
} from "./types.js";
import {
  isLocalURL,
  ensureLocalBinarySetup,
  killExistingBrowserStackLocalProcesses,
} from "../../lib/local.js";

import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import envConfig from "../../config.js";

/**
 * Prepares local tunnel setup based on URL type
 */
async function prepareLocalTunnel(
  url: string,
  username: string,
  password: string,
): Promise<boolean> {
  const isLocal = isLocalURL(url);
  if (isLocal && envConfig.REMOTE_MCP) {
    throw new Error(
      "Local URLs are not supported in this remote mcp. Please use a public URL.",
    );
  }
  if (isLocal) {
    await ensureLocalBinarySetup(username, password);
  } else {
    await killExistingBrowserStackLocalProcesses();
  }
  return isLocal;
}

/**
 * Entrypoint: detects platformType & delegates.
 */
export async function startBrowserSession(
  args: DesktopSearchArgs | MobileSearchArgs,
  config: BrowserStackConfig,
): Promise<string> {
  const entry =
    args.platformType === PlatformType.DESKTOP
      ? await filterDesktop(args as DesktopSearchArgs)
      : await filterMobile(args as MobileSearchArgs);

  // Get credentials from config
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");

  if (!username || !password) {
    throw new Error(
      "BrowserStack credentials are not set. Please configure them in the server settings.",
    );
  }

  const isLocal = await prepareLocalTunnel(args.url, username, password);

  const url =
    args.platformType === PlatformType.DESKTOP
      ? buildDesktopUrl(
          args as DesktopSearchArgs,
          entry as DesktopEntry,
          isLocal,
        )
      : buildMobileUrl(args as MobileSearchArgs, entry as MobileEntry, isLocal);
  if (!envConfig.REMOTE_MCP) {
    openBrowser(url);
  }
  return entry.notes ? `${url}, ${entry.notes}` : url;
}

function buildDesktopUrl(
  args: DesktopSearchArgs,
  e: DesktopEntry,
  isLocal: boolean,
): string {
  const params = new URLSearchParams({
    os: e.os,
    os_version: e.os_version,
    browser: e.browser,
    browser_version: e.browser_version,
    url: args.url,
    scale_to_fit: "true",
    resolution: "responsive-mode",
    speed: "1",
    local: isLocal ? "true" : "false",
    start: "true",
  });
  return `https://live.browserstack.com/dashboard#${params.toString()}`;
}

function buildMobileUrl(
  args: MobileSearchArgs,
  d: MobileEntry,
  isLocal: boolean,
): string {
  const os_map = {
    android: "Android",
    ios: "iOS",
    winphone: "Winphone",
  };
  const os = os_map[d.os as keyof typeof os_map] || d.os;

  const params = new URLSearchParams({
    os: os,
    os_version: d.os_version,
    device: d.display_name,
    device_browser: args.browser,
    url: args.url,
    scale_to_fit: "true",
    speed: "1",
    local: isLocal ? "true" : "false",
    start: "true",
  });
  return `https://live.browserstack.com/dashboard#${params.toString()}`;
}

// ——— Open a browser window ———

function openBrowser(launchUrl: string): void {
  try {
    const command =
      process.platform === "darwin"
        ? ["open", launchUrl]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", launchUrl]
          : ["xdg-open", launchUrl];

    // nosemgrep:javascript.lang.security.detect-child-process.detect-child-process
    const child = childProcess.spawn(command[0], command.slice(1), {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) =>
      logger.error(`Failed to open browser: ${err}. URL: ${launchUrl}`),
    );
    child.unref();
  } catch (err) {
    logger.error(`Failed to launch browser: ${err}. URL: ${launchUrl}`);
  }
}
