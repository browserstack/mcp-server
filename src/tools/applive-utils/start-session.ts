import logger from "../../logger.js";
import childProcess from "child_process";
import {
  getDevicesAndBrowsers,
  BrowserStackProducts,
} from "../../lib/device-cache.js";
import { sanitizeUrlParam } from "../../lib/utils.js";
import { uploadApp } from "./upload-app.js";
import { findDeviceByName } from "./device-search.js";
import { pickVersion } from "./version-utils.js";
import { DeviceEntry } from "./types.js";

interface StartSessionArgs {
  appPath: string;
  desiredPlatform: "android" | "ios";
  desiredPhone: string;
  desiredPlatformVersion: string;
}

/**
 * Start an App Live session: filter, select, upload, and open.
 */
export async function startSession(args: StartSessionArgs): Promise<string> {
  const { appPath, desiredPlatform, desiredPhone, desiredPlatformVersion } =
    args;

  // 1) Fetch devices for APP_LIVE
  const data = await getDevicesAndBrowsers(BrowserStackProducts.APP_LIVE);
  const all: DeviceEntry[] = data.mobile.flatMap((grp: any) =>
    grp.devices.map((dev: any) => ({ ...dev, os: grp.os })),
  );

  // 2) Filter by OS
  const osMatches = all.filter((d) => d.os === desiredPlatform);
  if (!osMatches.length) {
    throw new Error(`No devices for OS "${desiredPlatform}"`);
  }

  // 3) Select by name
  const nameMatches = findDeviceByName(osMatches, desiredPhone);

  // 4) Resolve version
  const versions = [...new Set(nameMatches.map((d) => d.os_version))];
  const version = pickVersion(versions, desiredPlatformVersion);

  // 5) Final candidates for version
  const final = nameMatches.filter((d) => d.os_version === version);
  if (!final.length) {
    throw new Error(
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

  // 6) Upload app
  const { app_url } = await uploadApp(appPath);
  logger.info(`App uploaded: ${app_url}`);

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

  openBrowser(launchUrl);
  return launchUrl + note;
}

/**
 * Opens the launch URL in the default browser.
 * @param launchUrl - The URL to open.
 * @throws Will throw an error if the browser fails to open.
 */
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

    child.on("error", (error) => {
      logger.error(
        `Failed to open browser automatically: ${error}. Please open this URL manually: ${launchUrl}`,
      );
    });

    child.unref();
  } catch (error) {
    logger.error(
      `Failed to open browser automatically: ${error}. Please open this URL manually: ${launchUrl}`,
    );
  }
}
