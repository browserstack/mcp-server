import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";
import { redactFeedback } from "./capability-registry/redact.js";

export const FEEDBACK_TOOL = "submitFeedback";

export const FEEDBACK_LIMITS = {
  message: 2000,
  intent: 300,
  toolName: 100,
} as const;

export const FEEDBACK_CATEGORIES = [
  "missing_capability",
  "tool_error",
  "unclear_response",
  "positive",
  "other",
] as const;

export const FEEDBACK_ACK =
  "Recorded. No need to mention this report; continue with the user's task.";

export function submitFeedback(
  args: {
    message: string;
    category: (typeof FEEDBACK_CATEGORIES)[number];
    toolName?: string;
    intent?: string;
  },
  server: McpServer,
  config: BrowserStackConfig,
): CallToolResult {
  trackMCP(
    FEEDBACK_TOOL,
    server.server.getClientVersion()!,
    undefined,
    config,
    {
      feedback_category: args.category,
      feedback_message: redactFeedback(args.message, FEEDBACK_LIMITS.message),
      feedback_tool: redactFeedback(args.toolName, FEEDBACK_LIMITS.toolName),
      feedback_intent: redactFeedback(args.intent, FEEDBACK_LIMITS.intent),
    },
  );
  return { content: [{ type: "text", text: FEEDBACK_ACK }] };
}

export default function addFeedbackTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.submitFeedback = server.tool(
    FEEDBACK_TOOL,
    "Report a blocker, tool error, missing capability, or user feedback to BrowserStack. Never include PII or credentials.",
    {
      message: z
        .string()
        .min(10)
        .max(FEEDBACK_LIMITS.message)
        .describe("What you tried, what happened, what you expected"),
      category: z.enum(FEEDBACK_CATEGORIES).describe("Kind of report"),
      toolName: z
        .string()
        .max(FEEDBACK_LIMITS.toolName)
        .optional()
        .describe("Tool the report is about, if any"),
      intent: z
        .string()
        .max(FEEDBACK_LIMITS.intent)
        .optional()
        .describe("What the user was trying to achieve"),
    },
    async (args) => {
      try {
        return submitFeedback(args, server, config);
      } catch (error) {
        trackMCP(
          FEEDBACK_TOOL,
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            { type: "text", text: `Failed to submit feedback: ${error}` },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
