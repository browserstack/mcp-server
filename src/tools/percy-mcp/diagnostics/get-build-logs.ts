/**
 * percy_get_build_logs — Download and filter Percy build logs.
 *
 * Retrieves logs for a build, optionally filtered by service (cli, renderer,
 * jackproxy), reference scope, and log level.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetBuildLogsArgs {
  build_id: string;
  service?: string;
  reference_type?: string;
  reference_id?: string;
  level?: string;
}

export async function percyGetBuildLogs(
  args: GetBuildLogsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);

  const params: Record<string, string> = { build_id: args.build_id };
  if (args.service) params.service_name = args.service;
  if (args.reference_type && args.reference_id) {
    params.reference_id = `${args.reference_type}_${args.reference_id}`;
  }

  let data: unknown;
  try {
    data = await client.get<unknown>("/logs", params);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [
        { type: "text", text: `Failed to fetch logs: ${message}` },
      ],
      isError: true,
    };
  }

  if (!data) {
    return {
      content: [
        { type: "text", text: "No logs available for this build." },
      ],
    };
  }

  let output = `## Build Logs — #${args.build_id}\n\n`;
  if (args.service) output += `**Service:** ${args.service}\n`;
  if (args.level) output += `**Level filter:** ${args.level}\n`;
  output += "\n";

  // Parse log data — format depends on service
  const record = data as Record<string, unknown>;
  const rendererLogs = record?.renderer as Record<string, unknown> | undefined;
  const rawLogs =
    Array.isArray(data)
      ? data
      : (record?.logs as unknown[]) ||
        (record?.clilogs as unknown[]) ||
        (rendererLogs?.logs as unknown[]) ||
        [];

  const logs = Array.isArray(rawLogs) ? rawLogs : [];

  if (logs.length > 0) {
    const filtered = args.level
      ? logs.filter((l: unknown) => {
          const entry = l as Record<string, unknown>;
          return entry.level === args.level || entry.debug === args.level;
        })
      : logs;

    output += "```\n";
    filtered.slice(0, 100).forEach((log: unknown) => {
      const entry = log as Record<string, unknown>;
      const ts = entry.timestamp ? `[${entry.timestamp}] ` : "";
      const level = (entry.level || entry.debug || "") as string;
      const msg =
        (entry.message as string) ||
        (entry.msg as string) ||
        JSON.stringify(entry);
      output += `${ts}${level ? level.toUpperCase() + " " : ""}${msg}\n`;
    });
    if (filtered.length > 100) {
      output += `\n... (${filtered.length - 100} more log entries)\n`;
    }
    output += "```\n";
  } else {
    output += "No log entries found matching filters.\n";
  }

  return { content: [{ type: "text", text: output }] };
}
