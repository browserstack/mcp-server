import { z } from "zod";
import { getRegionalHost } from "../../lib/regional-host.js";
import { TestStatus } from "./types.js";

export function getAutomationBaseUrl(): string {
  return getRegionalHost("automationApi");
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
    .optional()
    .describe("Project name, as in browserstack.yml or the dashboard."),
  browserStackBuildName: z
    .string()
    .optional()
    .describe("Build name: the SDK's or the dashboard's."),
  buildNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Build number (#N) from the dashboard."),
  buildUrl: z
    .string()
    .optional()
    .describe("TRA or Automate dashboard link to the build."),
};

export const LIST_TEST_IDS_PARAMS = {
  buildId: z.string().describe("TRA build id from listBuildId."),
  status: z
    .nativeEnum(TestStatus)
    .optional()
    .describe("Only tests with this status; use failed for RCA."),
  includeFailureDetail: z
    .boolean()
    .optional()
    .describe("Add per-test failure signature for clustering. Default false."),
};
