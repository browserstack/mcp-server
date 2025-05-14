import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import logger from "../logger.js";
import {
  createProjectOrFolder,
  CreateProjFoldSchema,
} from "./testmanagement-utils/create-project-folder.js";
import {
  createTestCase as createTestCaseAPI,
  TestCaseCreateRequest,
  sanitizeArgs,
  CreateTestCaseSchema,
} from "./testmanagement-utils/create-testcase.js";

let serverInstance: McpServer;

import {
  listTestCases,
  ListTestCasesSchema,
} from "./testmanagement-utils/list-testcases.js";

import {
  CreateTestRunSchema,
  createTestRun,
} from "./testmanagement-utils/create-testrun.js";

import {
  ListTestRunsSchema,
  listTestRuns,
} from "./testmanagement-utils/list-testruns.js";

import {
  UpdateTestRunSchema,
  updateTestRun,
} from "./testmanagement-utils/update-testrun.js";

import {
  addTestResult,
  AddTestResultSchema,
} from "./testmanagement-utils/add-test-result.js";

/**
 * Wrapper to call createProjectOrFolder util.
 */
export async function createProjectOrFolderTool(
  args: z.infer<typeof CreateProjFoldSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createProjectOrFolder",
      serverInstance.server.getClientVersion()!,
    );
    return await createProjectOrFolder(args);
  } catch (err) {
    logger.error("Failed to create project/folder: %s", err);
    trackMCP(
      "createProjectOrFolder",
      serverInstance.server.getClientVersion()!,
      err,
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
    trackMCP("createTestCase", serverInstance.server.getClientVersion()!, err);
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
 * Lists test cases in a project with optional filters (status, priority, custom fields, etc.)
 */

export async function listTestCasesTool(
  args: z.infer<typeof ListTestCasesSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP("listTestCases", serverInstance.server.getClientVersion()!);
    return await listTestCases(args);
  } catch (err) {
    trackMCP("listTestCases", serverInstance.server.getClientVersion()!, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to list test cases: ${
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
 * Creates a test run in BrowserStack Test Management.
 */
export async function createTestRunTool(
  args: z.infer<typeof CreateTestRunSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP("createTestRun", serverInstance.server.getClientVersion()!);
    return await createTestRun(args);
  } catch (err) {
    trackMCP("createTestRun", serverInstance.server.getClientVersion()!, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create test run: ${
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
 * Lists test runs in a project with optional filters (date ranges, assignee, state, etc.)
 */
export async function listTestRunsTool(
  args: z.infer<typeof ListTestRunsSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP("listTestRuns", serverInstance.server.getClientVersion()!);
    return await listTestRuns(args);
  } catch (err) {
    trackMCP("listTestRuns", serverInstance.server.getClientVersion()!, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to list test runs: ${
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
 * Updates a test run in BrowserStack Test Management.
 * This function allows for partial updates to an existing test run.
 * It takes the project identifier and test run ID as parameters.
 */
export async function updateTestRunTool(
  args: z.infer<typeof UpdateTestRunSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP("updateTestRun", serverInstance.server.getClientVersion()!);
    return await updateTestRun(args);
  } catch (err) {
    trackMCP("updateTestRun", serverInstance.server.getClientVersion()!, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to update test run: ${
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
 * Adds a test result to a specific test run via BrowserStack Test Management API.
 */
export async function addTestResultTool(
  args: z.infer<typeof AddTestResultSchema>,
): Promise<CallToolResult> {
  try {
    trackMCP("addTestResult", serverInstance.server.getClientVersion()!);
    return await addTestResult(args);
  } catch (err) {
    trackMCP("addTestResult", serverInstance.server.getClientVersion()!, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to add test result: ${
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

  server.tool(
    "listTestCases",
    "List test cases in a project with optional filters (status, priority, custom fields, etc.)",
    ListTestCasesSchema.shape,
    listTestCasesTool,
  );

  server.tool(
    "createTestRun",
    "Create a test run in BrowserStack Test Management.",
    CreateTestRunSchema.shape,
    createTestRunTool,
  );

  server.tool(
    "listTestRuns",
    "List test runs in a project with optional filters (date ranges, assignee, state, etc.)",
    ListTestRunsSchema.shape,
    listTestRunsTool,
  );
  server.tool(
    "updateTestRun",
    "Update a test run in BrowserStack Test Management.",
    UpdateTestRunSchema.shape,
    updateTestRunTool,
  );
  server.tool(
    "addTestResult",
    "Add a test result to a specific test run via BrowserStack Test Management API.",
    AddTestResultSchema.shape,
    addTestResultTool,
  );
}
