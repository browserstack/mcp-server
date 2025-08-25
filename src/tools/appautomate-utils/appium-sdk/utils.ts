import {
  AppSDKSupportedTestingFramework,
  AppSDKSupportedTestingFrameworkEnum,
  createStep,
} from "./index.js";

export function isBrowserStackAppUrl(appPath: string): boolean {
  return appPath.startsWith("bs://");
}

export function generateBuildName(baseName: string = "app-automate"): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
  return `${baseName}-${timestamp}`;
}

export function createError(
  message: string,
  context?: Record<string, any>,
): Error {
  const error = new Error(message);
  if (context) {
    (error as any).context = context;
  }
  return error;
}

// Platform utilities for cross-platform support
export const PLATFORM_UTILS = {
  isWindows: process.platform === "win32",
  isMac: process.platform === "darwin",
  isAppleSilicon: process.platform === "darwin" && process.arch === "arm64",
  getPlatformLabel: () => {
    switch (process.platform) {
      case "win32":
        return "Windows";
      case "darwin":
        return "macOS";
      default:
        return "macOS";
    }
  },
};

export async function getAppUploadInstruction(
  appPath: string,
  username: string,
  accessKey: string,
  detectedTestingFramework: AppSDKSupportedTestingFramework,
): Promise<string> {
  if (
    detectedTestingFramework === AppSDKSupportedTestingFrameworkEnum.nightwatch ||
    detectedTestingFramework === AppSDKSupportedTestingFrameworkEnum.webdriverio
  ) {
    const app_url = "bs://ff4e358328a3e914fe4f0e46ec7af73f9c08cd55";
    if (app_url) {
      return createStep(
        "Updating app_path with app_url",
        `Replace the value of app_path in your configuration with: ${app_url}`,
      );
    }
  }
  return "";
}
