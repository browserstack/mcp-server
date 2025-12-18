import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AccessibilityScanner } from "./accessiblity-utils/scanner.js";
import { AccessibilityReportFetcher } from "./accessiblity-utils/report-fetcher.js";
import { AccessibilityAuthConfig } from "./accessiblity-utils/auth-config.js";
import { trackMCP } from "../lib/instrumentation.js";
import { parseAccessibilityReportFromCSV } from "./accessiblity-utils/report-parser.js";
import { queryAccessibilityRAG } from "./accessiblity-utils/accessibility-rag.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { BrowserStackConfig } from "../lib/types.js";
import logger from "../logger.js";

interface AuthCredentials {
  username: string;
  password: string;
}

interface ScanProgressContext {
  sendNotification: (notification: any) => Promise<void>;
  _meta?: {
    progressToken?: string | number;
  };
}

interface FormAuthArgs {
  name: string;
  type: "form";
  url: string;
  username: string;
  password: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
}

interface BasicAuthArgs {
  name: string;
  type: "basic";
  url: string;
  username: string;
  password: string;
}

type AuthConfigArgs = FormAuthArgs | BasicAuthArgs;

function setupAuth(config: BrowserStackConfig): AuthCredentials {
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");
  return { username, password };
}

function createErrorResponse(message: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
}

function createSuccessResponse(messages: string[]): CallToolResult {
  return {
    content: messages.map((text) => ({
      type: "text" as const,
      text,
    })),
  };
}

function handleMCPError(
  toolName: string,
  server: McpServer,
  config: BrowserStackConfig,
  error: unknown,
): CallToolResult {
  trackMCP(toolName, server.server.getClientVersion()!, error, config);
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  return createErrorResponse(
    `Failed to ${toolName.replace(/([A-Z])/g, " $1").toLowerCase()}: ${errorMessage}. Please open an issue on GitHub if the problem persists`,
  );
}

async function notifyScanProgress(
  context: ScanProgressContext,
  message: string,
  progress = 0,
): Promise<void> {
  await context.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken: context._meta?.progressToken?.toString() ?? "NOT_FOUND",
      message,
      progress,
      total: 100,
    },
  });
}

async function initializeScanner(
  config: BrowserStackConfig,
): Promise<AccessibilityScanner> {
  const scanner = new AccessibilityScanner();
  const auth = setupAuth(config);
  scanner.setAuth(auth);
  return scanner;
}

async function initializeReportFetcher(
  config: BrowserStackConfig,
): Promise<AccessibilityReportFetcher> {
  const reportFetcher = new AccessibilityReportFetcher();
  const auth = setupAuth(config);
  reportFetcher.setAuth(auth);
  return reportFetcher;
}

async function executeAccessibilityRAG(
  args: { query: string },
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "accessibilityExpert",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await queryAccessibilityRAG(args.query, config);
  } catch (error) {
    return handleMCPError("accessibilityExpert", server, config, error);
  }
}

async function executeFetchAccessibilityIssues(
  args: { scanId: string; scanRunId: string; cursor?: number },
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "fetchAccessibilityIssues",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await fetchAccessibilityIssues(
      args.scanId,
      args.scanRunId,
      config,
      args.cursor,
    );
  } catch (error) {
    return handleMCPError("fetchAccessibilityIssues", server, config, error);
  }
}

