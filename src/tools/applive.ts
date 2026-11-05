import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { startSession } from "./applive-utils/start-session.js";
import logger from "../logger.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";
import { isEnabled as capabilityRegistryEnabled } from "./capability-registry/config.js";
import { versionString } from "../lib/version-keyword.js";

/**
 * Launches an App Live Session on BrowserStack.
 */
export async function startAppLiveSession(
  args: {
    desiredPlatform: string;
    desiredPlatformVersion: string;
    appPath?: string;
    desiredPhone: string;
    browserstackAppUrl?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  if (!args.desiredPlatform) {
    throw new Error("You must provide a desiredPlatform.");
  }

  if (!args.appPath && !args.browserstackAppUrl) {
    throw new Error("You must provide either appPath or browserstackAppUrl.");
  }

  if (!args.desiredPhone) {
    throw new Error("You must provide a desiredPhone.");
  }

  // Only validate app path if it's provided (not using browserstackAppUrl)
  if (args.appPath) {
    if (args.desiredPlatform === "android" && !args.appPath.endsWith(".apk")) {
      throw new Error("You must provide a valid Android app path.");
    }

    if (args.desiredPlatform === "ios" && !args.appPath.endsWith(".ipa")) {
      throw new Error("You must provide a valid iOS app path.");
    }

    // check if the app path exists && is readable
    try {
      if (!fs.existsSync(args.appPath)) {
        throw new Error("The app path does not exist.");
      }
      fs.accessSync(args.appPath, fs.constants.R_OK);
    } catch (error) {
      logger.error("The app path does not exist or is not readable: %s", error);
      throw new Error("The app path does not exist or is not readable.");
    }
  }

  const launchUrl = await startSession(
    {
      appPath: args.appPath,
      desiredPlatform: args.desiredPlatform as "android" | "ios",
      desiredPhone: args.desiredPhone,
      desiredPlatformVersion: args.desiredPlatformVersion,
      browserstackAppUrl: args.browserstackAppUrl,
    },
    { config },
  );

  return {
    content: [
      {
        type: "text",
        text: `Successfully started a session. If a browser window did not open automatically, use the following URL to start the session: ${launchUrl}`,
      },
    ],
  };
}

export default function addAppLiveTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  // A Live session is for a PERSON. The agent cannot tap, type, read the screen or take a
  // screenshot in it, and every eval where an agent was asked to operate an app and chose
  // this tool ended with "my tools can start it but can't tap anything in it". The
  // description says so, and names the surface that can — only when that surface is on.
  const description =
    "Open a manual App Live session for the user to operate by hand; the agent cannot drive it." +
    (capabilityRegistryEnabled()
      ? " To tap, type or read the app yourself, use a mobiledevicecontrol session via invokeCapability."
      : "");

  tools.runAppLiveSession = server.tool(
    "runAppLiveSession",
    description,
    {
      desiredPhone: z
        .string()
        .describe(
          "Exact device name, e.g. 'iPhone 15 Pro Max'. Ask the user; never assume.",
        ),
      desiredPlatformVersion: versionString().describe(
        "Version number, or 'latest' / 'oldest'.",
      ),
      desiredPlatform: z
        .enum(["android", "ios"])
        .describe(
          "Which platform to run on, examples: 'android', 'ios'. Set this based on the app path provided.",
        ),
      appPath: z
        .string()
        .describe(
          "Local .apk/.ipa path inside MCP_UPLOAD_BASE_DIR. Ask the user; never assume.",
        ),
    },
    {
      title: "Run App Live Session",
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    async (args) => {
      try {
        trackMCP(
          "runAppLiveSession",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await startAppLiveSession(args, config);
      } catch (error) {
        logger.error("App live session failed: %s", error);
        trackMCP(
          "runAppLiveSession",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: `Failed to start app live session: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
