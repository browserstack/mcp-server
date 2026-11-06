import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import {
  BuildLookupResult,
  resolveBuild,
} from "./rca-agent-utils/resolve-build.js";
import { isHashedBuildId } from "./automate-utils/resolve-hashed-build-id.js";
import { mapHashedToTra } from "./automate-utils/resolve-tra-build-id.js";
import { getTestIds } from "./rca-agent-utils/get-failed-test-id.js";
import { getRCAData } from "./rca-agent-utils/rca-data.js";
import { formatRCAData } from "./rca-agent-utils/format-rca.js";
import { TestStatus } from "./rca-agent-utils/types.js";
import { handleMCPError } from "../lib/utils.js";
import { trackMCP } from "../index.js";
import { BuildIdArgs } from "./rca-agent-utils/types.js";
import { NEEDS_BUILD_ID, NEEDS_TEST_IDS } from "./tool-handoff.js";
import {
  FETCH_RCA_PARAMS,
  GET_BUILD_ID_PARAMS,
  LIST_TEST_IDS_PARAMS,
} from "./rca-agent-utils/constants.js";

function buildLookupResult(result: BuildLookupResult): CallToolResult {
  const content: CallToolResult["content"] = [
    { type: "text", text: result.buildId },
  ];
  if (result.note) content.push({ type: "text", text: result.note });
  return { content };
}

function buildLookupError(error: unknown): CallToolResult {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  logger.error("Error fetching build ID: %s", errorMessage);
  return {
    content: [
      { type: "text", text: `Error fetching build ID: ${errorMessage}` },
    ],
    isError: true,
  };
}

export async function getBuildIdTool(
  args: BuildIdArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const [userName] = getBrowserStackAuth(config).split(":");
    return buildLookupResult(await resolveBuild(args, config, { userName }));
  } catch (error) {
    return buildLookupError(error);
  }
}

export async function listBuildIdTool(
  args: BuildIdArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    return buildLookupResult(await resolveBuild(args, config));
  } catch (error) {
    return buildLookupError(error);
  }
}

// Tool function that fetches RCA data
export async function fetchRCADataTool(
  args: { testId: number[] },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const authString = getBrowserStackAuth(config);

    // Limit to first 3 test IDs for performance
    const testIds = args.testId;

    const rcaData = await getRCAData(testIds, authString);

    const formattedData = formatRCAData(rcaData);

    return {
      content: [
        {
          type: "text",
          text: formattedData,
        },
      ],
    };
  } catch (error) {
    logger.error("Error fetching RCA data", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error fetching RCA data: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

export async function listTestIdsTool(
  args: {
    buildId: string;
    status?: TestStatus;
    includeFailureDetail?: boolean;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const { status, includeFailureDetail } = args;
    const authString = getBrowserStackAuth(config);
    let buildId = args.buildId.trim();
    let note: string | undefined;

    let testIds;
    try {
      testIds = await getTestIds(
        buildId,
        authString,
        status,
        includeFailureDetail,
      );
    } catch (error) {
      if (!isNotFound(error) || !isHashedBuildId(buildId)) throw error;
      const mapped = await mapHashedToTra(buildId, error, config);
      note = `Automate build ${buildId} maps to TRA build ${mapped}.`;
      buildId = mapped;
      testIds = await getTestIds(
        buildId,
        authString,
        status,
        includeFailureDetail,
      );
    }

    const content: CallToolResult["content"] = [
      { type: "text", text: JSON.stringify(testIds, null, 2) },
    ];
    if (note) content.push({ type: "text", text: note });
    return { content };
  } catch (error) {
    logger.error("Error listing test IDs", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error listing test IDs: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

export default function addRCATools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchRCA = server.tool(
    "fetchRCA",
    "AI root cause for failed Automate/App Automate tests. Suggests fixes only; never auto-apply, require explicit user approval." +
      NEEDS_TEST_IDS,
    FETCH_RCA_PARAMS,
    {
      title: "Fetch Root Cause Analysis",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "fetchRCA",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await fetchRCADataTool(args, config);
      } catch (error) {
        return handleMCPError("fetchRCA", server, config, error);
      }
    },
  );

  tools.getBuildId = server.tool(
    "getBuildId",
    "Like listBuildId, but prefers the caller's own builds. Finds a build id from project + build name, build number or link.",
    GET_BUILD_ID_PARAMS,
    {
      title: "Get Build ID",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "getBuildId",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await getBuildIdTool(args, config);
      } catch (error) {
        return handleMCPError("getBuildId", server, config, error);
      }
    },
  );

  tools.listBuildId = server.tool(
    "listBuildId",
    "Find a build id, any user: TRA project + build name, build number or link, or an Automate/App Automate build by name. Default: latest run.",
    GET_BUILD_ID_PARAMS,
    {
      title: "List Build IDs",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "listBuildId",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await listBuildIdTool(args, config);
      } catch (error) {
        return handleMCPError("listBuildId", server, config, error);
      }
    },
  );

  tools.listTestIds = server.tool(
    "listTestIds",
    "List all tests of a BrowserStack build (each with its status and session id); optional status filter." +
      NEEDS_BUILD_ID,
    LIST_TEST_IDS_PARAMS,
    {
      title: "List Test IDs",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "listTestIds",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await listTestIdsTool(args, config);
      } catch (error) {
        return handleMCPError("listTestIds", server, config, error);
      }
    },
  );

  return tools;
}
