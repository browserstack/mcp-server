import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PercyIntegrationTypeEnum } from "./sdk-utils/common/types.js";
import { BrowserStackConfig } from "../lib/types.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { fetchPercyToken } from "./sdk-utils/percy-web/fetchPercyToken.js";

export async function runPercyScan(
  args: {
    projectName: string;
    integrationType: PercyIntegrationTypeEnum;
    instruction?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { projectName, integrationType, instruction } = args;
  const authorization = getBrowserStackAuth(config);
  const percyToken = await fetchPercyToken(projectName, authorization, {
    type: integrationType,
  });

  const steps: string[] = [generatePercyTokenInstructions(percyToken)];

  if (instruction) {
    steps.push(
      `Use the provided test command with Percy:\n${instruction}`,
      `If this command fails or is incorrect, fall back to the default approach below.`,
    );
  }

  steps.push(
    `Attempt to infer the project's test command from context (high confidence commands first):
- Java → mvn test
- Python → pytest
- Node.js → npm test or yarn test
- Cypress → cypress run
or from package.json scripts`,
    `Wrap the inferred command with Percy:\nnpx percy exec -- <test command>`,
    `If the test command cannot be inferred confidently, ask the user directly for the correct test command.`,
  );

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

function generatePercyTokenInstructions(percyToken: string): string {
  return `Set the environment variable for your project:

export PERCY_TOKEN="${percyToken}"

(For Windows: use 'setx PERCY_TOKEN "${percyToken}"' or 'set PERCY_TOKEN=${percyToken}' as appropriate.)`;
}
