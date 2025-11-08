import { z } from "zod";

// ============================================================================
// DEVICE CONFIGURATIONS (Replace tuples with objects)
// ============================================================================

// Android App Device (for app automation)
export const AndroidAppDeviceConfig = z.object({
  platform: z.literal("android"),
  deviceName: z.string(),
  osVersion: z.string(),
});

// iOS App Device (for app automation)
export const IOSAppDeviceConfig = z.object({
  platform: z.literal("ios"),
  deviceName: z.string(),
  osVersion: z.string(),
});

// Windows Browser Device (for web automation)
export const WindowsDeviceConfig = z.object({
  platform: z.literal("windows"),
  osVersion: z.string(),
  browser: z.string(),
  browserVersion: z.string(),
});

// Android Browser Device (for web automation)
export const AndroidBrowserDeviceConfig = z.object({
  platform: z.literal("android"),
  deviceName: z.string(),
  osVersion: z.string(),
  browser: z.string(),
});

// iOS Browser Device (for web automation)
export const IOSBrowserDeviceConfig = z.object({
  platform: z.literal("ios"),
  deviceName: z.string(),
  osVersion: z.string(),
  browser: z.string(),
});

// macOS Browser Device (for web automation)
export const MacOSDeviceConfig = z.object({
  platform: z.enum(["mac", "macos"]),
  osVersion: z.string(),
  browser: z.string(),
  browserVersion: z.string(),
});

// ============================================================================
// DISCRIMINATED UNIONS
// ============================================================================

// For app automation (mobile only)
export const MobileAppDevice = z.discriminatedUnion("platform", [
  AndroidAppDeviceConfig,
  IOSAppDeviceConfig,
]);

// For browser automation (all platforms)
export const BrowserDevice = z.discriminatedUnion("platform", [
  WindowsDeviceConfig,
  AndroidBrowserDeviceConfig,
  IOSBrowserDeviceConfig,
  MacOSDeviceConfig,
]);

// ============================================================================
// BACKWARD COMPATIBILITY HELPERS
// ============================================================================

export function normalizeMobileDevice(device: unknown) {
  if (Array.isArray(device)) {
    const [platform, deviceName, osVersion] = device;
    return { platform, deviceName, osVersion };
  }
  return device;
}

export function normalizeBrowserDevice(device: unknown) {
  if (Array.isArray(device)) {
    const [platform, ...rest] = device;
    const normalizedPlatform = platform?.toLowerCase();

    if (normalizedPlatform === "windows") {
      return {
        platform: "windows",
        osVersion: rest[0],
        browser: rest[1],
        browserVersion: rest[2],
      };
    }
    if (normalizedPlatform === "android") {
      return {
        platform: "android",
        deviceName: rest[0],
        osVersion: rest[1],
        browser: rest[2] || "chrome",
      };
    }
    if (normalizedPlatform === "ios") {
      return {
        platform: "ios",
        deviceName: rest[0],
        osVersion: rest[1],
        browser: rest[2] || "safari",
      };
    }
    if (normalizedPlatform === "mac" || normalizedPlatform === "macos") {
      return {
        platform: "macos",
        osVersion: rest[0],
        browser: rest[1],
        browserVersion: rest[2],
      };
    }
  }
  // If already an object, normalize "mac" to "macos" if present
  if (device && typeof device === "object" && !Array.isArray(device)) {
    const obj = device as { platform?: string; [key: string]: unknown };
    if (obj.platform === "mac") {
      return { ...obj, platform: "macos" };
    }
  }
  return device;
}
