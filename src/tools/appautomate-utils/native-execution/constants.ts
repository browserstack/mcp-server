import { z } from "zod";
import { AppTestPlatform } from "./types.js";

export const RUN_APP_AUTOMATE_DESCRIPTION = `Run pre-built Espresso (Android) or XCUITest (iOS) suites on BrowserStack by upload. Not for Appium: use setupBrowserStackAppAutomateTests.`;

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

export const RUN_APP_AUTOMATE_SCHEMA = {
  appPath: z
    .string()
    .describe(
      "Built .apk/.ipa inside MCP_UPLOAD_BASE_DIR (gradle assembleDebug, or xcodebuild archive and export).",
    ),
  testSuitePath: z
    .string()
    .describe(
      "Built suite inside MCP_UPLOAD_BASE_DIR (gradle assembleAndroidTest, or zipped .xctestrun + Runner.app).",
    ),
  devices: z
    .array(MobileDeviceSchema)
    .max(3)
    .default([])
    .describe(
      "Only devices the user asked for, e.g. [['android', 'Samsung Galaxy S24', '14']].",
    ),
  project: z
    .string()
    .optional()
    .default("BStack-AppAutomate-Suite")
    .describe("Project name for organizing test runs on BrowserStack."),
  detectedAutomationFramework: z
    .nativeEnum(AppTestPlatform)
    .describe(
      "The automation framework used in the project, such as 'espresso' (Android) or 'xcuitest' (iOS).",
    ),
};
