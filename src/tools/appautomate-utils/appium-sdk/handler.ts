import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import {
  AppSDKSupportedLanguage,
  AppSDKSupportedTestingFramework,
  AppSDKInstruction,
  formatAppInstructionsWithNumbers,
  getAppInstructionsForProjectConfiguration,
  SETUP_APP_AUTOMATE_SCHEMA,
} from "./index.js";
import {
  getAppSDKPrefixCommand,
  generateAppBrowserStackYMLInstructions,
} from "./index.js";
import { getAppUploadInstruction } from "./utils.js";
import logger from "../../../logger.js";

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
  const platforms = (input.desiredPlatforms as string[]) ?? ["android"];
  const appPath = input.appPath as string;
  const framework = input.detectedFramework as string;

  logger.info("Generating SDK setup command...");
  logger.debug(`Input: ${JSON.stringify(input)}`);

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
    platforms,
    username,
    accessKey,
    appPath,
    testingFramework,
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
        isError: false,
      },
    ],
    isError: false,
  };
}
