import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../lib/types.js";
import { RunTestsOnBrowserStackParamsShape } from "./sdk-utils/common/schema.js";
import { runTestsOnBrowserStackHandler } from "./sdk-utils/handler.js";

const RUN_ON_BROWSERSTACK_DESCRIPTION =
  "Set up and run automated web-based tests on BrowserStack using the BrowserStack SDK. Use for functional or integration tests on BrowserStack, with optional Percy visual testing for supported frameworks. Example prompts: run this test on browserstack; run this test on browserstack with Percy; set up this project for browserstack with Percy.";

export function registerRunBrowserStackTestsTool(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};
  tools.setupBrowserStackAutomateTests = server.tool(
    "setupBrowserStackAutomateTests",
    RUN_ON_BROWSERSTACK_DESCRIPTION,
    RunTestsOnBrowserStackParamsShape,
    async (args) => {
      return runTestsOnBrowserStackHandler(args, config);
    },
  );

  return tools;
}

export default registerRunBrowserStackTestsTool;
