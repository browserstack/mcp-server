import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PercyIntegrationTypeEnum } from "./sdk-utils/common/types.js";
import { storedPercyResults } from "../lib/inmemory-store.js";
import {
  getFrameworkTestCommand,
  PERCY_FALLBACK_STEPS,
} from "./sdk-utils/percy-web/constants.js";
import path from "path";

export async function runPercyScan(args: {
  projectName: string;
  integrationType: PercyIntegrationTypeEnum;
  instruction?: string;
}): Promise<CallToolResult> {
  const { projectName, instruction } = args;

  // Check if we have stored data and project matches
  const stored = storedPercyResults.get();

  // Compute if we have updated files to run
  const hasUpdatedFiles = checkForUpdatedFiles(stored, projectName);
  const updatedFiles = hasUpdatedFiles ? getUpdatedFiles(stored) : [];

  // Build steps array with conditional spread
  const steps = [
    generatePercyTokenInstructions(),
    ...(hasUpdatedFiles ? generateUpdatedFilesSteps(stored, updatedFiles) : []),
    ...(instruction && !hasUpdatedFiles
      ? generateInstructionSteps(instruction)
      : []),
    ...(!hasUpdatedFiles ? PERCY_FALLBACK_STEPS : []),
  ];

  const instructionContext = steps
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n\n");

  return {
    content: [
      {
        type: "text",
        text: instructionContext,
      },
    ],
  };
}

function generatePercyTokenInstructions(): string {
  return `Set the PERCY_TOKEN environment variable for your project. Retrieve your project's token from the Percy dashboard (https://percy.io → Project Settings → Project Token) and add it to your project's .env file (PERCY_TOKEN=<your Percy project token>) or export it in your shell:

  - macOS/Linux:    export PERCY_TOKEN="<your Percy project token>"
  - Windows (PS):   $env:PERCY_TOKEN="<your Percy project token>"
  - Windows (CMD):  set PERCY_TOKEN=<your Percy project token>

Do not paste the token into chat or commit it.`;
}

const toAbs = (p: string): string | undefined =>
  p ? path.resolve(p) : undefined;

function checkForUpdatedFiles(
  stored: any, // storedPercyResults structure
  projectName: string,
): boolean {
  const projectMatches = stored?.projectName === projectName;
  return (
    projectMatches &&
    stored?.testFiles &&
    Object.values(stored.testFiles).some((status) => status === true)
  );
}

function getUpdatedFiles(stored: any): string[] {
  const updatedFiles: string[] = [];
  const fileStatusMap = stored.testFiles;

  Object.entries(fileStatusMap).forEach(([filePath, status]) => {
    if (status === true) {
      updatedFiles.push(filePath);
    }
  });

  return updatedFiles;
}

function generateUpdatedFilesSteps(
  stored: any,
  updatedFiles: string[],
): string[] {
  const filesToRun = updatedFiles.map(toAbs).filter(Boolean) as string[];
  const { detectedLanguage, detectedTestingFramework } = stored;
  const exampleCommand = getFrameworkTestCommand(
    detectedLanguage,
    detectedTestingFramework,
  );

  return [
    `Run only the updated files with Percy:\n` +
      `Example: ${exampleCommand} <file1> <file2> ...`,
    `Updated files to run:\n${filesToRun.join("\n")}`,
  ];
}

function generateInstructionSteps(instruction: string): string[] {
  return [
    `Use the provided test command with Percy:\n${instruction}`,
    `If this command fails or is incorrect, fall back to the default approach below.`,
  ];
}
