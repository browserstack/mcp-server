import fs from "fs";
import FormData from "form-data";
import { apiClient } from "../../../lib/apiClient.js";
import { customFuzzySearch } from "../../../lib/fuzzy.js";
import { BrowserStackConfig } from "../../../lib/types.js";

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
  appPath?: string;
  desiredPhone: string;
  browserstackAppUrl?: string;
}): void {
  const {
    desiredPlatform,
    desiredPlatformVersion,
    appPath,
    desiredPhone,
    browserstackAppUrl,
  } = args;

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

  if (!appPath && !browserstackAppUrl) {
    throw new Error("Either appPath or browserstackAppUrl must be provided");
  }

  // Only validate app path format if appPath is provided
  if (appPath) {
    if (desiredPlatform === "android" && !appPath.endsWith(".apk")) {
      throw new Error("You must provide a valid Android app path (.apk).");
    }

    if (desiredPlatform === "ios" && !appPath.endsWith(".ipa")) {
      throw new Error("You must provide a valid iOS app path (.ipa).");
    }
  }
}

/**
 * Uploads an application file to AppAutomate and returns the app URL
 */
export async function uploadApp(
  appPath: string,
  username: string,
  password: string,
): Promise<string> {
  const filePath = appPath;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));

  const response = await apiClient.post<UploadResponse>({
    url: "https://api-cloud.browserstack.com/app-automate/upload",
    headers: {
      ...formData.getHeaders(),
      Authorization:
        "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
    body: formData,
  });

  if (response.data.app_url) {
    return response.data.app_url;
  } else {
    throw new Error(`Failed to upload app: ${JSON.stringify(response.data)}`);
  }
}

// Helper to upload a file to a given BrowserStack endpoint and return a specific property from the response.
async function uploadFileToBrowserStack(
  filePath: string,
  endpoint: string,
  responseKey: string,
  config: BrowserStackConfig,
): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));

  const authHeader =
    "Basic " +
    Buffer.from(
      `${config["browserstack-username"]}:${config["browserstack-access-key"]}`,
    ).toString("base64");

  const response = await apiClient.post({
    url: endpoint,
    headers: {
      ...formData.getHeaders(),
      Authorization: authHeader,
    },
    body: formData,
  });

  if (response.data[responseKey]) {
    return response.data[responseKey];
  }

  throw new Error(`Failed to upload file: ${JSON.stringify(response.data)}`);
}

//Uploads an Android app (.apk or .aab) to BrowserStack Espresso endpoint and returns the app_url
export async function uploadEspressoApp(
  appPath: string,
  config: BrowserStackConfig,
): Promise<string> {
  return uploadFileToBrowserStack(
    appPath,
    "https://api-cloud.browserstack.com/app-automate/espresso/v2/app",
    "app_url",
    config,
  );
}

//Uploads an Espresso test suite (.apk) to BrowserStack and returns the test_suite_url
export async function uploadEspressoTestSuite(
  testSuitePath: string,
  config: BrowserStackConfig,
): Promise<string> {
  return uploadFileToBrowserStack(
    testSuitePath,
    "https://api-cloud.browserstack.com/app-automate/espresso/v2/test-suite",
    "test_suite_url",
    config,
  );
}

//Uploads an iOS app (.ipa) to BrowserStack XCUITest endpoint and returns the app_url
export async function uploadXcuiApp(
  appPath: string,
  config: BrowserStackConfig,
): Promise<string> {
  return uploadFileToBrowserStack(
    appPath,
    "https://api-cloud.browserstack.com/app-automate/xcuitest/v2/app",
    "app_url",
    config,
  );
}

//Uploads an XCUITest test suite (.zip) to BrowserStack and returns the test_suite_url
export async function uploadXcuiTestSuite(
  testSuitePath: string,
  config: BrowserStackConfig,
): Promise<string> {
  return uploadFileToBrowserStack(
    testSuitePath,
    "https://api-cloud.browserstack.com/app-automate/xcuitest/v2/test-suite",
    "test_suite_url",
    config,
  );
}

// Triggers an Espresso test run on BrowserStack and returns the build_id
export async function triggerEspressoBuild(
  app_url: string,
  test_suite_url: string,
  devices: string[],
  project: string,
): Promise<string> {
  const auth = {
    username: process.env.BROWSERSTACK_USERNAME || "",
    password: process.env.BROWSERSTACK_ACCESS_KEY || "",
  };

  const response = await apiClient.post({
    url: "https://api-cloud.browserstack.com/app-automate/espresso/v2/build",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${auth.username}:${auth.password}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: {
      app: app_url,
      testSuite: test_suite_url,
      devices,
      project,
    },
  });

  if (response.data.build_id) {
    return response.data.build_id;
  }

  throw new Error(
    `Failed to trigger Espresso build: ${JSON.stringify(response.data)}`,
  );
}

// Triggers an XCUITest run on BrowserStack and returns the build_id
export async function triggerXcuiBuild(
  app_url: string,
  test_suite_url: string,
  devices: string[],
  project: string,
  config: BrowserStackConfig,
): Promise<string> {
  const auth = {
    username: config["browserstack-username"],
    password: config["browserstack-access-key"],
  };

  const response = await apiClient.post({
    url: "https://api-cloud.browserstack.com/app-automate/xcuitest/v2/build",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${auth.username}:${auth.password}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: {
      app: app_url,
      testSuite: test_suite_url,
      devices,
      project,
    },
  });

  if (response.data.build_id) {
    return response.data.build_id;
  }

  throw new Error(
    `Failed to trigger XCUITest build: ${JSON.stringify(response.data)}`,
  );
}
