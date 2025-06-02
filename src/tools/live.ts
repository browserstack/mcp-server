// File: src/tools/live.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import logger from "../logger.js";
import { startBrowserSession } from "./live-utils/start-session.js";
import { PlatformType } from "./live-utils/types.js";
import { trackMCP } from "../lib/instrumentation.js";

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
      "The OS version must be specified as a version number (e.g., '10', '14.0') or as a keyword such as 'latest' or 'oldest'. Normalize variations like 'newest' or 'most recent' to 'latest', and terms like 'earliest' or 'first' to 'oldest'. For macOS, version names (e.g., 'Sequoia') must be used instead of numeric versions.",
    ),
  desiredBrowser: z
    .enum(["chrome", "firefox", "safari", "edge", "ie"])
    .describe("Browser for desktop (Chrome, IE, Firefox, Safari, Edge)"),
  desiredBrowserVersion: z
    .string()
    .optional()
    .describe(
      "Browser version for desktop (e.g. '133.2', 'latest'). If the user says 'latest', 'newest', or similar, normalize it to 'latest'. Likewise, convert terms like 'earliest' or 'oldest' to 'oldest'.",
    ),
  desiredDevice: z.string().optional().describe("Device name for mobile"),
};

const LiveArgsSchema = z.object(LiveArgsShape);

/**
 * Launches a desktop browser session
 */
async function launchDesktopSession(
  args: z.infer<typeof LiveArgsSchema>,
): Promise<string> {
  if (!args.desiredBrowser)
    throw new Error("You must provide a desiredBrowser");
  if (!args.desiredBrowserVersion)
    throw new Error("You must provide a desiredBrowserVersion");

  return startBrowserSession({
    platformType: PlatformType.DESKTOP,
    url: args.desiredURL,
    os: args.desiredOS,
    osVersion: args.desiredOSVersion,
    browser: args.desiredBrowser,
    browserVersion: args.desiredBrowserVersion,
  });
}

/**
 * Launches a mobile browser session
 */
async function launchMobileSession(
  args: z.infer<typeof LiveArgsSchema>,
): Promise<string> {
  if (!args.desiredDevice) throw new Error("You must provide a desiredDevice");

  return startBrowserSession({
    platformType: PlatformType.MOBILE,
    browser: args.desiredBrowser,
    url: args.desiredURL,
    os: args.desiredOS,
    osVersion: args.desiredOSVersion,
    device: args.desiredDevice,
  });
}

/**
 * Handles the core logic for running a browser session
 */
async function runBrowserSession(rawArgs: any) {
  // Validate and narrow
  const args = LiveArgsSchema.parse(rawArgs);

  // Branch desktop vs mobile and delegate
  const launchUrl =
    args.platformType === PlatformType.DESKTOP
      ? await launchDesktopSession(args)
      : await launchMobileSession(args);

  return {
    content: [
      {
        type: "text" as const,
        text: `✅ Session started. If it didn't open automatically, visit:\n${launchUrl}`,
      },
    ],
  };
}

export default function addBrowserLiveTools(server: McpServer) {
  server.tool(
    "runBrowserLiveSession",
    "Launch a BrowserStack Live session (desktop or mobile).",
    LiveArgsShape,
    async (args) => {
      try {
        trackMCP("runBrowserLiveSession", server.server.getClientVersion()!);
        return await runBrowserSession(args);
      } catch (error) {
        logger.error("Live session failed: %s", error);
        trackMCP(
          "runBrowserLiveSession",
          server.server.getClientVersion()!,
          error,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start a browser live session. Error: ${error}`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
