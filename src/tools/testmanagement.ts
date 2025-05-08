import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation";
import logger from "../logger";
import {
  createProjectOrFolder,
  CreateProjFoldSchema,
} from "./testmanagement-utils/create-project-folder";
import {
  createTestCase as createTestCaseAPI,
  TestCaseCreateRequest,
  sanitizeArgs,
  CreateTestCaseSchema,
} from "./testmanagement-utils/create-testcase";

let serverInstance: McpServer;

/**
 * Wrapper to call createProjectOrFolder util.
 */
export async function createProjectOrFolderTool(
  args: z.infer<typeof CreateProjFoldSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createProjectOrFolder",
      serverInstance.server.getClientVersion()!
    );
    return await createProjectOrFolder(args);
  } catch (err) {
    logger.error("Failed to create project/folder: %s", err);
    trackMCP(
      "createProjectOrFolder",
      serverInstance.server.getClientVersion()!,
      err
    );
    return {
      content: [
        {
          type: "text",
          text: `Failed to create project/folder: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
          isError: true,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Creates a test case in BrowserStack Test Management.
 */
export async function createTestCaseTool(
  args: TestCaseCreateRequest,
): Promise<CallToolResult> {
  // Sanitize input arguments
  const cleanedArgs = sanitizeArgs(args);
  try {
    trackMCP("createTestCase", serverInstance.server.getClientVersion()!);
    return await createTestCaseAPI(cleanedArgs);
  } catch (err) {
    logger.error("Failed to create test case: %s", err);
    trackMCP(
      "createTestCase",
      serverInstance.server.getClientVersion()!,
      err
    );
    return {
      content: [
        {
          type: "text",
          text: `Failed to create test case: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
          isError: true,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Registers both project/folder and test-case tools.
 */
export default function addTestManagementTools(server: McpServer) {
  serverInstance = server;
  server.tool(
    "createProjectOrFolder",
    "Create a project and/or folder in BrowserStack Test Management.",
    CreateProjFoldSchema.shape,
    createProjectOrFolderTool,
  );

  server.tool(
    "createTestCase",
    "Use this tool to create a test case in BrowserStack Test Management.",
    CreateTestCaseSchema.shape,
    createTestCaseTool,
  );
}
