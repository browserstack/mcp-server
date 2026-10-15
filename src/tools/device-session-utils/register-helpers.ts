import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import logger from "../../logger.js";
import { trackMCP } from "../../lib/instrumentation.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { errorMessage, scrubSecrets } from "./secrets.js";

export interface Hints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * Registers one tool with the house conventions: telemetry on success and
 * failure, errors returned as `isError` results rather than thrown, and every
 * piece of text scrubbed of the caller's credentials on the way out.
 */
export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: BrowserStackConfig,
  def: {
    name: string;
    title: string;
    description: string;
    schema: Shape;
    hints: Hints;
    failurePrefix: string;
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>;
  },
) {
  return server.tool(
    def.name,
    def.description,
    def.schema,
    { title: def.title, ...def.hints },
    (async (args: any) => {
      try {
        trackMCP(
          def.name,
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        const result = await def.run(args);
        return {
          ...result,
          content: result.content.map((part) =>
            part.type === "text"
              ? { ...part, text: scrubSecrets(part.text, config) }
              : part,
          ),
        };
      } catch (error) {
        const message = errorMessage(error, config);
        logger.error("%s failed: %s", def.name, message);
        trackMCP(
          def.name,
          server.server.getClientVersion()!,
          new Error(message),
          config,
        );
        return {
          content: [{ type: "text", text: `${def.failurePrefix}: ${message}` }],
          isError: true,
        };
      }
    }) as any,
  );
}

export function text(
  ...lines: Array<string | undefined | false>
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: lines.filter((l) => typeof l === "string").join("\n"),
      },
    ],
  };
}

/**
 * Hand the client the live view as a structured MCP resource link, so
 * a client that can embed or preview links shows the device in the chat.
 * Rendering is the client's job; text-only clients still get the URL in text.
 */
export function withLiveView(
  result: CallToolResult,
  url: string | undefined,
  name: string,
): CallToolResult {
  if (!url) return result;
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "resource_link",
        uri: url,
        name,
        title: "Live view",
        description: "Shareable live view of the session (no login needed).",
        mimeType: "text/html",
      } as any,
    ],
  };
}