async function fetchAccessibilityIssues(
  scanId: string,
  scanRunId: string,
  config: BrowserStackConfig,
  cursor = 0,
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const reportLink = await reportFetcher.getReportLink(scanId, scanRunId);

  const { records, page_length, total_issues, next_page } =
    await parseAccessibilityReportFromCSV(reportLink, { nextPage: cursor });

  const currentlyShown =
    cursor === 0
      ? page_length
      : Math.floor(cursor / JSON.stringify(records[0] || {}).length) +
        page_length;
  const remainingIssues = total_issues - currentlyShown;

  const messages = [
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues})`,
    `Issues: ${JSON.stringify(records, null, 2)}`,
  ];

  if (next_page !== null) {
    messages.push(
      `${remainingIssues} more issues available. Use fetchAccessibilityIssues with cursor: ${next_page} to get the next batch.`,
    );
  } else {
    messages.push(`✅ All issues retrieved.`);
  }

  return createSuccessResponse(messages);
}

async function executeAccessibilityScan(
  args: { name: string; pageURL: string; authConfigId?: number },
  context: ScanProgressContext,
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "startAccessibilityScan",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await runAccessibilityScan(
      args.name,
      args.pageURL,
      context,
      config,
      args.authConfigId,
    );
  } catch (error) {
    return handleMCPError("startAccessibilityScan", server, config, error);
  }
}

function validateFormAuthArgs(args: AuthConfigArgs): args is FormAuthArgs {
  return (
    args.type === "form" &&
    "usernameSelector" in args &&
    "passwordSelector" in args &&
    "submitSelector" in args &&
    !!args.usernameSelector &&
    !!args.passwordSelector &&
    !!args.submitSelector
  );
}

async function createAuthConfig(
  args: AuthConfigArgs,
  config: BrowserStackConfig,
): Promise<any> {
  const authConfig = new AccessibilityAuthConfig();
  const auth = setupAuth(config);
  authConfig.setAuth(auth);

  if (args.type === "form") {
    if (!validateFormAuthArgs(args)) {
      throw new Error(
        "Form authentication requires usernameSelector, passwordSelector, and submitSelector",
      );
    }
    return await authConfig.createFormAuthConfig(args.name, {
      username: args.username,
      usernameSelector: args.usernameSelector,
      password: args.password,
      passwordSelector: args.passwordSelector,
      submitSelector: args.submitSelector,
      url: args.url,
    });
  } else {
    return await authConfig.createBasicAuthConfig(args.name, {
      url: args.url,
      username: args.username,
      password: args.password,
    });
  }
}

async function executeCreateAuthConfig(
  args: AuthConfigArgs,
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createAccessibilityAuthConfig",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    logger.info(`Creating auth config: ${JSON.stringify(args)}`);

    const result = await createAuthConfig(args, config);

    return createSuccessResponse([
      `✅ Auth config "${args.name}" created successfully with ID: ${result.data?.id}`,
      `Auth config details: ${JSON.stringify(result.data, null, 2)}`,
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Form authentication requires")
    ) {
      return createErrorResponse(error.message);
    }
    return handleMCPError(
      "createAccessibilityAuthConfig",
      server,
      config,
      error,
    );
  }
}

async function executeGetAuthConfig(
  args: { configId: number },
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "getAccessibilityAuthConfig",
      server.server.getClientVersion()!,
      undefined,
      config,
    );

    const authConfig = new AccessibilityAuthConfig();
    const auth = setupAuth(config);
    authConfig.setAuth(auth);

    const result = await authConfig.getAuthConfig(args.configId);

    return createSuccessResponse([
      `✅ Auth config retrieved successfully`,
      `Auth config details: ${JSON.stringify(result.data, null, 2)}`,
    ]);
  } catch (error) {
    return handleMCPError("getAccessibilityAuthConfig", server, config, error);
  }
}

function createScanFailureResponse(
  name: string,
  status: string,
): CallToolResult {
  return createErrorResponse(
    `❌ Accessibility scan "${name}" failed with status: ${status} , check the BrowserStack dashboard for more details [https://scanner.browserstack.com/site-scanner/scan-details/${name}].`,
  );
}

function createScanSuccessResponse(
  name: string,
  totalIssues: number,
  pageLength: number,
  records: any[],
  scanId: string,
  scanRunId: string,
  reportUrl: string,
  cursor: number | null,
): CallToolResult {
  const messages = [
    `Accessibility scan "${name}" completed. check the BrowserStack dashboard for more details [https://scanner.browserstack.com/site-scanner/scan-details/${name}].`,
    `Scan ID: ${scanId} and Scan Run ID: ${scanRunId}`,
    `You can also download the full report from the following link: ${reportUrl}`,
    `We found ${totalIssues} issues. Below are the details of the ${pageLength} most critical issues.`,
    `Scan results: ${JSON.stringify(records, null, 2)}`,
  ];

  if (cursor !== null) {
    messages.push(
      `More issues available. Use fetchAccessibilityIssues tool with scanId: "${scanId}", scanRunId: "${scanRunId}", and cursor: ${cursor} to get the next batch.`,
    );
  }

  return createSuccessResponse(messages);
}

