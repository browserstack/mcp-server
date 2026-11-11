import { listTestFiles } from "./percy-snapshot-utils/detect-test-files.js";
import { storedPercyResults } from "../lib/inmemory-store.js";
import { updateFileAndStep } from "./percy-snapshot-utils/utils.js";
import { percyWebSetupInstructions } from "./sdk-utils/percy-web/handler.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallerError } from "../lib/error.js";

export async function addListTestFiles(): Promise<CallToolResult> {
  const storedResults = storedPercyResults.get();
  if (!storedResults) {
    throw new CallerError(
      "No Framework details found. Please call expandPercyVisualTesting first to fetch the framework details.",
    );
  }

  const language = storedResults.detectedLanguage;
  const framework = storedResults.detectedTestingFramework;

  // Use stored paths from setUpPercy
  const dirs = storedResults.folderPaths;
  const files = storedResults.filePaths;

  let testFiles: string[] = [];

  if (files && files.length > 0) {
    testFiles = testFiles.concat(files);
  }

  if (dirs && dirs.length > 0) {
    for (const dir of dirs) {
      const discoveredFiles = await listTestFiles({
        language,
        framework,
        baseDir: dir,
      });
      testFiles = testFiles.concat(discoveredFiles);
    }
  }

  // Validate that we have at least one test file
  if (testFiles.length === 0) {
    throw new CallerError(
      "No test files found. Please provide either specific file paths (files) or directory paths (dirs) containing test files.",
    );
  }

  if (testFiles.length === 1) {
    const result = await updateFileAndStep(
      testFiles[0],
      0,
      1,
      percyWebSetupInstructions,
    );
    return {
      content: result,
    };
  }

  // For multiple files, store directly in testFiles
  const fileStatusMap: { [key: string]: boolean } = {};
  testFiles.forEach((file) => {
    fileStatusMap[file] = false; // false = not updated, true = updated
  });

  // Update storedPercyResults with test files
  const updatedStored = { ...storedResults };
  updatedStored.testFiles = fileStatusMap;
  storedPercyResults.set(updatedStored);

  return {
    content: [
      {
        type: "text",
        text: `The Test files are stored in memory and the total number of tests files found is ${testFiles.length}.`,
      },
      {
        type: "text",
        text: `You can now use the tool addPercySnapshotCommands to update the test file with Percy commands for visual testing.`,
      },
    ],
  };
}
