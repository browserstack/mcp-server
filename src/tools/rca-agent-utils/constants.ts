import { z } from "zod";
import appConfig from "../../config.js";
import { TestStatus } from "./types.js";

export function getAutomationBaseUrl(): string {
  return appConfig.BROWSERSTACK_AUTOMATION_BASE_URL;
}

export const FETCH_RCA_PARAMS = {
  testId: z
    .array(z.number().int())
    .max(3)
    .describe("Up to 3 numeric test ids from listTestIds (not session ids)."),
};

export const GET_BUILD_ID_PARAMS = {
  browserStackProjectName: z
    .string()
    .describe(
      "BrowserStack project name from the test run config (e.g. browserstack.yml). Exact match; no default.",
    ),
  browserStackBuildName: z
    .string()
    .describe(
      "BrowserStack build name from the test run config (e.g. browserstack.yml). Exact match; no default.",
    ),
};

export const LIST_TEST_IDS_PARAMS = {
  buildId: z
    .string()
    .describe("Build id; get it with getBuildId or listBuildId."),
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
