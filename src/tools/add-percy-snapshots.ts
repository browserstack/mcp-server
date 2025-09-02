import { testFilePathsMap } from "../lib/inmemory-store.js";
import { updateFileAndStep } from "./percy-snapshot-utils/utils.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { percyWebSetupInstructions } from "../tools/sdk-utils/percy-web/handler.js";

export async function updateTestsWithPercyCommands(args: {
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
