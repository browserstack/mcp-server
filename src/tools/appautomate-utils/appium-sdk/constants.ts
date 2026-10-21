import { z } from "zod";
// Import enums directly from types.js (not the index barrel) so this module has
// no cycle back through index → instructions → languages/*, letting other
// modules safely read the placeholder constants below at module scope.
import {
  AppSDKSupportedFrameworkEnum,
  AppSDKSupportedTestingFrameworkEnum,
  AppSDKSupportedLanguageEnum,
} from "./types.js";

// App Automate specific device configurations
export const APP_DEVICE_CONFIGS = {
  android: [
    { deviceName: "Samsung Galaxy S22 Ultra", platformVersion: "12.0" },
    { deviceName: "Google Pixel 7 Pro", platformVersion: "13.0" },
    { deviceName: "OnePlus 9", platformVersion: "11.0" },
  ],
  ios: [
    { deviceName: "iPhone 14", platformVersion: "16" },
    { deviceName: "iPhone 13", platformVersion: "15" },
    { deviceName: "iPad Air 4", platformVersion: "14" },
  ],
};

// Step delimiter for parsing instructions
export const STEP_DELIMITER = "---STEP---";

export {
  USERNAME_PLACEHOLDER,
  ACCESS_KEY_PLACEHOLDER,
} from "../../sdk-utils/common/credentials.js";

// Default app path for examples
export const DEFAULT_APP_PATH = "bs://sample.app";

export const MobileDeviceSchema = z.object({
  platform: z
    .enum(["android", "ios"])
    .describe("Platform name: 'android' or 'ios'"),
  deviceName: z
    .string()
    .describe(
      "Device name, e.g. 'Samsung Galaxy S24', 'Google Pixel 8', 'iPhone 15', 'iPhone 14 Pro'",
    ),
  osVersion: z.string().describe("OS version, e.g. '14', '16', '17', 'latest'"),
});

// Tool description and schema for setupBrowserStackAppAutomateTests
export const SETUP_APP_AUTOMATE_DESCRIPTION =
  "Set up the App Automate SDK for Appium tests. For pre-built Espresso or XCUITest suites use runAppTestsOnBrowserStack.";

export const SETUP_APP_AUTOMATE_SCHEMA = {
  detectedFramework: z
    .nativeEnum(AppSDKSupportedFrameworkEnum)
    .describe(
      "The mobile automation framework configured in the project. Example: 'appium'",
    ),

  detectedTestingFramework: z
    .nativeEnum(AppSDKSupportedTestingFrameworkEnum)
    .describe(
      "Test framework in the project, e.g. testng, behave, pytest, robot.",
    ),

  detectedLanguage: z
    .nativeEnum(AppSDKSupportedLanguageEnum)
    .describe(
      "The programming language used in the project. Supports Java and C#. Example: 'java', 'csharp'",
    ),

  devices: z
    .array(MobileDeviceSchema)
    .max(3)
    .default([])
    .describe(
      "Only devices the user asked for, e.g. [['android', 'Samsung Galaxy S24', '14']].",
    ),

  appPath: z
    .string()
    .describe(
      "Path to the mobile app file (.apk for Android, .ipa for iOS). Can be a local file path or a BrowserStack app URL (bs://)",
    ),
  project: z
    .string()
    .optional()
    .default("BStack-AppAutomate-Suite")
    .describe("Project name for organizing test runs on BrowserStack."),
};
