import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClientInfo,
  ToolOutcome,
  trackMCPCompleted,
} from "./instrumentation.js";

const WRAPPED = Symbol.for("browserstack.mcp.latencyWrapped");

type AnyHandler = (...args: unknown[]) => unknown;

function outcomeOf(result: unknown): ToolOutcome {
  const isError =
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true;
  return isError ? "error_result" : "ok";
}

/**
 * Wraps every registered tool handler with a stopwatch and emits one
 * completion row (`phase: "completed"`) per call. Transparent (result passed through,
 * throws rethrown) and idempotent. Skips task-style (non-function) handlers.
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

    const wrapped: AnyHandler & { [WRAPPED]?: true } = async (
      ...args: unknown[]
    ) => {
      const startedAt = performance.now();
      try {
        const result = await (inner as AnyHandler)(...args);
        emit(name, getClientInfo, config, startedAt, outcomeOf(result));
        return result;
      } catch (error) {
        emit(name, getClientInfo, config, startedAt, "threw");
        throw error;
      }
    };
    wrapped[WRAPPED] = true;

    // Direct assignment: tool.update() would also fire tools/list_changed.
    (tool as { handler: unknown }).handler = wrapped;
  }
}

function emit(
  name: string,
  getClientInfo: () => ClientInfo,
  config: unknown,
  startedAt: number,
  outcome: ToolOutcome,
): void {
  try {
    trackMCPCompleted(
      name,
      getClientInfo() ?? {},
      { durationMs: performance.now() - startedAt, outcome },
      config,
    );
  } catch {
    // Telemetry must never affect the tool call.
  }
}
