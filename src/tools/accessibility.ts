// File: src/accessibility/mcp-tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { AccessibilityScanner } from "./accessiblity-utils/scanner.js";
import { AccessibilityReportFetcher } from "./accessiblity-utils/report-fetcher.js";
import { trackMCP } from "../lib/instrumentation.js";

const scanner = new AccessibilityScanner();
const reportFetcher = new AccessibilityReportFetcher();

/**
 * Downloads a file from a given URL and saves it to the local 'reports' directory.
 * @param reportUrl The presigned URL pointing to the CSV report.
 * @returns The absolute local file path where the report is saved.
 */
async function downloadReport(reportUrl: string): Promise<string> {
  const response = await axios.get(reportUrl, { responseType: "stream" });
  // Derive filename from URL
  const urlPath = new URL(reportUrl).pathname;
  const fileName = path.basename(urlPath);

  const reportDIR = path.join(os.homedir(), ".browserstack", "reports");
  if (!fs.existsSync(reportDIR)) {
    fs.mkdirSync(reportDIR, { recursive: true });
  }

  const filePath = path.join(reportDIR, fileName);
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  await new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  return filePath;
}

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

  // Download report locally
  const localPath = await downloadReport(reportLink);

  return {
    content: [
      {
        type: "text",
        text: `✅ Accessibility scan "${name}" completed. Report saved to: ${localPath}`,
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
