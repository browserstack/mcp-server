import { trackMCP } from "../index.js";
import { BrowserStackConfig } from "../lib/types.js";
import { fetchPercyChanges } from "./percy-change.js";
import { addListTestFiles } from "./list-test-files.js";
import { runPercyScan } from "./run-percy-scan.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SetUpPercyParamsShape } from "./sdk-utils/common/schema.js";
import { updateTestsWithPercyCommands } from "./add-percy-snapshots.js";
import { approveOrDeclinePercyBuild } from "./review-agent-utils/percy-approve-reject.js";
import { setUpPercyHandler } from "./sdk-utils/handler.js";

import {
  SETUP_PERCY_DESCRIPTION,
  LIST_TEST_FILES_DESCRIPTION,
  PERCY_SNAPSHOT_COMMANDS_DESCRIPTION,
} from "./sdk-utils/common/constants.js";

import {
  ListTestFilesParamsShape,
  UpdateTestFileWithInstructionsParams,
} from "./percy-snapshot-utils/constants.js";

import {
  RunPercyScanParamsShape,
  FetchPercyChangesParamsShape,
  ManagePercyBuildApprovalParamsShape,
} from "./sdk-utils/common/schema.js";

export function registerPercyTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  // Register setupPercyVisualTesting
  tools.setupPercyVisualTesting = server.tool(
    "setupPercyVisualTesting",
    SETUP_PERCY_DESCRIPTION,
    SetUpPercyParamsShape,
    async (args) => {
      try {
        trackMCP(
          "setupPercyVisualTesting",
          server.server.getClientVersion()!,
          config,
        );
        return setUpPercyHandler(args, config);
      } catch (error) {
        trackMCP(
          "setupPercyVisualTesting",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Register addPercySnapshotCommands
  tools.addPercySnapshotCommands = server.tool(
    "addPercySnapshotCommands",
    PERCY_SNAPSHOT_COMMANDS_DESCRIPTION,
    UpdateTestFileWithInstructionsParams,
    async (args) => {
      try {
        trackMCP(
          "addPercySnapshotCommands",
          server.server.getClientVersion()!,
          config,
        );
        return await updateTestsWithPercyCommands(args);
      } catch (error) {
        trackMCP(
          "addPercySnapshotCommands",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Register listTestFiles
  tools.listTestFiles = server.tool(
    "listTestFiles",
    LIST_TEST_FILES_DESCRIPTION,
    ListTestFilesParamsShape,
    async (args) => {
      try {
        trackMCP("listTestFiles", server.server.getClientVersion()!, config);
        return addListTestFiles(args);
      } catch (error) {
        trackMCP(
          "listTestFiles",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );

  tools.runPercyScan = server.tool(
    "runPercyScan",
    "Run a Percy visual test scan. Example prompts : Run this Percy build/scan. Never run percy scan/build without this tool",
    RunPercyScanParamsShape,
    async (args) => {
      return runPercyScan(args, config);
    },
  );

  tools.fetchPercyChanges = server.tool(
    "fetchPercyChanges",
    "Retrieves and summarizes all visual changes detected by Percy between the latest and previous builds, helping quickly review what has changed in your project.",
    FetchPercyChangesParamsShape,
    async (args) => {
      return await fetchPercyChanges(args, config);
    },
  );

  tools.managePercyBuildApproval = server.tool(
    "managePercyBuildApproval",
    "Approve or reject a Percy build",
    ManagePercyBuildApprovalParamsShape,
    async (args) => {
      return await approveOrDeclinePercyBuild(args, config);
    },
  );

  return tools;
}

export default registerPercyTools;
