import logger from "../../logger.js";
import {
  getDevicesAndBrowsers,
  BrowserStackProducts,
} from "../../lib/device-cache.js";
import { sanitizeUrlParam } from "../../lib/utils.js";
import { uploadApp } from "./upload-app.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { findDeviceByName } from "./device-search.js";
import { pickVersion } from "./version-utils.js";
import { DeviceEntry } from "./types.js";
import { BrowserStackConfig } from "../../lib/types.js";
import envConfig from "../../config.js";
import { CallerError } from "../../lib/error.js";

interface StartSessionArgs {
  appPath?: string;
  desiredPlatform: "android" | "ios";
  desiredPhone: string;
  desiredPlatformVersion: string;
  browserstackAppUrl?: string;
}

interface StartSessionOptions {
  config: BrowserStackConfig;
}

/**
 * Start an App Live session: filter, select, upload, and open.
 */
export async function startSession(
  args: StartSessionArgs,
  options: StartSessionOptions,
): Promise<string> {
  const {
    appPath,
    desiredPlatform,
    desiredPhone,
    desiredPlatformVersion,
    browserstackAppUrl,
  } = args;
  const { config } = options;

  // 1) Fetch devices for APP_LIVE
  const data = await getDevicesAndBrowsers(BrowserStackProducts.APP_LIVE);
  const all: DeviceEntry[] = data.mobile.flatMap((grp: any) =>
    grp.devices.map((dev: any) => ({ ...dev, os: grp.os })),
  );

  // 2) Filter by OS
  const osMatches = all.filter((d) => d.os === desiredPlatform);
  if (!osMatches.length) {
    throw new CallerError(`No devices for OS "${desiredPlatform}"`);
  }

  // 3) Select by name
  const nameMatches = findDeviceByName(osMatches, desiredPhone);

  // 4) Resolve version
  const versions = [...new Set(nameMatches.map((d) => d.os_version))];
  const version = pickVersion(versions, desiredPlatformVersion);

  // 5) Final candidates for version
  const final = nameMatches.filter((d) => d.os_version === version);
  if (!final.length) {
    throw new CallerError(
      `No devices for version "${version}" on ${desiredPlatform}`,
    );
  }
  const selected = final[0];
  let note = "";
  if (
    version != desiredPlatformVersion &&
    desiredPlatformVersion !== "latest" &&
    desiredPlatformVersion !== "oldest"
  ) {
    note = `\n Note: The requested version "${desiredPlatformVersion}" is not available. Using "${version}" instead.`;
  }

  // 6) Upload app or use provided URL
  let app_url: string;
  if (browserstackAppUrl) {
    app_url = browserstackAppUrl;
    logger.info(`Using provided BrowserStack app URL: ${app_url}`);
  } else {
    if (!appPath) {
      throw new CallerError(
        "appPath is required when browserstackAppUrl is not provided",
      );
    }
    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");
    const result = await uploadApp(appPath, username, password);
    app_url = result.app_url;
    logger.info(`App uploaded: ${app_url}`);
  }

  if (!app_url) {
    throw new Error("Failed to upload app. Please try again.");
  }

  // 7) Build URL & open
  const deviceParam = sanitizeUrlParam(
    selected.display_name.replace(/\s+/g, "+"),
  );
  const params = new URLSearchParams({
    os: desiredPlatform,
    os_version: version,
    app_hashed_id: app_url.split("bs://").pop() || "",
    scale_to_fit: "true",
    speed: "1",
    start: "true",
  });
  const launchUrl = `https://app-live.browserstack.com/dashboard#${params.toString()}&device=${deviceParam}`;

  if (!envConfig.REMOTE_MCP) {
    const openCommand = getOpenBrowserCommand(launchUrl);
    if (openCommand) {
      return [
        `App Live session URL: ${launchUrl}${note}`,
        ``,
        `To open the session in the default browser, run:`,
        `    ${openCommand}`,
      ].join("\n");
    }
  }

  return launchUrl + note;
}

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
