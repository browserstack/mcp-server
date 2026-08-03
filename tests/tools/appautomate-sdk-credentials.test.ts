import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAppSDKPrefixCommand,
  generateAppBrowserStackYMLInstructions,
  getAppInstructionsForProjectConfiguration,
} from "../../src/tools/appautomate-utils/appium-sdk/index";

// Every supported App Automate language/testing-framework combination.
const COMBOS: Array<[string, string[]]> = [
  [
    "java",
    ["testng", "cucumber", "junit4", "junit5", "jbehave", "selenide", "serenity"],
  ],
  ["python", ["pytest", "robot", "behave", "lettuce"]],
  ["nodejs", ["jest", "mocha", "cucumberJs", "webdriverio", "nightwatch"]],
  ["ruby", ["cucumberRuby"]],
];

const DECOY_USER = "decoy-username-must-not-leak";
const DECOY_KEY = "decoy-must-not-leak-into-output";

describe("App Automate SDK setup — no credential leakage", () => {
  const originalUser = process.env.BROWSERSTACK_USERNAME;
  const originalKey = process.env.BROWSERSTACK_ACCESS_KEY;

  beforeEach(() => {
    // If any generator ever reads process.env directly, these decoys surface it.
    process.env.BROWSERSTACK_USERNAME = DECOY_USER;
    process.env.BROWSERSTACK_ACCESS_KEY = DECOY_KEY;
  });

  afterEach(() => {
    process.env.BROWSERSTACK_USERNAME = originalUser;
    process.env.BROWSERSTACK_ACCESS_KEY = originalKey;
  });

  for (const [language, frameworks] of COMBOS) {
    for (const framework of frameworks) {
      it(`${language}/${framework}: emits placeholders, never real credentials`, () => {
        const rendered = [
          getAppSDKPrefixCommand(language as any, framework, "bs://sample.app"),
          generateAppBrowserStackYMLInstructions(
            {
              validatedEnvironments: [
                {
                  platform: "android",
                  deviceName: "Samsung Galaxy S24",
                  osVersion: "14",
                } as any,
              ],
              testingFramework: framework,
              projectName: "leak-test",
            },
            "bs://sample.app",
          ),
          getAppInstructionsForProjectConfiguration(
            "appium",
            framework as any,
            language as any,
          ),
        ].join("\n\n");

        // Positive assertion: the generators must actually produce setup text
        // (guards against the whole suite passing green on empty output) and
        // that text must carry the credential placeholder.
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered).toContain("<your_browserstack_username>");

        expect(rendered).not.toContain(DECOY_USER);
        expect(rendered).not.toContain(DECOY_KEY);
      });
    }
  }

  it("browserstack.yml uses env-var placeholders for credentials", () => {
    const yml = generateAppBrowserStackYMLInstructions(
      {
        validatedEnvironments: [
          {
            platform: "android",
            deviceName: "Samsung Galaxy S24",
            osVersion: "14",
          } as any,
        ],
        testingFramework: "testng",
        projectName: "leak-test",
      },
      "bs://sample.app",
    );
    expect(yml).toContain("<your_browserstack_username>");
    expect(yml).toContain("<your_browserstack_access_key>");
  });
});
