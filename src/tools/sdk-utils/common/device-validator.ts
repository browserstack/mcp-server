import {
  getDevicesAndBrowsers,
  BrowserStackProducts,
} from "../../../lib/device-cache.js";
import { resolveVersion } from "../../../lib/version-resolver.js";
import { customFuzzySearch } from "../../../lib/fuzzy.js";
import { SDKSupportedBrowserAutomationFrameworkEnum } from "./types.js";
import { CallerError } from "../../../lib/error.js";

// ============================================================================
// SHARED TYPES AND INTERFACES
// ============================================================================

// Type definitions for better type safety
export interface DesktopBrowserEntry {
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
}

export interface MobileDeviceEntry {
  os: "android" | "ios";
  os_version: string;
  display_name: string;
  browsers?: Array<{
    browser: string;
    display_name?: string;
  }>;
}

export interface ValidatedEnvironment {
  platform: string;
  osVersion: string;
  browser?: string;
  browserVersion?: string;
  deviceName?: string;
  notes?: string;
}

// Raw data interfaces for API responses
interface RawDesktopPlatform {
  os: string;
  os_version: string;
  browsers: Array<{
    browser: string;
    browser_version: string;
  }>;
}

interface RawMobileGroup {
  os: "android" | "ios";
  devices: Array<{
    os_version: string;
    display_name: string;
    browser?: string;
    browsers?: Array<{
      browser: string;
      display_name?: string;
    }>;
  }>;
}

interface RawDeviceData {
  desktop?: RawDesktopPlatform[];
  mobile?: RawMobileGroup[];
}

const DEFAULTS = {
  windows: { browser: "chrome" },
  macos: { browser: "safari" },
  android: { device: "Samsung Galaxy S24", browser: "chrome" },
  ios: { device: "iPhone 15", browser: "safari" },
} as const;

// Performance optimization: Indexed maps for faster lookups
interface DesktopIndex {
  byOS: Map<string, DesktopBrowserEntry[]>;
  byOSVersion: Map<string, DesktopBrowserEntry[]>;
  byBrowser: Map<string, DesktopBrowserEntry[]>;
  nested: Map<string, Map<string, Map<string, DesktopBrowserEntry[]>>>;
}

interface MobileIndex {
  byPlatform: Map<string, MobileDeviceEntry[]>;
  byDeviceName: Map<string, MobileDeviceEntry[]>;
  byOSVersion: Map<string, MobileDeviceEntry[]>;
}

// ============================================================================
// AUTOMATE SECTION (Desktop + Mobile for BrowserStack SDK)
// ============================================================================

// Helper functions to build device entries and eliminate duplication
function buildDesktopEntries(
  automateData: RawDeviceData,
): DesktopBrowserEntry[] {
  if (!automateData.desktop) {
    return [];
  }

  return automateData.desktop.flatMap((platform: RawDesktopPlatform) =>
    platform.browsers.map((browser) => ({
      os: platform.os,
      os_version: platform.os_version,
      browser: browser.browser,
      browser_version: browser.browser_version,
    })),
  );
}

function buildMobileEntries(
  appAutomateData: RawDeviceData,
  platform: "android" | "ios",
): MobileDeviceEntry[] {
  if (!appAutomateData.mobile) {
    return [];
  }

  return appAutomateData.mobile
    .filter((group: RawMobileGroup) => group.os === platform)
    .flatMap((group: RawMobileGroup) =>
      group.devices.map((device) => ({
        os: group.os,
        os_version: device.os_version,
        display_name: device.display_name,
        browsers: device.browsers || [
          {
            browser:
              device.browser || (platform === "android" ? "chrome" : "safari"),
          },
        ],
      })),
    );
}

// Performance optimization: Create indexed maps for faster lookups
function createDesktopIndex(entries: DesktopBrowserEntry[]): DesktopIndex {
  const byOS = new Map<string, DesktopBrowserEntry[]>();
  const byOSVersion = new Map<string, DesktopBrowserEntry[]>();
  const byBrowser = new Map<string, DesktopBrowserEntry[]>();
  const nested = new Map<
    string,
    Map<string, Map<string, DesktopBrowserEntry[]>>
  >();

  for (const entry of entries) {
    // Index by OS
    if (!byOS.has(entry.os)) {
      byOS.set(entry.os, []);
    }
    byOS.get(entry.os)!.push(entry);

    // Index by OS version
    if (!byOSVersion.has(entry.os_version)) {
      byOSVersion.set(entry.os_version, []);
    }
    byOSVersion.get(entry.os_version)!.push(entry);

    // Index by browser
    if (!byBrowser.has(entry.browser)) {
      byBrowser.set(entry.browser, []);
    }
    byBrowser.get(entry.browser)!.push(entry);

    // Build nested index: Map<os, Map<os_version, Map<browser, DesktopBrowserEntry[]>>>
    if (!nested.has(entry.os)) {
      nested.set(entry.os, new Map());
    }
    const osMap = nested.get(entry.os)!;

    if (!osMap.has(entry.os_version)) {
      osMap.set(entry.os_version, new Map());
    }
    const osVersionMap = osMap.get(entry.os_version)!;

    if (!osVersionMap.has(entry.browser)) {
      osVersionMap.set(entry.browser, []);
    }
    osVersionMap.get(entry.browser)!.push(entry);
  }

  return { byOS, byOSVersion, byBrowser, nested };
}

