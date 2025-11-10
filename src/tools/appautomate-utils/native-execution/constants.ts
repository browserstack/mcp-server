import { z } from "zod";
import { AppTestPlatform } from "./types.js";

export const RUN_APP_AUTOMATE_DESCRIPTION = `Execute pre-built native mobile test suites (Espresso for Android, XCUITest for iOS) by direct upload to BrowserStack. ONLY for compiled .apk/.ipa test files. This is NOT for SDK integration or Appium tests. For Appium-based testing with SDK setup, use 'setupBrowserStackAppAutomateTests' instead.`;

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
      "Path to your application file:\n" +
        "If in development IDE directory:\n" +
        "• For Android: 'gradle assembleDebug'\n" +
        "• For iOS:\n" +
        "  xcodebuild clean -scheme YOUR_SCHEME && \\\n" +
        "  xcodebuild archive -scheme YOUR_SCHEME -configuration Release -archivePath build/app.xcarchive && \\\n" +
        "  xcodebuild -exportArchive -archivePath build/app.xcarchive -exportPath build/ipa -exportOptionsPlist exportOptions.plist\n\n" +
        "If in other directory, provide existing app path",
    ),
  testSuitePath: z
    .string()
    .describe(
      "Path to your test suite file:\n" +
        "If in development IDE directory:\n" +
        "• For Android: 'gradle assembleAndroidTest'\n" +
        "• For iOS:\n" +
        "  xcodebuild test-without-building -scheme YOUR_SCHEME -destination 'generic/platform=iOS' && \\\n" +
        "  cd ~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug-iphonesimulator/ && \\\n" +
        "  zip -r Tests.zip *.xctestrun *-Runner.app\n\n" +
        "If in other directory, provide existing test file path",
    ),
  devices: z
    .array(MobileDeviceSchema)
    .max(3)
    .default([])
    .describe(
      "Tuples describing target mobile devices. Add device only when user asks explicitly for it. Defaults to [] . Example: [['android', 'Samsung Galaxy S24', '14'], ['ios', 'iPhone 15', '17']]",
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
