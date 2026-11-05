import logger from "../../logger.js";
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
  const note = entry.notes ? `, ${entry.notes}` : "";

  if (!envConfig.REMOTE_MCP) {
    const openCommand = getOpenBrowserCommand(url);
    if (openCommand) {
      return [
        `Live session URL: ${url}${note}`,
        ``,
        `To open the session in the default browser, run:`,
        `    ${openCommand}`,
      ].join("\n");
    }
  }

  return `${url}${note}`;
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
    ...(isLocal ? {} : { start: "true" }),
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
    ...(isLocal ? {} : { start: "true" }),
  });
  return `https://live.browserstack.com/dashboard#${params.toString()}`;
}

// ——— Build a browser-open command for the host agent ———

/**
 * Returns the platform-appropriate shell command to open `launchUrl` in the
 * default browser, or null if the URL is not a trusted BrowserStack URL.
 *
 * The command is returned to the MCP client so the host agent can prompt the
 * user before executing it. The server itself never spawns a process, which
 * eliminates the command-injection surface entirely.
 */
function getOpenBrowserCommand(launchUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(launchUrl);
  } catch {
    logger.error(`Refusing to surface malformed URL: ${launchUrl}`);
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    !/(^|\.)browserstack\.com$/i.test(parsed.hostname)
  ) {
    logger.error(`Refusing to surface untrusted URL: ${launchUrl}`);
    return null;
  }

  const quoted = `"${parsed.toString()}"`;
  if (process.platform === "darwin") return `open ${quoted}`;
  if (process.platform === "win32") return `cmd /c start "" ${quoted}`;
  return `xdg-open ${quoted}`;
}
