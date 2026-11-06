import { describe, expect, it } from "vitest";

import { generateBrowserStackYMLInstructions } from "../../src/tools/sdk-utils/bstack/configUtils.js";
import { RunTestsOnBrowserStackSchema } from "../../src/tools/sdk-utils/common/schema.js";
import { runBstackSDKOnly } from "../../src/tools/sdk-utils/bstack/sdkHandler.js";
import { BrowserStackConfig } from "../../src/lib/types.js";

// Asked to run Automate tests with accessibility testing on, the setup tool must write
// accessibility: true into browserstack.yml, and must not tell the user to replace a file
// they already have, which would drop their own settings.

const yml = (accessibility?: boolean) =>
  generateBrowserStackYMLInstructions({
    validatedEnvironments: [],
    projectName: "Checkout",
    ...(accessibility === undefined ? {} : { accessibility }),
  });

describe("setupBrowserStackAutomateTests and accessibility", () => {
  it("takes accessibility as an option, off by default", () => {
    const base = {
      projectName: "Checkout",
      detectedLanguage: "nodejs",
      detectedBrowserAutomationFramework: "playwright",
      detectedTestingFramework: "playwright",
    };
    expect(RunTestsOnBrowserStackSchema.parse(base).accessibility).toBe(false);
    expect(RunTestsOnBrowserStackSchema.parse({ ...base, accessibility: true }).accessibility).toBe(true);
  });

  it("writes accessibility: true into browserstack.yml when asked", () => {
    expect(yml(true)).toContain("\naccessibility: true\n");
  });

  it("leaves the file as it was when accessibility is not asked for", () => {
    expect(yml()).not.toMatch(/^accessibility:/m);
  });

  it("says to add to an existing browserstack.yml rather than replace it", () => {
    expect(yml(true)).toContain("If the file already exists, add these keys to it and keep its other settings");
  });
});

// Cypress and WebdriverIO are set up without browserstack.yml: Cypress through the
// browserstack-cypress CLI's browserstack.json, WebdriverIO through its BrowserStack
// service's options. Each turns accessibility on in its own file.
describe("setupBrowserStackAutomateTests, accessibility and the frameworks without browserstack.yml", () => {
  const setup = async (framework: "cypress" | "webdriverio", accessibility: boolean) => {
    const { steps } = await runBstackSDKOnly(
      RunTestsOnBrowserStackSchema.parse({
        projectName: "Checkout",
        detectedLanguage: "nodejs",
        detectedBrowserAutomationFramework: framework,
        detectedTestingFramework: framework === "cypress" ? "cypress" : "mocha",
        accessibility,
      }),
      {} as BrowserStackConfig,
    );
    return steps.map((step) => `${step.title}\n${step.content}`).join("\n\n");
  };

  it("adds accessibility: true under run_settings in Cypress's browserstack.json", async () => {
    const text = await setup("cypress", true);
    expect(text).toContain('"accessibility": true');
    expect(text).toMatch(/under run_settings/);
    expect(text).toMatch(/fetchAccessibilityIssues/);
  });

  it("adds accessibility: true to WebdriverIO's BrowserStack service options", async () => {
    const text = await setup("webdriverio", true);
    expect(text).toContain("accessibility: true");
    expect(text).toMatch(/browserstack service's options/);
    expect(text).toMatch(/fetchAccessibilityIssues/);
  });

  it("says nothing of accessibility when it is not asked for", async () => {
    for (const framework of ["cypress", "webdriverio"] as const) {
      const text = await setup(framework, false);
      expect(text).not.toMatch(/accessibility: true|"accessibility"|fetchAccessibilityIssues/);
    }
  });
});
