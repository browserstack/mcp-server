import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClientInfo, withToolCall } from "./instrumentation.js";
import { withFeedbackHint } from "./feedback-hint.js";

const WRAPPED = Symbol.for("browserstack.mcp.latencyWrapped");

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

    // The hint is added after withToolCall, so the recorded error_message is the
    // tool's own text, not the hint.
    const wrapped: AnyHandler & { [WRAPPED]?: true } = (...args: unknown[]) =>
      withToolCall(name, getClientInfo, config, () =>
        (inner as AnyHandler)(...args),
      ).then((result) => withFeedbackHint(name, result));
    wrapped[WRAPPED] = true;

    // Direct assignment: tool.update() would also fire tools/list_changed.
    (tool as { handler: unknown }).handler = wrapped;
  }
}
