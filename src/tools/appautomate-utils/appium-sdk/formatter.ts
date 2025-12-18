import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { STEP_DELIMITER } from "./constants.js";

export function formatFinalAppInstructions(
  formattedInstructions: string,
): CallToolResult {
  const fullInstructions = `
⚠️ IMPORTANT: DO NOT SKIP ANY STEP
All the setup steps described in this file MUST be executed regardless of any existing configuration or setup.
This ensures proper BrowserStack App Automate SDK setup.
Each step is compulsory and sequence needs to be maintained.

${formattedInstructions}`;

  return {
    content: [
      {
        type: "text",
        text: fullInstructions,
      },
    ],
  };
}

export function createStep(title: string, content: string): string {
  return `${STEP_DELIMITER}
${title}

${content}`;
}

export function combineInstructions(...instructionParts: string[]): string {
  return instructionParts.filter(Boolean).join("\n\n");
}

export function formatEnvCommands(
  username: string,
  accessKey: string,
  isWindows: boolean,
): string {
  if (isWindows) {
    return `\`\`\`cmd
setx BROWSERSTACK_USERNAME "${username}"
setx BROWSERSTACK_ACCESS_KEY "${accessKey}"
\`\`\``;
  }
  return `\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\``;
}

export function createEnvStep(
  username: string,
  accessKey: string,
  isWindows: boolean,
  platformLabel: string,
  title: string = "Set BrowserStack credentials as environment variables:",
): string {
  return createStep(
    title,
    `**${platformLabel}:**
${formatEnvCommands(username, accessKey, isWindows)}`,
  );
}

export function formatMultiLineCommand(
  command: string,
  isWindows: boolean = process.platform === "win32",
): string {
  if (isWindows) {
    // For Windows, keep commands on single line
    return command.replace(/\s*\\\s*\n\s*/g, " ");
  }
  return command;
}

export function formatAppInstructionsWithNumbers(instructions: string): string {
  const steps = instructions
    .split(STEP_DELIMITER)
    .filter((step) => step.trim());

  return steps
    .map((step, index) => `**Step ${index + 1}:**\n${step.trim()}`)
    .join("\n\n");
}
