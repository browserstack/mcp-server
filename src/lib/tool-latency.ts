import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClientInfo, withToolCall } from "./instrumentation.js";

const WRAPPED = Symbol.for("browserstack.mcp.latencyWrapped");

type AnyHandler = (...args: unknown[]) => unknown;

/**
 * Wraps every registered tool handler in `withToolCall`, so each call writes exactly
 * one MCPInstrumentation row when it settles (success, duration_ms, outcome, error
 * fields). The tools' own entry and catch-block `trackMCP` calls fold into that row.
 * Transparent (result passed through, throws rethrown), idempotent, skips task-style
 * (non-function) handlers.
 */
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
      );
    wrapped[WRAPPED] = true;

    // Direct assignment: tool.update() would also fire tools/list_changed.
    (tool as { handler: unknown }).handler = wrapped;
  }
}
