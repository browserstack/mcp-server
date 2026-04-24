import { CreateTestCasesFromFileArgs } from "./TCG-utils/types.js";
import {
  fetchFormFields,
  triggerTestCaseGeneration,
  pollScenariosTestDetails,
  bulkCreateTestCases,
} from "./TCG-utils/api.js";
import {
  buildDefaultFieldMaps,
  findBooleanFieldId,
} from "./TCG-utils/helpers.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { signedUrlMap } from "../../lib/inmemory-store.js";
import logger from "../../logger.js";
import { projectIdentifierToId } from "./TCG-utils/api.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

export async function createTestCasesFromFile(
  args: CreateTestCasesFromFileArgs,
  context: any,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  logger.info(
    `createTestCasesFromFile called with projectId: ${args.projectReferenceId}, folderId: ${args.folderId}`,
  );

  if (args.projectReferenceId.startsWith("PR-")) {
    args.projectReferenceId = await projectIdentifierToId(
      args.projectReferenceId,
      config,
    );
  }
  const { default_fields, custom_fields } = await fetchFormFields(
    args.projectReferenceId,
    config,
  );
  const fieldMaps = buildDefaultFieldMaps(default_fields);
  const booleanFieldId = findBooleanFieldId(custom_fields);

  const documentObj = signedUrlMap.get(args.documentId);
  if (!documentObj) {
    return {
      content: [
        {
          type: "text",
          text: `Document with ID ${args.documentId} not found.`,
        },
      ],
      isError: true,
    };
  }
  const documentId = (documentObj as { fileId: number }).fileId;
  const document = (documentObj as { downloadUrl: string }).downloadUrl;

  const source = "jira-on-prem";

  const traceId = await triggerTestCaseGeneration(
    document,
    documentId,
    args.folderId,
    args.projectReferenceId,
    source,
    config,
  );

  const scenariosMap = await pollScenariosTestDetails(
    args,
    traceId,
    context,
    documentId,
    source,
    config,
  );

  const resultString = await bulkCreateTestCases(
    scenariosMap,
    args.projectReferenceId,
    args.folderId,
    fieldMaps,
    booleanFieldId,
    traceId,
    context,
    documentId,
    config,
  );

  signedUrlMap.delete(args.documentId);

  const tmBaseUrl = await getTMBaseURL(config);
  const dashboardURL = `${tmBaseUrl}/projects/${args.projectReferenceId}/folder/${args.folderId}/test-cases`;

  return {
    content: [
      {
        type: "text",
        text: resultString,
      },
      {
        type: "text",
        text: `Dashboard URL: ${dashboardURL}`,
      },
    ],
  };
}
