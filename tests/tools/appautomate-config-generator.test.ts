import { describe, expect, it, vi } from "vitest";

// The SDK instruction modules reach the server entry for its version; it must not start.
vi.mock("../../src/index.js", () => ({
  trackMCP: vi.fn(),
  PackageJsonVersion: "0.0.0",
}));

import { generateAppBrowserStackYMLInstructions } from "../../src/tools/appautomate-utils/appium-sdk/config-generator.js";
import { getNodejsSDKCommand } from "../../src/tools/appautomate-utils/appium-sdk/languages/nodejs.js";

// The browserstack.yml the setup tool writes must be one the SDK reads as intended: App
// Accessibility is turned on only on request, and nothing in it is silently ignored.

const ANDROID = [
  { platform: "android", deviceName: "Google Pixel 8", osVersion: "14.0" },
];

function yml(options: { accessibility?: boolean } = {}) {
  return generateAppBrowserStackYMLInstructions(
    {
      validatedEnvironments: ANDROID,
      testingFramework: "pytest",
      projectName: "Checkout",
      ...options,
    },
    "./app.apk",
  );
}

describe("generateAppBrowserStackYMLInstructions", () => {
  it("writes the OS version as osVersion, unquoted: the SDK's accessibility module reads that key as a number", () => {
    // Observed on SDK 1.51.2: `platformVersion: 14.0` selects the device but App Accessibility
    // records no scans; `osVersion: 14.0`, the documented key, scans. A quoted "14.0" fails the
    // module's int() check and turns scanning off without a message.
    expect(yml()).toContain("osVersion: 14.0\n");
    expect(yml()).not.toMatch(/platformVersion:/);
    expect(yml()).not.toContain('osVersion: "14.0"');
  });

  it("leaves accessibility off unless asked, with the option spelled out", () => {
    expect(yml()).toContain("accessibility: false");
    expect(yml()).not.toContain("accessibilityOptions:");
  });

  it("turns App Accessibility on with its options when asked", () => {
    const text = yml({ accessibility: true });
    expect(text).toContain("accessibility: true");
    expect(text).toContain("accessibilityOptions:\n  wcagVersion: wcag22aa");
    expect(text).not.toContain("accessibility: false");
  });

  it("does not route traffic through a Local tunnel unless the user sets it up", () => {
    expect(yml()).toContain("browserstackLocal: false");
  });

  it("writes YAML comments, not // lines that YAML reads as keys", () => {
    const text = yml();
    expect(text).not.toMatch(/^\s*\/\//m);
    expect(text).toContain("# Replace projectName and buildName");
  });

  it("falls back to the default devices unquoted too", () => {
    const text = generateAppBrowserStackYMLInstructions(
      { platforms: ["android"], testingFramework: "pytest" },
      "./app.apk",
    );
    expect(text).toContain("osVersion: 12.0\n");
    expect(text).not.toMatch(/osVersion: "/);
  });
});

describe("the WebdriverIO service config", () => {
  it("turns App Accessibility on in the service options when asked", () => {
    const text = getNodejsSDKCommand("webdriverio", { accessibility: true });
    expect(text).toContain("accessibility: true,");
    expect(text).toContain("accessibilityOptions:");
    expect(text).not.toContain("accessibility: false");
  });

  it("leaves it off by default", () => {
    const text = getNodejsSDKCommand("webdriverio");
    expect(text).toContain("accessibility: false,");
    expect(text).not.toContain("accessibilityOptions:");
  });

  // App Accessibility supports @wdio/browserstack-service 8.42.0+ (WDIO v8) and 9.6.0+
  // (WDIO v9), and reads the device's OS version from osVersion.
  it("installs a service version App Accessibility supports when it is on", () => {
    const text = getNodejsSDKCommand("webdriverio", { accessibility: true });
    expect(text).toContain("npm install @wdio/browserstack-service@^9.6.0");
    expect(text).toContain("@wdio/browserstack-service@^8.42.0");
    expect(text).not.toContain("@wdio/browserstack-service@^7");
  });

  it("gives the device's OS version as osVersion when it is on", () => {
    const text = getNodejsSDKCommand("webdriverio", { accessibility: true });
    expect(text).toContain("osVersion: '12.0'");
    expect(text).not.toContain("platformVersion:");
  });
});
