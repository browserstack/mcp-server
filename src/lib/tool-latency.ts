import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClientInfo, withToolCall } from "./instrumentation.js";
import { withFeedbackHint } from "./feedback-hint.js";
import { accountRegion } from "./account-region.js";
import { withAccountRegion } from "./region-context.js";
import { BrowserStackConfig } from "./types.js";

const WRAPPED = Symbol.for("browserstack.mcp.latencyWrapped");
const REGION_BOUND = Symbol.for("browserstack.mcp.regionBound");

type AnyHandler = (...args: unknown[]) => unknown;

/** Wraps every function handler in `withToolCall`. Idempotent; skips task-style handlers. */
export function instrumentToolLatency(
  tools: Record<string, RegisteredTool>,
  getClientInfo: () => ClientInfo,
  config?: unknown,
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const inner = tool.handler as unknown;
    if (typeof inner !== "function") continue;
    if ((inner as AnyHandler & { [WRAPPED]?: true })[WRAPPED]) continue;

    const wrapped: AnyHandler & { [WRAPPED]?: true } = (...args: unknown[]) =>
      withToolCall(name, getClientInfo, config, () =>
        (inner as AnyHandler)(...args),
      ).then((result) => withFeedbackHint(name, result));
    wrapped[WRAPPED] = true;

    // Direct assignment: tool.update() would also fire tools/list_changed.
    (tool as { handler: unknown }).handler = wrapped;
  }
}

/** Runs every handler in the account's region, looked up once for `config`. Idempotent. */
export function bindAccountRegion(
  tools: Record<string, RegisteredTool>,
  config: BrowserStackConfig,
): void {
  for (const tool of Object.values(tools)) {
    const inner = tool.handler as unknown;
    if (typeof inner !== "function") continue;
    if ((inner as AnyHandler & { [REGION_BOUND]?: true })[REGION_BOUND])
      continue;

    const bound: AnyHandler & { [REGION_BOUND]?: true } = async (
      ...args: unknown[]
    ) => {
      const account = await accountRegion(config);
      return withAccountRegion(account, () => (inner as AnyHandler)(...args));
    };
    bound[REGION_BOUND] = true;
    (tool as { handler: unknown }).handler = bound;
  }
}