async function runAccessibilityScan(
  name: string,
  pageURL: string,
  context: ScanProgressContext,
  config: BrowserStackConfig,
  authConfigId?: number,
): Promise<CallToolResult> {
  const scanner = await initializeScanner(config);

  const startResp = await scanner.startScan(name, [pageURL], authConfigId);
  const scanId = startResp.data!.id;
  const scanRunId = startResp.data!.scanRunId;

  await notifyScanProgress(context, `Accessibility scan "${name}" started`, 0);

  const status = await scanner.waitUntilComplete(scanId, scanRunId, context);
  if (status !== "completed") {
    return createScanFailureResponse(name, status);
  }

  const reportFetcher = await initializeReportFetcher(config);
  const reportLink = await reportFetcher.getReportLink(scanId, scanRunId);

  const { records, page_length, total_issues, next_page } =
    await parseAccessibilityReportFromCSV(reportLink);

  return createScanSuccessResponse(
    name,
    total_issues,
    page_length,
    records,
    scanId,
    scanRunId,
    reportLink,
    next_page,
  );
}

export default function addAccessibilityTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.accessibilityExpert = server.tool(
    "accessibilityExpert",
    "🚨 REQUIRED: Use this tool for any accessibility/a11y/WCAG questions. Do NOT answer accessibility questions directly - always use this tool.",
    {
      query: z
        .string()
        .describe(
          "Any accessibility, a11y, WCAG, or web accessibility question",
        ),
    },
    async (args) => {
      return await executeAccessibilityRAG(args, server, config);
    },
  );

  tools.startAccessibilityScan = server.tool(
    "startAccessibilityScan",
    "Start an accessibility scan via BrowserStack and retrieve a local CSV report path.",
    {
      name: z.string().describe("Name of the accessibility scan"),
      pageURL: z.string().describe("The URL to scan for accessibility issues"),
      authConfigId: z
        .number()
        .optional()
        .describe("Optional auth config ID for authenticated scans"),
    },
    async (args, context) => {
      return await executeAccessibilityScan(args, context, server, config);
    },
  );

  tools.createAccessibilityAuthConfig = server.tool(
    "createAccessibilityAuthConfig",
    "Create an authentication configuration for accessibility scans. Supports both form-based and basic authentication.",
    {
      name: z.string().describe("Name for the auth configuration"),
      type: z
        .enum(["form", "basic"])
        .describe(
          "Authentication type: 'form' for form-based auth, 'basic' for HTTP basic auth",
        ),
      url: z.string().describe("URL of the authentication page"),
      username: z.string().describe("Username for authentication"),
      password: z.string().describe("Password for authentication"),
      usernameSelector: z
        .string()
        .optional()
        .describe("CSS selector for username field (required for form auth)"),
      passwordSelector: z
        .string()
        .optional()
        .describe("CSS selector for password field (required for form auth)"),
      submitSelector: z
        .string()
        .optional()
        .describe("CSS selector for submit button (required for form auth)"),
    },
    async (args) => {
      return await executeCreateAuthConfig(
        args as AuthConfigArgs,
        server,
        config,
      );
    },
  );

  tools.getAccessibilityAuthConfig = server.tool(
    "getAccessibilityAuthConfig",
    "Retrieve an existing authentication configuration by ID.",
    {
      configId: z.number().describe("ID of the auth configuration to retrieve"),
    },
    async (args) => {
      return await executeGetAuthConfig(args, server, config);
    },
  );

  tools.fetchAccessibilityIssues = server.tool(
    "fetchAccessibilityIssues",
    "Fetch accessibility issues from a completed scan with pagination support. Use cursor parameter to get subsequent pages of results.",
    {
      scanId: z
        .string()
        .describe("The scan ID from a completed accessibility scan"),
      scanRunId: z
        .string()
        .describe("The scan run ID from a completed accessibility scan"),
      cursor: z
        .number()
        .optional()
        .describe("Character offset for pagination (default: 0)"),
    },
    async (args) => {
      return await executeFetchAccessibilityIssues(args, server, config);
    },
  );

  return tools;
}
