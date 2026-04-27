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

import {
  updateTestCase as updateTestCaseAPI,
  TestCaseUpdateRequest,
  UpdateTestCaseSchema,
} from "./testmanagement-utils/update-testcase.js";

import {
  listTestCases,
  ListTestCasesSchema,
} from "./testmanagement-utils/list-testcases.js";

import {
  listFolders,
  ListFoldersSchema,
} from "./testmanagement-utils/list-folders.js";

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

import {
  UploadFileSchema,
  uploadFile,
} from "./testmanagement-utils/upload-file.js";

import { createTestCasesFromFile } from "./testmanagement-utils/testcase-from-file.js";
import { CreateTestCasesFromFileSchema } from "./testmanagement-utils/TCG-utils/types.js";

import {
  createLCASteps,
  CreateLCAStepsSchema,
} from "./testmanagement-utils/create-lca-steps.js";

import {
  listTestPlans,
  ListTestPlansSchema,
} from "./testmanagement-utils/list-testplans.js";

import {
  getTestPlan,
  GetTestPlanSchema,
} from "./testmanagement-utils/get-testplan.js";

import { BrowserStackConfig } from "../lib/types.js";

//TODO: Moving the traceMCP and catch block to the parent(server) function

/**
 * Wrapper to call createProjectOrFolder util.
 */
