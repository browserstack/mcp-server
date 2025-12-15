import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getSelfHealSelectors } from "./selfheal-utils/selfheal.js";
import logger from "../logger.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";

// Tool function that fetches self-healing selectors
type SessionType = "automate" | "app-automate";

export async function fetchSelfHealSelectorTool(
  args: { sessionId: string; sessionType?: SessionType },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const selectors = await getSelfHealSelectors(
      args.sessionId,
      config,
      args.sessionType ?? "automate",
    );
    return {
      content: [
        {
          type: "text",
          text:
            "Self-heal selectors fetched successfully" +
            JSON.stringify(selectors),
        },
      ],
    };
  } catch (error) {
    logger.error("Error fetching self-heal selector suggestions", error);
    throw error;
  }
}

// Registers the fetchSelfHealSelector tool with the MCP server
export default function addSelfHealTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchSelfHealedSelectors = server.tool(
    "fetchSelfHealedSelectors",
    "Retrieves AI-generated, self-healed selectors for a BrowserStack Automate or App Automate session to resolve flaky tests caused by dynamic DOM changes.",
    {
      sessionId: z.string().describe("The session ID of the test run"),
      sessionType: z
        .enum(["automate", "app-automate"])
        .describe(
          "BrowserStack product to query; defaults to automate when omitted.",
        )
        .optional(),
    },
    async (args) => {
      try {
        trackMCP(
          "fetchSelfHealedSelectors",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await fetchSelfHealSelectorTool(args, config);
      } catch (error) {
        trackMCP(
          "fetchSelfHealedSelectors",
          server.server.getClientVersion()!,
          error,
          config,
        );
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error during fetching self-heal suggestions: ${errorMessage}`,
            },
          ],
        };
      }
    },
  );

  return tools;
}
