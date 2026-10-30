import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import logger from "../logger.js";
import { startBrowserSession } from "./live-utils/start-session.js";
import { PlatformType } from "./live-utils/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";
import { isEnabled as capabilityRegistryEnabled } from "./capability-registry/config.js";
import globalConfig from "../config.js";

// Define the schema shape
const LiveArgsShape = {
  platformType: z
    .nativeEnum(PlatformType)
    .describe("Must be 'desktop' or 'mobile'"),
  desiredURL: z.string().url().describe("The URL to test"),
  desiredOS: z
    .enum(["Windows", "OS X", "android", "ios", "winphone"])
    .describe(
      "Desktop OS ('Windows' or 'OS X') or mobile OS ('android','ios','winphone')",
    ),
  desiredOSVersion: z
    .string()
    .describe(
      "Version number or 'latest'/'oldest'; macOS takes names, e.g. 'Sequoia'.",
    ),
  desiredBrowser: z
    .enum(["chrome", "firefox", "safari", "edge", "ie"])
    .describe("Browser for desktop (Chrome, IE, Firefox, Safari, Edge)"),
  desiredBrowserVersion: z
    .string()
    .optional()
    .describe("Desktop browser version, or 'latest' / 'oldest'."),
  desiredDevice: z.string().optional().describe("Device name for mobile"),
};

const LiveArgsSchema = z.object(LiveArgsShape);

/**
 * Launches a desktop browser session
 */
async function launchDesktopSession(
  args: z.infer<typeof LiveArgsSchema>,
  config: BrowserStackConfig,
): Promise<string> {
  if (!args.desiredBrowser)
    throw new Error("You must provide a desiredBrowser");
  if (!args.desiredBrowserVersion)
    throw new Error("You must provide a desiredBrowserVersion");

  return startBrowserSession(
    {
      platformType: PlatformType.DESKTOP,
      url: args.desiredURL,
      os: args.desiredOS,
      osVersion: args.desiredOSVersion,
      browser: args.desiredBrowser,
      browserVersion: args.desiredBrowserVersion,
    },
    config,
  );
}

/**
 * Launches a mobile browser session
 */
async function launchMobileSession(
  args: z.infer<typeof LiveArgsSchema>,
  config: BrowserStackConfig,
): Promise<string> {
  if (!args.desiredDevice) throw new Error("You must provide a desiredDevice");

  return startBrowserSession(
    {
      platformType: PlatformType.MOBILE,
      browser: args.desiredBrowser,
      url: args.desiredURL,
      os: args.desiredOS,
      osVersion: args.desiredOSVersion,
      device: args.desiredDevice,
    },
    config,
  );
}

/**
 * Handles the core logic for running a browser session
 */
async function runBrowserSession(rawArgs: any, config: BrowserStackConfig) {
  // Validate and narrow
  const args = LiveArgsSchema.parse(rawArgs);

  // Branch desktop vs mobile and delegate
  const launchUrl =
    args.platformType === PlatformType.DESKTOP
      ? await launchDesktopSession(args, config)
      : await launchMobileSession(args, config);

  let response = [
    {
      type: "text" as const,
      text: `✅ Session started. If it didn't open automatically, visit:\n${launchUrl}`,
    },
  ];

  if (globalConfig.REMOTE_MCP) {
    response = [
      {
        type: "text" as const,
        text: `✅ To start the session. Click on ${launchUrl}`,
      },
    ];
  }

  return {
    content: response,
  };
}

export default function addBrowserLiveTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  // Same rule as runAppLiveSession: Live is for a person, and an agent that picks it for a
  // click-by-locator task ends up reporting that Live cannot click by locator.
  const description =
    "Open a manual Live browser session for the user to operate by hand; the agent cannot drive it." +
    (capabilityRegistryEnabled()
      ? " To click, type or read the page yourself, use a devicecontrol session via invokeCapability."
      : "");

  tools.runBrowserLiveSession = server.tool(
    "runBrowserLiveSession",
    description,
    LiveArgsShape,
    {
      title: "Run Browser Live Session",
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
    async (args) => {
      try {
        trackMCP(
          "runBrowserLiveSession",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await runBrowserSession(args, config);
      } catch (error) {
        logger.error("Live session failed: %s", error);
        trackMCP(
          "runBrowserLiveSession",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start a browser live session. Error: ${error}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
