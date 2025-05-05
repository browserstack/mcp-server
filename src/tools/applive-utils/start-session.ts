import childProcess from "child_process";
import logger from "../../logger";
import { getAppLiveData } from "./device-cache";
import { fuzzySearchDevices } from "./fuzzy-search";
import { sanitizeUrlParam } from "../../lib/utils";
import { uploadApp } from "./upload-app";

export interface DeviceEntry {
  device: string;
  display_name: string;
  os: string;
  os_version: string;
  real_mobile: boolean;
}

interface StartSessionArgs {
  appPath: string;
  desiredPlatform: "android" | "ios";
  desiredPhone: string;
  desiredPlatformVersion: string;
}

/**
 * Starts an App Live session after filtering, fuzzy matching, and launching.
 * @param args - The arguments for starting the session.
 * @returns The launch URL for the session.
 * @throws Will throw an error if no devices are found or if the app URL is invalid.
 */
export async function startSession(args: StartSessionArgs): Promise<string> {
  const { appPath, desiredPlatform, desiredPhone } = args;
  let { desiredPlatformVersion } = args;

  const data = await getAppLiveData();
  const allDevices: DeviceEntry[] = data.mobile.flatMap((group: any) =>
    group.devices.map((dev: any) => ({ ...dev, os: group.os })),
  );

  desiredPlatformVersion = resolvePlatformVersion(
    allDevices,
    desiredPlatform,
    desiredPlatformVersion,
  );

  const filteredDevices = filterDevicesByPlatformAndVersion(
    allDevices,
    desiredPlatform,
    desiredPlatformVersion,
  );

  const matches = await fuzzySearchDevices(filteredDevices, desiredPhone);

  const selectedDevice = validateAndSelectDevice(
    matches,
    desiredPhone,
    desiredPlatform,
    desiredPlatformVersion,
  );

  const { app_url } = await uploadApp(appPath);

  validateAppUrl(app_url);

  const launchUrl = constructLaunchUrl(
    app_url,
    selectedDevice,
    desiredPlatform,
    desiredPlatformVersion,
  );

  openBrowser(launchUrl);

  return launchUrl;
}

/**
 * Resolves the platform version based on the desired platform and version.
 * @param allDevices - The list of all devices.
 * @param desiredPlatform - The desired platform (android or ios).
 * @param desiredPlatformVersion - The desired platform version.
 * @returns The resolved platform version.
 * @throws Will throw an error if the platform version is not valid.
 */
function resolvePlatformVersion(
  allDevices: DeviceEntry[],
  desiredPlatform: string,
  desiredPlatformVersion: string,
): string {
  if (
    desiredPlatformVersion === "latest" ||
    desiredPlatformVersion === "oldest"
  ) {
    const filtered = allDevices.filter((d) => d.os === desiredPlatform);
    filtered.sort((a, b) => {
      const versionA = parseFloat(a.os_version);
      const versionB = parseFloat(b.os_version);
      return desiredPlatformVersion === "latest"
        ? versionB - versionA
        : versionA - versionB;
    });

    return filtered[0].os_version;
  }
  return desiredPlatformVersion;
}

/**
 * Filters devices based on the desired platform and version.
 * @param allDevices - The list of all devices.
 * @param desiredPlatform - The desired platform (android or ios).
 * @param desiredPlatformVersion - The desired platform version.
 * @returns The filtered list of devices.
 * @throws Will throw an error if the platform version is not valid.
 */
function filterDevicesByPlatformAndVersion(
  allDevices: DeviceEntry[],
  desiredPlatform: string,
  desiredPlatformVersion: string,
): DeviceEntry[] {
  return allDevices.filter((d) => {
    if (d.os !== desiredPlatform) return false;

    try {
      const versionA = parseFloat(d.os_version);
      const versionB = parseFloat(desiredPlatformVersion);
      return versionA === versionB;
    } catch {
      return d.os_version === desiredPlatformVersion;
    }
  });
}

/**
 * Validates the selected device and handles multiple matches.
 * @param matches - The list of device matches.
 * @param desiredPhone - The desired phone name.
 * @param desiredPlatform - The desired platform (android or ios).
 * @param desiredPlatformVersion - The desired platform version.
 * @returns The selected device entry.
 */
function validateAndSelectDevice(
  matches: DeviceEntry[],
  desiredPhone: string,
  desiredPlatform: string,
  desiredPlatformVersion: string,
): DeviceEntry {
  if (matches.length === 0) {
    throw new Error(
      `No devices found matching "${desiredPhone}" for ${desiredPlatform} ${desiredPlatformVersion}`,
    );
  }

  const exactMatch = matches.find(
    (d) => d.display_name.toLowerCase() === desiredPhone.toLowerCase(),
  );

  if (exactMatch) {
    return exactMatch;
  } else if (matches.length >= 1) {
    const names = matches.map((d) => d.display_name).join(", ");
    const error_message =
      matches.length === 1
        ? `Alternative device found: ${names}. Would you like to use it?`
        : `Multiple devices found: ${names}. Please select one.`;
    throw new Error(`${error_message}`);
  }

  return matches[0];
}

/**
 * Validates the app URL.
 * @param appUrl - The app URL to validate.
 * @throws Will throw an error if the app URL is not valid.
 */
function validateAppUrl(appUrl: string): void {
  if (!appUrl.match("bs://")) {
    throw new Error("The app path is not a valid BrowserStack app URL.");
  }
}

/**
 * Constructs the launch URL for the App Live session.
 * @param appUrl - The app URL.
 * @param device - The selected device entry.
 * @param desiredPlatform - The desired platform (android or ios).
 * @param desiredPlatformVersion - The desired platform version.
 * @returns The constructed launch URL.
 */
function constructLaunchUrl(
  appUrl: string,
  device: DeviceEntry,
  desiredPlatform: string,
  desiredPlatformVersion: string,
): string {
  const deviceParam = sanitizeUrlParam(
    device.display_name.replace(/\s+/g, "+"),
  );

  const params = new URLSearchParams({
    os: desiredPlatform,
    os_version: desiredPlatformVersion,
    app_hashed_id: appUrl.split("bs://").pop() || "",
    scale_to_fit: "true",
    speed: "1",
    start: "true",
  });

  return `https://app-live.browserstack.com/dashboard#${params.toString()}&device=${deviceParam}`;
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