export async function createProjectOrFolderTool(
  args: z.infer<typeof CreateProjFoldSchema>,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createProjectOrFolder",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await createProjectOrFolder(args, config);
  } catch (err) {
    logger.error("Failed to create project/folder: %s", err);
    trackMCP(
      "createProjectOrFolder",
      server.server.getClientVersion()!,
      err,
      config,
    );
    return {
      content: [
        {
          type: "text",
          text: `Failed to create project/folder: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
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
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  // Sanitize input arguments
  const cleanedArgs = sanitizeArgs(args);
  try {
    trackMCP(
      "createTestCase",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await createTestCaseAPI(cleanedArgs, config);
  } catch (err) {
    logger.error("Failed to create test case: %s", err);
    trackMCP("createTestCase", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create test case: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Updates an existing test case in BrowserStack Test Management.
 */
export async function updateTestCaseTool(
  args: TestCaseUpdateRequest,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "updateTestCase",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await updateTestCaseAPI(args, config);
  } catch (err) {
    logger.error("Failed to update test case: %s", err);
    trackMCP("updateTestCase", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to update test case: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
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
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "listTestCases",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await listTestCases(args, config);
  } catch (err) {
    trackMCP("listTestCases", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to list test cases: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Lists folders in a project (or sub-folders under a parent folder).
 */
export async function listFoldersTool(
  args: z.infer<typeof ListFoldersSchema>,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "listFolders",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await listFolders(args, config);
  } catch (err) {
    trackMCP("listFolders", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to list folders: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
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
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createTestRun",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await createTestRun(args, config);
  } catch (err) {
    trackMCP("createTestRun", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create test run: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
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
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "listTestRuns",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await listTestRuns(args, config);
  } catch (err) {
    trackMCP("listTestRuns", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to list test runs: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
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
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "updateTestRun",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await updateTestRun(args, config);
  } catch (err) {
    trackMCP("updateTestRun", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to update test run: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
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
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "addTestResult",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await addTestResult(args, config);
  } catch (err) {
    trackMCP("addTestResult", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to add test result: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Uploads files such as PDRs or screenshots to BrowserStack Test Management and get file mapping ID back.
 */
export async function uploadProductRequirementFileTool(
  args: z.infer<typeof UploadFileSchema>,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "uploadProductRequirementFile",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await uploadFile(args, config);
  } catch (err) {
    trackMCP(
      "uploadProductRequirementFile",
      server.server.getClientVersion()!,
      err,
      config,
    );
    return {
      content: [
        {
          type: "text",
          text: `Failed to upload file: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Creates test cases from a file in BrowserStack Test Management.
 */
export async function createTestCasesFromFileTool(
  args: z.infer<typeof CreateTestCasesFromFileSchema>,
  context: any,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createTestCasesFromFile",
      server.server.getClientVersion()!,
      undefined,
    );
    return await createTestCasesFromFile(args, context, config);
  } catch (err) {
    trackMCP("createTestCasesFromFile", server.server.getClientVersion()!, err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create test cases from file: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Creates LCA (Low Code Automation) steps for a test case in BrowserStack Test Management.
 */
export async function createLCAStepsTool(
  args: z.infer<typeof CreateLCAStepsSchema>,
  context: any,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createLCASteps",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await createLCASteps(args, context, config);
  } catch (err) {
    trackMCP("createLCASteps", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create LCA steps: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Lists test plans in a project.
 */
export async function listTestPlansTool(
  args: z.infer<typeof ListTestPlansSchema>,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "listTestPlans",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await listTestPlans(args, config);
  } catch (err) {
    logger.error("Failed to list test plans: %s", err);
    trackMCP("listTestPlans", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to list test plans: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Fetches a test plan by identifier, with its linked runs and a derived status summary.
 */
export async function getTestPlanTool(
  args: z.infer<typeof GetTestPlanSchema>,
  config: BrowserStackConfig,
  server: McpServer,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "getTestPlan",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await getTestPlan(args, config);
  } catch (err) {
    logger.error("Failed to fetch test plan: %s", err);
    trackMCP("getTestPlan", server.server.getClientVersion()!, err, config);
    return {
      content: [
        {
          type: "text",
          text: `Failed to fetch test plan: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Please open an issue on GitHub if the problem persists`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Registers both project/folder and test-case tools.
 */
export default function addTestManagementTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.createProjectOrFolder = server.tool(
    "createProjectOrFolder",
    "Create a project and/or folder in BrowserStack Test Management.",
    CreateProjFoldSchema.shape,
    (args) => createProjectOrFolderTool(args, config, server),
  );

  tools.createTestCase = server.tool(
    "createTestCase",
    "Use this tool to create a test case in BrowserStack Test Management.",
    CreateTestCaseSchema.shape,
    (args) => createTestCaseTool(args, config, server),
  );

  tools.updateTestCase = server.tool(
    "updateTestCase",
    "Update an existing test case in BrowserStack Test Management. Any subset of the following fields may be changed: name, description, preconditions, test_case_steps, owner, priority, case_type, automation_status, status, tags, issues, custom_fields. Only the supplied fields are modified.",
    UpdateTestCaseSchema.shape,
    (args) => updateTestCaseTool(args, config, server),
  );

  tools.listTestCases = server.tool(
    "listTestCases",
    "List test cases in a project, optionally scoped to a specific folder. Omit folder_id to list all test cases in the project; provide folder_id (discoverable via listFolders) to list only that folder's cases. Supports filters: case_type, priority, pagination.",
    ListTestCasesSchema.shape,
    (args) => listTestCasesTool(args, config, server),
  );

  tools.listFolders = server.tool(
    "listFolders",
    "List folders in a BrowserStack Test Management project, returning each folder's id and name (plus case counts and sub-folder counts). Pass parent_id to list sub-folders under a specific folder instead of top-level folders.",
    ListFoldersSchema.shape,
    (args) => listFoldersTool(args, config, server),
  );

  tools.createTestRun = server.tool(
    "createTestRun",
    "Create a test run in BrowserStack Test Management.",
    CreateTestRunSchema.shape,
    (args) => createTestRunTool(args, config, server),
  );

  tools.listTestRuns = server.tool(
    "listTestRuns",
    "List test runs in a project with optional filters (date ranges, assignee, state, etc.)",
    ListTestRunsSchema.shape,
    (args) => listTestRunsTool(args, config, server),
  );

  tools.updateTestRun = server.tool(
    "updateTestRun",
    "Update a test run in BrowserStack Test Management.",
    UpdateTestRunSchema.shape,
    (args) => updateTestRunTool(args, config, server),
  );

  tools.addTestResult = server.tool(
    "addTestResult",
    "Add a test result to a specific test run via BrowserStack Test Management API.",
    AddTestResultSchema.shape,
    (args) => addTestResultTool(args, config, server),
  );

  tools.uploadProductRequirementFile = server.tool(
    "uploadProductRequirementFile",
    "Upload files (e.g., PDRs, PDFs) to BrowserStack Test Management and retrieve a file mapping ID. This is utilized for generating test cases from files and is part of the Test Case Generator AI Agent in BrowserStack.",
    UploadFileSchema.shape,
    (args) => uploadProductRequirementFileTool(args, config, server),
  );

  tools.createTestCasesFromFile = server.tool(
    "createTestCasesFromFile",
    "Generate test cases from a file in BrowserStack Test Management using the Test Case Generator AI Agent.",
    CreateTestCasesFromFileSchema.shape,
    (args, context) =>
      createTestCasesFromFileTool(args, context, config, server),
  );

  tools.createLCASteps = server.tool(
    "createLCASteps",
    "Generate Low Code Automation (LCA) steps for a test case in BrowserStack Test Management using the Low Code Automation Agent.",
    CreateLCAStepsSchema.shape,
    (args, context) => createLCAStepsTool(args, context, config, server),
  );

  tools.listTestPlans = server.tool(
    "listTestPlans",
    "List test plans in a BrowserStack Test Management project. Returns each plan's identifier (TP-*), name, status, description, dates, and active/closed test-run counts. Supports pagination.",
    ListTestPlansSchema.shape,
    (args) => listTestPlansTool(args, config, server),
  );

  tools.getTestPlan = server.tool(
    "getTestPlan",
    "Fetch a test plan by identifier (TP-*) from BrowserStack Test Management. Returns plan metadata, the full list of linked test runs, total test-case count across runs, and a status summary — suitable for generating test documentation or QA status reports.",
    GetTestPlanSchema.shape,
    (args) => getTestPlanTool(args, config, server),
  );

  return tools;
}
