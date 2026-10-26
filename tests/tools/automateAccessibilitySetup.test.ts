import { describe, expect, it } from "vitest";

import { generateBrowserStackYMLInstructions } from "../../src/tools/sdk-utils/bstack/configUtils.js";
import { RunTestsOnBrowserStackSchema } from "../../src/tools/sdk-utils/common/schema.js";

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
