import { z } from "zod";
import appConfig from "../../config.js";
import { TestStatus } from "./types.js";

/**
 * Base URL for the Automate test-runs API used by `listTestIds`. Process-startup
 * config resolved in `src/config.ts` from `BROWSERSTACK_AUTOMATION_BASE_URL`
 * (default prod). Set it to a rengg/staging host to list a build that lives
 * there. Read per call so a per-server-instance config is honored; never read
 * `process.env` here.
 */
export function getAutomationBaseUrl(): string {
  return appConfig.BROWSERSTACK_AUTOMATION_BASE_URL;
}

export const FETCH_RCA_PARAMS = {
  testId: z
    .array(z.number().int())
    .max(3)
    .describe(
      "Array of integer test IDs to fetch RCA data for (maximum 3 IDs). These must be numeric test IDs, not session IDs or strings. If not provided, use the listTestIds tool to get all failed testcases. If more than 3 IDs are provided, only the first 3 will be processed.",
    ),
};

export const GET_BUILD_ID_PARAMS = {
  browserStackProjectName: z
    .string()
    .describe(
      "The BrowserStack project name used during test run creation. Action: First, check browserstack.yml or any equivalent project configuration files. If the project name is found, extract and return it. If it is not found or if there is any uncertainty, immediately prompt the user to provide the value. Do not infer, guess, or assume a default.",
    ),
  browserStackBuildName: z
    .string()
    .describe(
      "The BrowserStack build name used during test run creation. Action: First, check browserstack.yml or any equivalent project configuration files. If the build name is found, extract and return it. If it is not found or if there is any uncertainty, immediately prompt the user to provide the value. Do not infer, guess, or assume a default.",
    ),
};

export const LIST_TEST_IDS_PARAMS = {
  buildId: z
    .string()
    .describe(
      "The Browserstack Build ID of the test run. If not known, use the getBuildId tool to fetch it using project and build name",
    ),
  status: z
    .nativeEnum(TestStatus)
    .describe(
      "Filter tests by status. If not provided, all tests are returned. Example for RCA usecase always use failed status",
    ),
  includeFailureDetail: z
    .boolean()
    .optional()
    .describe("Add per-test failure signature for clustering. Default false."),
};
