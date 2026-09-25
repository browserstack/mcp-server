import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../lib/types.js";
import { RunTestsOnBrowserStackParamsShape } from "./sdk-utils/common/schema.js";
import { runTestsOnBrowserStackHandler } from "./sdk-utils/handler.js";
import { RUN_ON_BROWSERSTACK_DESCRIPTION } from "./sdk-utils/common/constants.js";
import { handleMCPError } from "../lib/utils.js";
import { trackMCP } from "../lib/instrumentation.js";

export function registerRunBrowserStackTestsTool(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.setupBrowserStackAutomateTests = server.tool(
    "setupBrowserStackAutomateTests",
    RUN_ON_BROWSERSTACK_DESCRIPTION,
    RunTestsOnBrowserStackParamsShape,
    {
      title: "Set Up Automate Tests",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "runTestsOnBrowserStack",
          server.server.getClientVersion()!,
          config,
        );
        return await runTestsOnBrowserStackHandler(args, config);
      } catch (error) {
        return handleMCPError("runTestsOnBrowserStack", server, config, error);
      }
    },
  );

  return tools;
}

export default registerRunBrowserStackTestsTool;
