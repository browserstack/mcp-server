/**
 * percy_trigger_ai_recompute — Re-run Percy AI analysis with a custom prompt.
 *
 * Sends a recompute request for a build or single comparison, optionally
 * with a user-supplied prompt and ignore/unignore mode.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface TriggerAiRecomputeArgs {
  build_id?: string;
  comparison_id?: string;
  prompt?: string;
  mode?: string;
}

export async function percyTriggerAiRecompute(
  args: TriggerAiRecomputeArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);

  if (!args.build_id && !args.comparison_id) {
    return {
      content: [
        {
          type: "text",
          text: "Either build_id or comparison_id is required.",
        },
      ],
      isError: true,
    };
  }

  const body: Record<string, unknown> = {
    data: {
      type: "ai-recompute",
      attributes: {
        ...(args.prompt && { "user-prompt": args.prompt }),
        ...(args.mode && { mode: args.mode }),
        ...(args.comparison_id && {
          "comparison-id": parseInt(args.comparison_id, 10),
        }),
        ...(args.build_id && {
          "build-id": parseInt(args.build_id, 10),
        }),
      },
    },
  };

  try {
    await client.post<unknown>("/ai-recompute", body);

    let output = "## AI Recompute Triggered\n\n";
    output += `**Mode:** ${args.mode || "ignore"}\n`;
    if (args.prompt) output += `**Prompt:** ${args.prompt}\n`;
    output += `**Status:** Processing\n\n`;
    output +=
      "The AI will re-analyze the visual diffs with your custom prompt. ";
    output +=
      "Use `percy_get_ai_analysis` to check results after processing completes (typically 30-60 seconds).\n";

    return { content: [{ type: "text", text: output }] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("quota")) {
      return {
        content: [
          {
            type: "text",
            text: "AI recompute quota exceeded for today. Try again tomorrow or upgrade your plan.",
          },
        ],
        isError: true,
      };
    }
    throw e;
  }
}
