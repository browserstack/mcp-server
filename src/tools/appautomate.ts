import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { BrowserStackConfig } from "../lib/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { maybeCompressBase64 } from "../lib/utils.js";
import { remote } from "webdriverio";
import { AppTestPlatform } from "./appautomate-utils/native-execution/types.js";
import { setupAppAutomateHandler } from "./appautomate-utils/appium-sdk/handler.js";
import { validateAppAutomateDevices } from "./sdk-utils/common/device-validator.js";

import {
  SETUP_APP_AUTOMATE_DESCRIPTION,
  SETUP_APP_AUTOMATE_SCHEMA,
} from "./appautomate-utils/appium-sdk/constants.js";

import {
  PlatformDevices,
  Platform,
} from "./appautomate-utils/native-execution/types.js";

import {
  getDevicesAndBrowsers,
  BrowserStackProducts,
} from "../lib/device-cache.js";

import {
  findMatchingDevice,
  getDeviceVersions,
  resolveVersion,
  validateArgs,
  uploadApp,
  uploadEspressoApp,
  uploadEspressoTestSuite,
  triggerEspressoBuild,
  uploadXcuiApp,
  uploadXcuiTestSuite,
  triggerXcuiBuild,
} from "./appautomate-utils/native-execution/appautomate.js";
import {
  RUN_APP_AUTOMATE_DESCRIPTION,
  RUN_APP_AUTOMATE_SCHEMA,
} from "./appautomate-utils/native-execution/constants.js";

/**
 * Launches an app on a selected BrowserStack device and takes a screenshot.
 */
async function takeAppScreenshot(args: {
  desiredPlatform: Platform;
  desiredPlatformVersion: string;
  appPath?: string;
  desiredPhone: string;
  browserstackAppUrl?: string;
  config: BrowserStackConfig;
}): Promise<CallToolResult> {
  let driver;
  try {
    validateArgs(args);
    const {
      desiredPlatform,
      desiredPhone,
      appPath,
      browserstackAppUrl,
      config,
    } = args;
    let { desiredPlatformVersion } = args;

    const platforms = (
      await getDevicesAndBrowsers(BrowserStackProducts.APP_AUTOMATE)
    ).mobile as PlatformDevices[];

    const platformData = platforms.find(
      (p) => p.os === desiredPlatform.toLowerCase(),
    );

    if (!platformData) {
      throw new Error(`Platform ${desiredPlatform} not found in device cache.`);
    }

    const matchingDevices = findMatchingDevice(
      platformData.devices,
      desiredPhone,
    );

    const availableVersions = getDeviceVersions(matchingDevices);
    desiredPlatformVersion = resolveVersion(
      availableVersions,
      desiredPlatformVersion,
    );

    const selectedDevice = matchingDevices.find(
      (d) => d.os_version === desiredPlatformVersion,
    );

    if (!selectedDevice) {
      throw new Error(
        `Device "${desiredPhone}" with version ${desiredPlatformVersion} not found.`,
      );
    }
    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");

    let app_url: string;
    if (browserstackAppUrl) {
      app_url = browserstackAppUrl;
      logger.info(`Using provided BrowserStack app URL: ${app_url}`);
    } else {
      if (!appPath) {
        throw new Error(
          "appPath is required when browserstackAppUrl is not provided",
        );
      }
      app_url = await uploadApp(appPath, username, password);
      logger.info(`App uploaded. URL: ${app_url}`);
    }

    const capabilities = {
      platformName: desiredPlatform,
      "appium:platformVersion": selectedDevice.os_version,
      "appium:deviceName": selectedDevice.device,
      "appium:app": app_url,
      "appium:autoGrantPermissions": true,
      "bstack:options": {
        userName: username,
        accessKey: password,
        appiumVersion: "2.0.1",
      },
    };

    logger.info("Starting WebDriver session on BrowserStack...");
    try {
      driver = await remote({
        protocol: "https",
        hostname: "hub.browserstack.com",
        port: 443,
        path: "/wd/hub",
        capabilities,
      });
    } catch (error) {
      logger.error("Error initializing WebDriver:", error);
      throw new Error(
        "Failed to initialize the WebDriver or a timeout occurred. Please try again.",
      );
    }

    const screenshotBase64 = await driver.takeScreenshot();
    const compressed = await maybeCompressBase64(screenshotBase64);

    return {
      content: [
        {
          type: "image",
          data: compressed,
          mimeType: "image/png",
        },
      ],
    };
  } catch (error) {
    logger.error("Error during app automation or screenshot capture", error);
    throw error;
  } finally {
    if (driver) {
      logger.info("Cleaning up WebDriver session...");
      await driver.deleteSession();
    }
  }
}

