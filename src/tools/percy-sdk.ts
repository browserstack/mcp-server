import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../lib/types.js";
import { SetUpPercyParamsShape } from "./sdk-utils/common/schema.js";
import { updateTestsWithPercyCommands } from "./add-percy-snapshots.js";
import { addListTestFiles } from "./list-test-files.js";
import { trackMCP } from "../index.js";
import {
  setUpPercyHandler,
  setUpSimulatePercyChangeHandler,
} from "./sdk-utils/handler.js";
import {
  SETUP_PERCY_DESCRIPTION,
  SIMULATE_PERCY_CHANGE_DESCRIPTION,
  LIST_TEST_FILES_DESCRIPTION,
  PERCY_SNAPSHOT_COMMANDS_DESCRIPTION,
} from "./sdk-utils/common/constants.js";
import {
  ListTestFilesParamsShape,
  UpdateTestFileWithInstructionsParams,
} from "./percy-snapshot-utils/constants.js";

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

  // Register simulatePercyChange
  tools.simulatePercyChange = server.tool(
    "simulatePercyChange",
    SIMULATE_PERCY_CHANGE_DESCRIPTION,
    SetUpPercyParamsShape,
    async (args) => {
      try {
        trackMCP(
          "simulatePercyChange",
          server.server.getClientVersion()!,
          config,
        );
        return setUpSimulatePercyChangeHandler(args, config);
      } catch (error) {
        trackMCP(
          "simulatePercyChange",
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

  return tools;
}

export default registerPercyTools;
