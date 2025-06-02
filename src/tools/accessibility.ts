import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AccessibilityScanner } from "./accessiblity-utils/scanner.js";
import { AccessibilityReportFetcher } from "./accessiblity-utils/report-fetcher.js";
import { trackMCP } from "../lib/instrumentation.js";
import { parseAccessibilityReportFromCSV } from "./accessiblity-utils/report-parser.js";

const scanner = new AccessibilityScanner();
const reportFetcher = new AccessibilityReportFetcher();

async function runAccessibilityScan(
  name: string,
  pageURL: string,
  context: any,
): Promise<CallToolResult> {
  // Start scan
  const startResp = await scanner.startScan(name, [pageURL]);
  const scanId = startResp.data!.id;
  const scanRunId = startResp.data!.scanRunId;

  // Notify scan start
  await context.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken: context._meta?.progressToken ?? "NOT_FOUND",
      message: `Accessibility scan "${name}" started`,
      progress: 0,
      total: 100,
    },
  });

  // Wait until scan completes
  const status = await scanner.waitUntilComplete(scanId, scanRunId, context);
  if (status !== "completed") {
    return {
      content: [
        {
          type: "text",
          text: `❌ Accessibility scan "${name}" failed with status: ${status} , check the BrowserStack dashboard for more details [https://scanner.browserstack.com/site-scanner/scan-details/${name}].`,
          isError: true,
        },
      ],
      isError: true,
    };
  }

  // Fetch CSV report link
  const reportLink = await reportFetcher.getReportLink(scanId, scanRunId);

  const { records, page_length, total_issues } =
    await parseAccessibilityReportFromCSV(reportLink);

  return {
    content: [
      {
        type: "text",
        text: `✅ Accessibility scan "${name}" completed. check the BrowserStack dashboard for more details [https://scanner.browserstack.com/site-scanner/scan-details/${name}].`,
      },
      {
        type: "text",
        text: `We found ${total_issues} issues. Below are the details of the ${page_length} most critical issues.`,
      },
      {
        type: "text",
        text: `Scan results: ${JSON.stringify(records, null, 2)}`,
      },
    ],
  };
}

export default function addAccessibilityTools(server: McpServer) {
  server.tool(
    "startAccessibilityScan",
    "Start an accessibility scan via BrowserStack and retrieve a local CSV report path.",
    {
      name: z.string().describe("Name of the accessibility scan"),
      pageURL: z.string().describe("The URL to scan for accessibility issues"),
    },
    async (args, context) => {
      try {
        trackMCP("startAccessibilityScan", server.server.getClientVersion()!);
        return await runAccessibilityScan(args.name, args.pageURL, context);
      } catch (error) {
        trackMCP(
          "startAccessibilityScan",
          server.server.getClientVersion()!,
          error,
        );
        return {
          content: [
            {
              type: "text",
              text: `Failed to start accessibility scan: ${
                error instanceof Error ? error.message : "Unknown error"
              }. Please open an issue on GitHub if the problem persists`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
