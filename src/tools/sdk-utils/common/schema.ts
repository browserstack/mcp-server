import { z } from "zod";
import { PercyIntegrationTypeEnum } from "./types.js";
import {
  SDKSupportedBrowserAutomationFrameworkEnum,
  SDKSupportedTestingFrameworkEnum,
  SDKSupportedLanguageEnum,
} from "./types.js";

// Platform enums for better validation
export const PlatformEnum = {
  WINDOWS: "windows",
  MACOS: "macos",
  ANDROID: "android",
  IOS: "ios",
} as const;

export const WindowsPlatformEnum = {
  WINDOWS: "windows",
} as const;

export const MacOSPlatformEnum = {
  MACOS: "macos",
} as const;

export const SetUpPercyParamsShape = {
  projectName: z.string().describe("Unique Percy project name."),
  detectedLanguage: z.nativeEnum(SDKSupportedLanguageEnum),
  detectedBrowserAutomationFramework: z.nativeEnum(
    SDKSupportedBrowserAutomationFrameworkEnum,
  ),
  detectedTestingFramework: z.nativeEnum(SDKSupportedTestingFrameworkEnum),
  integrationType: z
    .nativeEnum(PercyIntegrationTypeEnum)
    .describe(
      "'web' (Percy Web) or 'automate' (Percy Automate). If unspecified, ask the user; never default.",
    ),
  folderPaths: z
    .array(z.string())
    .optional()
    .describe(
      "Absolute paths of folders with UI tests. If omitted, scan the codebase for them; [] if none.",
    ),
  filePaths: z
    .array(z.string())
    .optional()
    .describe(
      "Absolute paths of specific UI test files, instead of folders. If omitted, folderPaths is used.",
    ),
};

// Device schema for BrowserStack Automate (supports desktop and mobile)
const DeviceSchema = z.object({
  platform: z
    .enum(["windows", "macos", "android", "ios"])
    .describe("Platform name, e.g. 'windows', 'macos', 'android', 'ios'"),
  deviceName: z
    .string()
    .optional()
    .describe(
      "Device name for mobile platforms, e.g. 'iPhone 15', 'Samsung Galaxy S24'",
    ),
  osVersion: z
    .string()
    .describe("OS version, e.g. '11', 'Sequoia', '14', '17', 'latest'"),
  browser: z
    .string()
    .optional()
    .describe("Browser name, e.g. 'chrome', 'safari', 'edge', 'firefox'"),
  browserVersion: z
    .string()
    .optional()
    .describe(
      "Browser version for desktop platforms only (windows, macos), e.g. '132', 'latest', 'oldest'. Not used for mobile devices (android, ios).",
    ),
});

export const RunTestsOnBrowserStackParamsShape = {
  projectName: z
    .string()
    .describe("A single name for your project to organize all your tests."),
  detectedLanguage: z.nativeEnum(SDKSupportedLanguageEnum),
  detectedBrowserAutomationFramework: z.nativeEnum(
    SDKSupportedBrowserAutomationFrameworkEnum,
  ),
  detectedTestingFramework: z.nativeEnum(SDKSupportedTestingFrameworkEnum),
  devices: z
    .array(DeviceSchema)
    .max(3)
    .default([])
    .describe(
      "Only devices the user asked for, e.g. [{ platform: 'windows', osVersion: '11', browser: 'chrome', browserVersion: 'latest' }].",
    ),
};

export const SetUpPercySchema = z.object(SetUpPercyParamsShape);

export const RunTestsOnBrowserStackSchema = z.object(
  RunTestsOnBrowserStackParamsShape,
);

export type SetUpPercyInput = z.infer<typeof SetUpPercySchema>;
export type RunTestsOnBrowserStackInput = z.infer<
  typeof RunTestsOnBrowserStackSchema
>;

export const RunPercyScanParamsShape = {
  projectName: z.string().describe("The name of the project to run Percy on."),
  percyRunCommand: z
    .string()
    .optional()
    .describe(
      "Test command to run with Percy; infer from project context first.",
    ),
  integrationType: z
    .nativeEnum(PercyIntegrationTypeEnum)
    .describe(
      "'web' or 'automate'. If unspecified, ask the user.",
    ),
};

export const FetchPercyChangesParamsShape = {
  project_name: z
    .string()
    .describe(
      "The name of the BrowserStack project. If not found, ask user directly.",
    ),
};

export const ManagePercyBuildApprovalParamsShape = {
  buildId: z
    .string()
    .describe("The ID of the Percy build to approve or reject."),
  action: z
    .enum(["approve", "unapprove", "reject"])
    .describe("The action to perform on the Percy build."),
};