function createMobileIndex(entries: MobileDeviceEntry[]): MobileIndex {
  const byPlatform = new Map<string, MobileDeviceEntry[]>();
  const byDeviceName = new Map<string, MobileDeviceEntry[]>();
  const byOSVersion = new Map<string, MobileDeviceEntry[]>();

  for (const entry of entries) {
    // Index by platform
    if (!byPlatform.has(entry.os)) {
      byPlatform.set(entry.os, []);
    }
    byPlatform.get(entry.os)!.push(entry);

    // Index by device name (case-insensitive)
    const deviceKey = entry.display_name.toLowerCase();
    if (!byDeviceName.has(deviceKey)) {
      byDeviceName.set(deviceKey, []);
    }
    byDeviceName.get(deviceKey)!.push(entry);

    // Index by OS version
    if (!byOSVersion.has(entry.os_version)) {
      byOSVersion.set(entry.os_version, []);
    }
    byOSVersion.get(entry.os_version)!.push(entry);
  }

  return { byPlatform, byDeviceName, byOSVersion };
}

export async function validateDevices(
  devices: Array<Array<string>>,
  framework?: string,
): Promise<ValidatedEnvironment[]> {
  const validatedEnvironments: ValidatedEnvironment[] = [];

  if (!devices || devices.length === 0) {
    // Use centralized default fallback
    return [
      {
        platform: "windows",
        osVersion: "11",
        browser: DEFAULTS.windows.browser,
        browserVersion: "latest",
      },
    ];
  }

  // Determine what data we need to fetch
  const needsDesktop = devices.some((env) =>
    ["windows", "macos"].includes((env[0] || "").toLowerCase()),
  );
  const needsMobile = devices.some((env) =>
    ["android", "ios"].includes((env[0] || "").toLowerCase()),
  );

  // Fetch data using framework-specific endpoint for both desktop and mobile
  let deviceData: RawDeviceData | null = null;

  try {
    if (needsDesktop || needsMobile) {
      if (framework === SDKSupportedBrowserAutomationFrameworkEnum.playwright) {
        deviceData = (await getDevicesAndBrowsers(
          BrowserStackProducts.PLAYWRIGHT_AUTOMATE,
        )) as RawDeviceData;
      } else {
        deviceData = (await getDevicesAndBrowsers(
          BrowserStackProducts.SELENIUM_AUTOMATE,
        )) as RawDeviceData;
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to fetch device data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Preprocess data into indexed maps for better performance
  let desktopIndex: DesktopIndex | null = null;
  let androidIndex: MobileIndex | null = null;
  let iosIndex: MobileIndex | null = null;

  if (needsDesktop && deviceData) {
    const desktopEntries = buildDesktopEntries(deviceData);
    desktopIndex = createDesktopIndex(desktopEntries);
  }

  if (needsMobile && deviceData) {
    const androidEntries = buildMobileEntries(deviceData, "android");
    const iosEntries = buildMobileEntries(deviceData, "ios");
    androidIndex = createMobileIndex(androidEntries);
    iosIndex = createMobileIndex(iosEntries);
  }

  for (const env of devices) {
    const discriminator = (env[0] || "").toLowerCase();
    let validatedEnv: ValidatedEnvironment;

    if (discriminator === "windows") {
      validatedEnv = validateDesktopEnvironment(
        env,
        desktopIndex!,
        "windows",
        DEFAULTS.windows.browser,
      );
    } else if (discriminator === "macos") {
      validatedEnv = validateDesktopEnvironment(
        env,
        desktopIndex!,
        "macos",
        DEFAULTS.macos.browser,
      );
    } else if (discriminator === "android") {
      validatedEnv = validateMobileEnvironment(
        env,
        androidIndex!,
        "android",
        DEFAULTS.android.device,
        DEFAULTS.android.browser,
      );
    } else if (discriminator === "ios") {
      validatedEnv = validateMobileEnvironment(
        env,
        iosIndex!,
        "ios",
        DEFAULTS.ios.device,
        DEFAULTS.ios.browser,
      );
    } else {
      throw new CallerError(`Unsupported platform: ${discriminator}`);
    }

    validatedEnvironments.push(validatedEnv);
  }

  if (framework === SDKSupportedBrowserAutomationFrameworkEnum.playwright) {
    validatedEnvironments.forEach((env) => {
      if (env.browser) {
        env.browser = env.browser.toLowerCase();
      }
    });
  }

  return validatedEnvironments;
}

// Optimized desktop validation using nested indexed maps for O(1) lookups
function validateDesktopEnvironment(
  env: string[],
  index: DesktopIndex,
  platform: "windows" | "macos",
  defaultBrowser: string,
): ValidatedEnvironment {
  const [, osVersion, browser, browserVersion] = env;

  const osKey = platform === "windows" ? "Windows" : "OS X";

  // Use nested index for O(1) lookup instead of filtering
  const osMap = index.nested.get(osKey);
  if (!osMap) {
    throw new Error(`No ${platform} devices available`);
  }

  // Get available OS versions for this platform
  const availableOSVersions = Array.from(osMap.keys());

  const validatedOSVersion = resolveVersion(
    osVersion || "latest",
    availableOSVersions,
  );

  // Use nested index for O(1) lookup
  const osVersionMap = osMap.get(validatedOSVersion);
  if (!osVersionMap) {
    throw new CallerError(
      `OS version "${validatedOSVersion}" not available for ${platform}`,
    );
  }

  // Get available browsers for this OS version
  const availableBrowsers = Array.from(osVersionMap.keys());
  const validatedBrowser = validateBrowserExact(
    browser || defaultBrowser,
    availableBrowsers,
  );

  // Use nested index for O(1) lookup
  const browserEntries = osVersionMap.get(validatedBrowser);
  if (!browserEntries || browserEntries.length === 0) {
    throw new CallerError(
      `Browser "${validatedBrowser}" not available for ${platform} ${validatedOSVersion}`,
    );
  }

  const availableBrowserVersions = [
    ...new Set(browserEntries.map((e) => e.browser_version)),
  ] as string[];
  const validatedBrowserVersion = resolveVersion(
    browserVersion || "latest",
    availableBrowserVersions,
  );

  return {
    platform,
    osVersion: validatedOSVersion,
    browser: validatedBrowser,
    browserVersion: validatedBrowserVersion,
  };
}

// Optimized mobile validation using indexed maps
function validateMobileEnvironment(
  env: string[],
  index: MobileIndex,
  platform: "android" | "ios",
  defaultDevice: string,
  defaultBrowser: string,
): ValidatedEnvironment {
  const [, deviceName, osVersion, browser] = env;

  const platformEntries = index.byPlatform.get(platform) || [];
  if (platformEntries.length === 0) {
    throw new Error(`No ${platform} devices available`);
  }

  // Use fuzzy search only for device names (as suggested in feedback)
  const deviceMatches = customFuzzySearch(
    platformEntries,
    ["display_name"],
    deviceName || defaultDevice,
    5,
  );
  if (deviceMatches.length === 0) {
    throw new CallerError(
      `No ${platform} devices matching "${deviceName}". Available devices: ${platformEntries
        .map((d) => d.display_name || "unknown")
        .slice(0, 5)
        .join(", ")}`,
    );
  }

  // Try to find exact match first
  const exactMatch = deviceMatches.find(
    (m) => m.display_name.toLowerCase() === (deviceName || "").toLowerCase(),
  );

  // If no exact match, throw error instead of using fuzzy match
  if (!exactMatch) {
    const suggestions = deviceMatches.map((m) => m.display_name).join(", ");
    throw new CallerError(
      `Device "${deviceName}" not found exactly for ${platform}. Available similar devices: ${suggestions}. Please use the exact device name.`,
    );
  }

  // Use index for faster filtering
  const deviceKey = exactMatch.display_name.toLowerCase();
  const deviceFiltered = index.byDeviceName.get(deviceKey) || [];

  const availableOSVersions = [
    ...new Set(deviceFiltered.map((d) => d.os_version)),
  ] as string[];
  const validatedOSVersion = resolveVersion(
    osVersion || "latest",
    availableOSVersions,
  );

  // Use index for faster filtering
  const osVersionEntries = index.byOSVersion.get(validatedOSVersion) || [];
  const osFiltered = osVersionEntries.filter(
    (d) => d.display_name.toLowerCase() === deviceKey,
  );

  // Validate browser if provided - use exact matching for browsers
  let validatedBrowser = browser || defaultBrowser;
  if (browser && osFiltered.length > 0) {
    // Extract browsers more carefully - handle different possible structures
    const availableBrowsers = [
      ...new Set(
        osFiltered.flatMap((d) => {
          if (d.browsers && Array.isArray(d.browsers)) {
            // If browsers is an array of objects with browser property
            return d.browsers
              .map((b) => {
                // Use display_name for user-friendly browser names, fallback to browser field
                return b.display_name || b.browser;
              })
              .filter(Boolean);
          }
          // For mobile devices, provide default browsers if none found
          return platform === "android" ? ["chrome"] : ["safari"];
        }),
      ),
    ].filter(Boolean) as string[];

    if (availableBrowsers.length > 0) {
      try {
        validatedBrowser = validateBrowserExact(browser, availableBrowsers);
      } catch (error) {
        // Add more context to browser validation errors
        throw new Error(
          `Failed to validate browser "${browser}" for ${platform} device "${exactMatch.display_name}" on OS version "${validatedOSVersion}". ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      // For mobile, if no specific browsers found, just use the requested browser
      // as most mobile devices support standard browsers
      validatedBrowser = browser || defaultBrowser;
    }
  }

  return {
    platform,
    osVersion: validatedOSVersion,
    deviceName: exactMatch.display_name,
    browser: validatedBrowser,
  };
}

// ============================================================================
// APP AUTOMATE SECTION (Mobile devices for App Automate)
// ============================================================================

export async function validateAppAutomateDevices(
  devices: Array<Array<string>>,
): Promise<ValidatedEnvironment[]> {
  const validatedDevices: ValidatedEnvironment[] = [];

  if (!devices || devices.length === 0) {
    // Use centralized default fallback
    return [
      {
        platform: "android",
        osVersion: "latest",
        deviceName: DEFAULTS.android.device,
      },
    ];
  }

  let appAutomateData: RawDeviceData;

  try {
    // Fetch app automate device data
    appAutomateData = (await getDevicesAndBrowsers(
      BrowserStackProducts.APP_AUTOMATE,
    )) as RawDeviceData;
  } catch (error) {
    // Only wrap fetch-related errors
    throw new Error(
      `Failed to fetch device data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const device of devices) {
    // Parse device array in format ["android", "Device Name", "OS Version"]
    const [platform, deviceName, osVersion] = device;

    // Find matching device in the data
    let validatedDevice: ValidatedEnvironment | null = null;

    if (!appAutomateData.mobile) {
      throw new Error("No mobile device data available");
    }

    // Filter by platform first
    const platformGroup = appAutomateData.mobile.find(
      (group) => group.os === platform.toLowerCase(),
    );

    if (!platformGroup) {
      throw new CallerError(
        `Platform "${platform}" not supported for App Automate`,
      );
    }

    const platformDevices = platformGroup.devices;

    // Find exact device name match (case-insensitive)
    const exactMatch = platformDevices.find(
      (d) => d.display_name.toLowerCase() === deviceName.toLowerCase(),
    );

    if (exactMatch) {
      // Check if the OS version is available for this device
      const deviceVersions = platformDevices
        .filter((d) => d.display_name === exactMatch.display_name)
        .map((d) => d.os_version);

      const validatedOSVersion = resolveVersion(
        osVersion || "latest",
        deviceVersions,
      );

      validatedDevice = {
        platform: platformGroup.os,
        osVersion: validatedOSVersion,
        deviceName: exactMatch.display_name,
      };
    }

    if (!validatedDevice) {
      // If no exact match found, suggest similar devices from the SAME platform only
      const platformDevicesForSearch = platformDevices.map((d) => ({
        ...d,
        platform: platformGroup.os,
      }));

      // Try fuzzy search with a more lenient threshold
      const deviceMatches = customFuzzySearch(
        platformDevicesForSearch,
        ["display_name"],
        deviceName,
        5,
        0.8, // More lenient threshold
      );

      const suggestions = deviceMatches
        .map((m) => `${m.display_name}`)
        .join(", ");

      // If no fuzzy matches, show some available devices as fallback
      const fallbackDevices = platformDevicesForSearch
        .slice(0, 5)
        .map((d) => d.display_name)
        .join(", ");

      const errorMessage = suggestions
        ? `Device "${deviceName}" not found for platform "${platform}".\nAvailable similar devices: ${suggestions}`
        : `Device "${deviceName}" not found for platform "${platform}".\nAvailable devices: ${fallbackDevices}`;

      throw new CallerError(errorMessage);
    }

    validatedDevices.push(validatedDevice);
  }

  return validatedDevices;
}

// ============================================================================
// SHARED UTILITY FUNCTIONS
// ============================================================================

// Exact browser validation (preferred for structured fields)
function validateBrowserExact(
  requestedBrowser: string,
  availableBrowsers: string[],
): string {
  const exactMatch = availableBrowsers.find(
    (b) => b.toLowerCase() === requestedBrowser.toLowerCase(),
  );
  if (exactMatch) {
    return exactMatch;
  }

  throw new CallerError(
    `Browser "${requestedBrowser}" not found. Available options: ${availableBrowsers.join(", ")}`,
  );
}
