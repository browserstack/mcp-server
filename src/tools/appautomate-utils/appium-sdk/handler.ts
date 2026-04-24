import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { validateAppAutomateDevices } from "../../sdk-utils/common/device-validator.js";

import {
  getAppUploadInstruction,
  validateSupportforAppAutomate,
  SupportedFramework,
} from "./utils.js";

import {
  getAppSDKPrefixCommand,
  generateAppBrowserStackYMLInstructions,
} from "./index.js";

import {
  AppSDKSupportedLanguage,
  AppSDKSupportedTestingFramework,
  AppSDKInstruction,
  formatAppInstructionsWithNumbers,
  getAppInstructionsForProjectConfiguration,
  SETUP_APP_AUTOMATE_SCHEMA,
} from "./index.js";

export async function setupAppAutomateHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const input = z.object(SETUP_APP_AUTOMATE_SCHEMA).parse(rawInput);
  const auth = getBrowserStackAuth(config);
  const [username, accessKey] = auth.split(":");

  const instructions: AppSDKInstruction[] = [];

  // Use variables for all major input properties
  const testingFramework =
    input.detectedTestingFramework as AppSDKSupportedTestingFramework;
  const language = input.detectedLanguage as AppSDKSupportedLanguage;
  const inputDevices: Array<Array<string>> =
    input.devices?.map((device) => [
      device.platform,
      device.deviceName,
      device.osVersion,
    ]) ?? [];
  const appPath = input.appPath as string;
  const framework = input.detectedFramework as SupportedFramework;

  //Validating if supported framework or not
  validateSupportforAppAutomate(framework, language, testingFramework);

  // Use default mobile devices when array is empty
  const devices =
    inputDevices.length === 0
      ? [["android", "Samsung Galaxy S24", "latest"]]
      : inputDevices;

  // Validate devices against real BrowserStack device data
  const validatedEnvironments = await validateAppAutomateDevices(devices);

  // Extract platforms for backward compatibility (if needed)
  const platforms = validatedEnvironments.map((env) => env.platform);

  // Step 1: Generate SDK setup command
  const sdkCommand = getAppSDKPrefixCommand(
    language,
    testingFramework,
    username,
    accessKey,
    appPath,
  );

  if (sdkCommand) {
    instructions.push({ content: sdkCommand, type: "setup" });
  }

  // Step 2: Generate browserstack.yml configuration
  const configInstructions = generateAppBrowserStackYMLInstructions(
    {
      validatedEnvironments,
      platforms,
      testingFramework,
      projectName: input.project as string,
    },
    username,
    accessKey,
    appPath,
  );

  if (configInstructions) {
    instructions.push({ content: configInstructions, type: "config" });
  }

  // Step 3: Generate app upload instruction
  const appUploadInstruction = await getAppUploadInstruction(
    appPath,
    username,
    accessKey,
    testingFramework,
  );

  if (appUploadInstruction) {
    instructions.push({ content: appUploadInstruction, type: "setup" });
  }

  // Step 4: Generate project configuration and run instructions
  const projectInstructions = getAppInstructionsForProjectConfiguration(
    framework,
    testingFramework,
    language,
  );

  if (projectInstructions) {
    instructions.push({ content: projectInstructions, type: "run" });
  }

  const combinedInstructions = instructions
    .map((instruction) => instruction.content)
    .join("\n\n");

  return {
    content: [
      {
        type: "text",
        text: formatAppInstructionsWithNumbers(combinedInstructions),
      },
    ],
    isError: false,
  };
}
