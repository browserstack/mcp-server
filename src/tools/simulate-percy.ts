import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../lib/types.js";
import { SetUpPercyParamsShape } from "./sdk-utils/common/schema.js";
import { setUpSimulatePercyChangeHandler } from "./sdk-utils/handler.js";
import { SIMULATE_PERCY_CHANGE_DESCRIPTION } from "./sdk-utils/common/constants.js";

export function registerSimulatePercyChangeTool(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};
  tools.simulatePercyChange = server.tool(
    "simulatePercyChange",
    SIMULATE_PERCY_CHANGE_DESCRIPTION,
    SetUpPercyParamsShape,
    async (args) => {
      return setUpSimulatePercyChangeHandler(args, config);
    },
  );
  return tools;
}

export default registerSimulatePercyChangeTool;
