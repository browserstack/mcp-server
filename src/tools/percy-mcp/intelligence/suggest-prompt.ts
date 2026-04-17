/**
 * percy_suggest_prompt — Get an AI-generated prompt suggestion for diff regions.
 *
 * Sends region IDs to the Percy API, polls for the suggestion result,
 * and returns the generated prompt text.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { pollUntil } from "../../../lib/percy-api/polling.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface SuggestPromptArgs {
  comparison_id: string;
  region_ids: string;
  ignore_change?: boolean;
}

export async function percySuggestPrompt(
  args: SuggestPromptArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);

  const regionIds = args.region_ids
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const regionTypes = regionIds.map(() => "ai_region");

  const body = {
    data: {
      attributes: {
        "comparison-id": parseInt(args.comparison_id, 10),
        "region-id": regionIds.map(Number),
        "region-type": regionTypes,
        "ignore-change": args.ignore_change !== false,
      },
    },
  };

  const result = await client.post<Record<string, unknown>>(
    "/suggest-prompt",
    body,
  );

  const identifier =
    (result as Record<string, unknown>)?.identifier ||
    (result as Record<string, unknown>)?.id;

  if (!identifier) {
    return {
      content: [
        {
          type: "text",
          text: "Prompt suggestion initiated but no tracking ID received. Check results manually.",
        },
      ],
    };
  }

  const suggestion = await pollUntil<Record<string, unknown>>(
    async () => {
      const status = await client.get<Record<string, Record<string, unknown>>>(
        "/job_status",
        {
          sync: "true",
          type: "ai",
          id: String(identifier),
        },
      );

      const entry = status?.[String(identifier)];
      if (entry?.status === true) {
        return { done: true, result: entry };
      }
      if (entry?.error) {
        return { done: true, result: entry };
      }
      return { done: false };
    },
    { initialDelayMs: 1000, maxDelayMs: 3000, maxTimeoutMs: 30000 },
  );

  if (!suggestion) {
    return {
      content: [
        {
          type: "text",
          text: "Prompt suggestion timed out. The AI is still generating — try again in a moment.",
        },
      ],
    };
  }

  if (suggestion.error) {
    return {
      content: [
        {
          type: "text",
          text: `Prompt suggestion failed: ${suggestion.error}`,
        },
      ],
      isError: true,
    };
  }

  const data = suggestion.data as Record<string, unknown> | undefined;
  const prompt =
    data?.generated_prompt ||
    suggestion.generated_prompt ||
    "No prompt generated";

  let output = "## AI Prompt Suggestion\n\n";
  output += `**Suggested prompt:** ${prompt}\n\n`;
  output += `**Mode:** ${args.ignore_change !== false ? "ignore" : "show"}\n`;
  output += `**Regions analyzed:** ${regionIds.length}\n\n`;
  output +=
    "Use this prompt with `percy_trigger_ai_recompute` to apply it across all comparisons.\n";

  return { content: [{ type: "text", text: output }] };
}
