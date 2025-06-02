import fs from "fs";
import axios from "axios";
import config from "../../config.js";
import FormData from "form-data";
import { customFuzzySearch } from "../../lib/fuzzy.js";

interface Device {
  device: string;
  display_name: string;
  os_version: string;
  real_mobile: boolean;
}

interface UploadResponse {
  app_url: string;
  custom_id?: string;
  shareable_id?: string;
}

/**
 * Finds devices that exactly match the provided display name.
 * Uses fuzzy search first, and then filters for exact case-insensitive match.
 */
export function findMatchingDevice(
  devices: Device[],
  deviceName: string,
): Device[] {
  const matches = customFuzzySearch(devices, ["display_name"], deviceName, 5);

  if (matches.length === 0) {
    const availableDevices = [
      ...new Set(devices.map((d) => d.display_name)),
    ].join(", ");
    throw new Error(
      `No devices found matching "${deviceName}". Available devices: ${availableDevices}`,
    );
  }

  const exactMatches = matches.filter(
    (m) => m.display_name.toLowerCase() === deviceName.toLowerCase(),
  );

  if (exactMatches.length === 0) {
    const suggestions = [...new Set(matches.map((d) => d.display_name))].join(
      ", ",
    );
    throw new Error(
      `Alternative devices found: ${suggestions}. Please select one of these exact device names.`,
    );
  }
  return exactMatches;
}

/**
 * Extracts all unique OS versions from a device list and sorts them.
 */
export function getDeviceVersions(devices: Device[]): string[] {
  return [...new Set(devices.map((d) => d.os_version))].sort();
}

/**
 * Resolves the requested platform version against available versions.
 * Supports 'latest' and 'oldest' as dynamic selectors.
 */
export function resolveVersion(
  versions: string[],
  requestedVersion: string,
): string {
  if (requestedVersion === "latest") {
    return versions[versions.length - 1];
  }

  if (requestedVersion === "oldest") {
    return versions[0];
  }

  const match = versions.find((v) => v === requestedVersion);
  if (!match) {
    throw new Error(
      `Version "${requestedVersion}" not found. Available versions: ${versions.join(", ")}`,
    );
  }
  return match;
}

/**
 * Validates the input arguments for taking app screenshots.
 * Checks for presence and correctness of platform, device, and file types.
 */
export function validateArgs(args: {
  desiredPlatform: string;
  desiredPlatformVersion: string;
  appPath: string;
  desiredPhone: string;
}): void {
  const { desiredPlatform, desiredPlatformVersion, appPath, desiredPhone } =
    args;

  if (!desiredPlatform || !desiredPhone) {
    throw new Error(
      "Missing required arguments: desiredPlatform and desiredPhone are required",
    );
  }

  if (!desiredPlatformVersion) {
    throw new Error(
      "Missing required arguments: desiredPlatformVersion is required",
    );
  }

  if (!appPath) {
    throw new Error("You must provide an appPath.");
  }

  if (desiredPlatform === "android" && !appPath.endsWith(".apk")) {
    throw new Error("You must provide a valid Android app path (.apk).");
  }

  if (desiredPlatform === "ios" && !appPath.endsWith(".ipa")) {
    throw new Error("You must provide a valid iOS app path (.ipa).");
  }
}

/**
 * Uploads an application file to AppAutomate and returns the app URL
 */
export async function uploadApp(appPath: string): Promise<string> {
  const filePath = appPath;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));

  const response = await axios.post<UploadResponse>(
    "https://api-cloud.browserstack.com/app-automate/upload",
    formData,
    {
      headers: {
        ...formData.getHeaders(),
      },
      auth: {
        username: config.browserstackUsername,
        password: config.browserstackAccessKey,
      },
    },
  );

  if (response.data.app_url) {
    return response.data.app_url;
  } else {
    throw new Error(`Failed to upload app: ${response.data}`);
  }
}
