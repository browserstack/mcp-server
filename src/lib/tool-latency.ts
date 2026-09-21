import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClientInfo,
  ToolOutcome,
  trackMCPCompleted,
} from "./instrumentation.js";

/**
 * Marks a handler we have already wrapped, so calling `instrumentToolLatency`
 * twice on the same tool map (library + remote wrapper) emits one event, not two.
 */
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
 * Wrap every registered tool's handler with a stopwatch.
 *
 * Why here and not in each tool: the 51 call sites write their own `trackMCP`
 * rows by hand at entry, before any work happens, so none of them can carry a
 * duration. Wrapping at the registry gives every tool, current and future, the
 * same completion row from one place, and leaves the existing rows untouched.
 *
 * The wrapper is transparent: the result is returned as-is and a throw is
 * rethrown, so tool behaviour and the SDK's own error handling do not change.
 * The event is fire-and-forget; a telemetry failure never affects the call.
 *
 * Task-style handlers (objects with `createTask`) are left alone — none of our
 * tools use them, and the SDK dispatches them differently.
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

    // Assign directly rather than via `tool.update()`: update() also fires a
    // tools/list_changed notification, which is noise at registration time.
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
    // Telemetry must never decide whether a tool call succeeds.
  }
}
