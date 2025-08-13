import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listTestFiles } from "./percy-snapshot-utils/detect-test-files.js";
import { testFilePathsMap } from "../lib/inmemory-store.js";
import crypto from "crypto";
import { ListTestFilesParamsShape } from "./percy-snapshot-utils/constants.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function addListTestFiles(args: any): Promise<CallToolResult> {
  const { dirs, language, framework } = args;
  let testFiles: string[] = [];

  for (const dir of dirs) {
    const files = await listTestFiles({
      language,
      framework,
      baseDir: dir,
    });
    testFiles = testFiles.concat(files);
  }

  if (testFiles.length === 0) {
    throw new Error("No test files found");
  }

  // Generate a UUID and store the test files in memory
  const uuid = crypto.randomUUID();
  testFilePathsMap.set(uuid, testFiles);

  return {
    content: [
      {
        type: "text",
        text: `The Test files are stored in memory with id ${uuid} and the total number of tests files found is ${testFiles.length}. You can use this UUID to retrieve the tests file paths later.`,
      },
      {
        type: "text",
        text: `You can now use the tool addPercySnapshotCommands to update the test file with Percy commands for visual testing with the UUID ${uuid}`,
      },
    ],
  };
}

export default function addListTestFilesTool(server: McpServer) {
  const tools: Record<string, any> = {};

  tools.listTestFiles = server.tool(
    "listTestFiles",
    "Lists all test files for a given set of directories.",
    ListTestFilesParamsShape,
    async (args) => {
      try {
        return await addListTestFiles(args);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error during fetching self-heal suggestions: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