//Runs AppAutomate tests on BrowserStack by uploading app and test suite, then triggering a test run.
async function runAppTestsOnBrowserStack(
  args: {
    appPath?: string;
    testSuitePath?: string;
    browserstackAppUrl?: string;
    browserstackTestSuiteUrl?: string;
    devices: Array<Array<string>>;
    project: string;
    detectedAutomationFramework: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Validate that either paths or URLs are provided for both app and test suite
  if (!args.browserstackAppUrl && !args.appPath) {
    throw new Error(
      "appPath is required when browserstackAppUrl is not provided",
    );
  }
  if (!args.browserstackTestSuiteUrl && !args.testSuitePath) {
    throw new Error(
      "testSuitePath is required when browserstackTestSuiteUrl is not provided",
    );
  }

  // Validate devices against real BrowserStack device data
  await validateAppAutomateDevices(args.devices);

  switch (args.detectedAutomationFramework) {
    case AppTestPlatform.ESPRESSO: {
      try {
        let app_url: string;
        if (args.browserstackAppUrl) {
          app_url = args.browserstackAppUrl;
          logger.info(`Using provided BrowserStack app URL: ${app_url}`);
        } else {
          app_url = await uploadEspressoApp(args.appPath!, config);
          logger.info(`App uploaded. URL: ${app_url}`);
        }

        let test_suite_url: string;
        if (args.browserstackTestSuiteUrl) {
          test_suite_url = args.browserstackTestSuiteUrl;
          logger.info(
            `Using provided BrowserStack test suite URL: ${test_suite_url}`,
          );
        } else {
          test_suite_url = await uploadEspressoTestSuite(
            args.testSuitePath!,
            config,
          );
          logger.info(`Test suite uploaded. URL: ${test_suite_url}`);
        }

        // Convert array format to string format for Espresso
        const deviceStrings = args.devices.map((device) => {
          const [, deviceName, osVersion] = device;
          return `${deviceName}-${osVersion}`;
        });

        const build_id = await triggerEspressoBuild(
          app_url,
          test_suite_url,
          deviceStrings,
          args.project,
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Espresso run started successfully!\n\n🔧 Build ID: ${build_id}\n🔗 View your build: https://app-automate.browserstack.com/builds/${build_id}`,
            },
          ],
        };
      } catch (err) {
        logger.error("Error running App Automate test", err);
        throw err;
      }
    }
    case AppTestPlatform.XCUITEST: {
      try {
        let app_url: string;
        if (args.browserstackAppUrl) {
          app_url = args.browserstackAppUrl;
          logger.info(`Using provided BrowserStack app URL: ${app_url}`);
        } else {
          app_url = await uploadXcuiApp(args.appPath!, config);
          logger.info(`App uploaded. URL: ${app_url}`);
        }

        let test_suite_url: string;
        if (args.browserstackTestSuiteUrl) {
          test_suite_url = args.browserstackTestSuiteUrl;
          logger.info(
            `Using provided BrowserStack test suite URL: ${test_suite_url}`,
          );
        } else {
          test_suite_url = await uploadXcuiTestSuite(
            args.testSuitePath!,
            config,
          );
          logger.info(`Test suite uploaded. URL: ${test_suite_url}`);
        }

        // Convert array format to string format for XCUITest
        const deviceStrings = args.devices.map((device) => {
          const [, deviceName, osVersion] = device;
          return `${deviceName}-${osVersion}`;
        });

        const build_id = await triggerXcuiBuild(
          app_url,
          test_suite_url,
          deviceStrings,
          args.project,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: `✅ XCUITest run started successfully!\n\n🔧 Build ID: ${build_id}\n🔗 View your build: https://app-automate.browserstack.com/builds/${build_id}`,
            },
          ],
        };
      } catch (err) {
        logger.error("Error running XCUITest App Automate test", err);
        throw err;
      }
    }
    default:
      throw new Error(
        `Unsupported automation framework: ${args.detectedAutomationFramework}. If you need support for this framework, please open an issue at Github`,
      );
  }
}

export default function addAppAutomationTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.takeAppScreenshot = server.tool(
    "takeAppScreenshot",
    "Use this tool to take a screenshot of an app running on a BrowserStack device. This is useful for visual testing and debugging.",
    {
      desiredPhone: z
        .string()
        .describe(
          "The full name of the device to run the app on. Example: 'iPhone 12 Pro' or 'Samsung Galaxy S20'. Always ask the user for the device they want to use.",
        ),
      desiredPlatformVersion: z
        .string()
        .describe(
          "The platform version to run the app on. Use 'latest' or 'oldest' for dynamic resolution.",
        ),
      desiredPlatform: z
        .enum([Platform.ANDROID, Platform.IOS])
        .describe("Platform to run the app on. Either 'android' or 'ios'."),
      appPath: z
        .string()
        .describe(
          "The path to the .apk or .ipa file. Required for app installation.",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "takeAppScreenshot",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await takeAppScreenshot({ ...args, config });
      } catch (error) {
        trackMCP(
          "takeAppScreenshot",
          server.server.getClientVersion()!,
          error,
          config,
        );
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error during app automation or screenshot capture: ${errorMessage}`,
            },
          ],
        };
      }
    },
  );

  tools.runAppTestsOnBrowserStack = server.tool(
    "runAppTestsOnBrowserStack",
    RUN_APP_AUTOMATE_DESCRIPTION,
    RUN_APP_AUTOMATE_SCHEMA,
    async (args) => {
      try {
        trackMCP(
          "runAppTestsOnBrowserStack",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        const devicesAsArrays: Array<Array<string>> = args.devices.map(
          (device) => [device.platform, device.deviceName, device.osVersion],
        );
        return await runAppTestsOnBrowserStack(
          { ...args, devices: devicesAsArrays },
          config,
        );
      } catch (error) {
        trackMCP(
          "runAppTestsOnBrowserStack",
          server.server.getClientVersion()!,
          error,
          config,
        );
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error running App Automate test: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  tools.setupBrowserStackAppAutomateTests = server.tool(
    "setupBrowserStackAppAutomateTests",
    SETUP_APP_AUTOMATE_DESCRIPTION,
    SETUP_APP_AUTOMATE_SCHEMA,
    async (args) => {
      try {
        return await setupAppAutomateHandler(args, config);
      } catch (error) {
        const error_message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Failed to bootstrap project with BrowserStack App Automate SDK. Error: ${error_message}. Please open an issue on GitHub if the problem persists`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
