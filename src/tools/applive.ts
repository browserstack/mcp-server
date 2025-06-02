import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { startSession } from "./applive-utils/start-session.js";
import logger from "../logger.js";
import { trackMCP } from "../lib/instrumentation.js";

/**
 * Launches an App Live Session on BrowserStack.
 */
export async function startAppLiveSession(args: {
  desiredPlatform: string;
  desiredPlatformVersion: string;
  appPath: string;
  desiredPhone: string;
}): Promise<CallToolResult> {
  if (!args.desiredPlatform) {
    throw new Error("You must provide a desiredPlatform.");
  }

  if (!args.appPath) {
    throw new Error("You must provide a appPath.");
  }

  if (!args.desiredPhone) {
    throw new Error("You must provide a desiredPhone.");
  }

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

  const launchUrl = await startSession({
    appPath: args.appPath,
    desiredPlatform: args.desiredPlatform as "android" | "ios",
    desiredPhone: args.desiredPhone,
    desiredPlatformVersion: args.desiredPlatformVersion,
  });

  return {
    content: [
      {
        type: "text",
        text: `Successfully started a session. If a browser window did not open automatically, use the following URL to start the session: ${launchUrl}`,
      },
    ],
  };
}

export default function addAppLiveTools(server: McpServer) {
  server.tool(
    "runAppLiveSession",
    "Use this tool when user wants to manually check their app on a particular mobile device using BrowserStack's cloud infrastructure. Can be used to debug crashes, slow performance, etc.",
    {
      desiredPhone: z
        .string()
        .describe(
          "The full name of the device to run the app on. Example: 'iPhone 12 Pro' or 'Samsung Galaxy S20' or 'Google Pixel 6'. Always ask the user for the device they want to use, do not assume it. ",
        ),
      desiredPlatformVersion: z
        .string()
        .describe(
          "Specifies the platform version to run the app on. For example, use '12.0' for Android or '16.0' for iOS. If the user says 'latest', 'newest', or similar, normalize it to 'latest'. Likewise, convert terms like 'earliest' or 'oldest' to 'oldest'.",
        ),
      desiredPlatform: z
        .enum(["android", "ios"])
        .describe(
          "Which platform to run on, examples: 'android', 'ios'. Set this based on the app path provided.",
        ),
      appPath: z
        .string()
        .describe(
          "The path to the .ipa or .apk file to install on the device. Always ask the user for the app path, do not assume it.",
        ),
    },
    async (args) => {
      try {
        trackMCP("runAppLiveSession", server.server.getClientVersion()!);
        return await startAppLiveSession(args);
      } catch (error) {
        logger.error("App live session failed: %s", error);
        trackMCP("runAppLiveSession", server.server.getClientVersion()!, error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to start app live session: ${error instanceof Error ? error.message : String(error)}`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
