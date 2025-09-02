import { z } from "zod";
import {
  SDKSupportedBrowserAutomationFrameworkEnum,
  SDKSupportedTestingFrameworkEnum,
  SDKSupportedLanguageEnum,
} from "./types.js";
import { PercyIntegrationTypeEnum } from "./types.js";

export const SetUpPercyParamsShape = {
  projectName: z.string().describe("A unique name for your Percy project."),
  detectedLanguage: z.nativeEnum(SDKSupportedLanguageEnum),
  detectedBrowserAutomationFramework: z.nativeEnum(
    SDKSupportedBrowserAutomationFrameworkEnum,
  ),
  detectedTestingFramework: z.nativeEnum(SDKSupportedTestingFrameworkEnum),
  integrationType: z
    .nativeEnum(PercyIntegrationTypeEnum)
    .describe(
      "Specifies whether to integrate with Percy Web or Percy Automate. If not explicitly provided, prompt the user to select the desired integration type.",
    ),
  folderPaths: z
    .array(z.string())
    .describe(
      "An array of folder paths to include in which Percy will be integrated. If not provided, strictly inspect the code and return the folders which contain UI test cases.",
    ),
};

export const RunTestsOnBrowserStackParamsShape = {
  projectName: z
    .string()
    .describe(
      "A single name for your project to organize all your tests. This is required for Percy.",
    ),
  detectedLanguage: z.nativeEnum(SDKSupportedLanguageEnum),
  detectedBrowserAutomationFramework: z.nativeEnum(
    SDKSupportedBrowserAutomationFrameworkEnum,
  ),
  detectedTestingFramework: z.nativeEnum(SDKSupportedTestingFrameworkEnum),
  desiredPlatforms: z
    .array(z.enum(["windows", "macos", "android", "ios"]))
    .describe("An array of platforms to run tests on."),
};

export const SetUpPercySchema = z.object(SetUpPercyParamsShape);
export const RunTestsOnBrowserStackSchema = z.object(
  RunTestsOnBrowserStackParamsShape,
);

export type SetUpPercyInput = z.infer<typeof SetUpPercySchema>;
export type RunTestsOnBrowserStackInput = z.infer<
  typeof RunTestsOnBrowserStackSchema
>;

export const RunPercyScanParamsShape = {
  projectName: z.string().describe("The name of the project to run Percy on."),
  percyRunCommand: z
    .string()
    .optional()
    .describe(
      "The test command to run with Percy. Optional — the LLM should try to infer it first from project context.",
    ),
  integrationType: z
    .nativeEnum(PercyIntegrationTypeEnum)
    .describe(
      "Specifies whether to integrate with Percy Web or Percy Automate. If not explicitly provided, prompt the user to select the desired integration type.",
    ),
};

export const FetchPercyChangesParamsShape = {
  project_name: z
    .string()
    .describe(
      "The name of the BrowserStack project. If not found, ask user directly.",
    ),
};

export const ManagePercyBuildApprovalParamsShape = {
  buildId: z
    .string()
    .describe("The ID of the Percy build to approve or reject."),
  action: z
    .enum(["approve", "unapprove", "reject"])
    .describe("The action to perform on the Percy build."),
};
