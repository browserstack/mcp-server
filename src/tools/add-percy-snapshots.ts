import { storedPercyResults } from "../lib/inmemory-store.js";
import { updateFileAndStep } from "./percy-snapshot-utils/utils.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { percyWebSetupInstructions } from "../tools/sdk-utils/percy-web/handler.js";
import { CallerError } from "../lib/error.js";

export async function updateTestsWithPercyCommands(args: {
  index: number;
}): Promise<CallToolResult> {
  const { index } = args;
  const stored = storedPercyResults.get();
  if (!stored || !stored.testFiles) {
    throw new CallerError(
      `No test files found in memory. Please call listTestFiles first.`,
    );
  }

  const fileStatusMap = stored.testFiles;
  const filePaths = Object.keys(fileStatusMap);

  if (index < 0 || index >= filePaths.length) {
    throw new CallerError(
      `Invalid index: ${index}. There are ${filePaths.length} files available.`,
    );
  }

  const result = await updateFileAndStep(
    filePaths[index],
    index,
    filePaths.length,
    percyWebSetupInstructions,
  );

  const updatedStored = { ...stored };
  updatedStored.testFiles[filePaths[index]] = true; // true = updated
  storedPercyResults.set(updatedStored);

  return {
    content: result,
  };
}
