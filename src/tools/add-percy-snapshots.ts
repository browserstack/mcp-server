import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { testFilePathsMap } from "../lib/inmemory-store.js";
import { UpdateTestFileWithInstructionsParams } from "./percy-snapshot-utils/constants.js";
import { updateFileAndStep } from "./percy-snapshot-utils/utils.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { percyWebSetupInstructions } from "../tools/sdk-utils/percy-web/handler.js";

async function updateTestsWithPercyCommands(args: {
  uuid: string;
  index: number;
}): Promise<CallToolResult> {
  const { uuid, index } = args;
  const filePaths = testFilePathsMap.get(uuid);

  if (!filePaths) {
    throw new Error(`No test files found in memory for UUID: ${uuid}`);
  }
  if (index < 0 || index >= filePaths.length) {
    throw new Error(
      `Invalid index: ${index}. There are ${filePaths.length} files for UUID: ${uuid}`,
    );
  }
  const result = await updateFileAndStep(
    filePaths[index],
    index,
    filePaths.length,
    percyWebSetupInstructions,
  );

  return {
    content: result,
  };
}

export default function addPercySnapshotTools(server: McpServer) {
  const tools: Record<string, any> = {};

  tools.addPercySnapshotCommands = server.tool(
    "addPercySnapshotCommands",
    "Adds Percy snapshot commands to the specified test files.",
    UpdateTestFileWithInstructionsParams,
    async (args) => {
      return await updateTestsWithPercyCommands(args);
    },
  );

  return tools;
}
