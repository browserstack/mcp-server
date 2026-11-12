import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What one tool call learned about its own failure: the HTTP status of the last product
 * API call (0 means the API could not be reached), and whether the handler rejected the
 * caller's input. AsyncLocalStorage keeps concurrent (multi-tenant) calls apart. Lives
 * outside instrumentation.ts so apiClient and error.ts can record without an import cycle.
 */
export interface UpstreamScope {
  status?: number;
  callerFault?: boolean;
  /**
   * Set when the Test Management region probe failed before any product call: the
   * US host's answer (an HTTP status, or 0 when the connection was never answered).
   * Survives a catch block that rewraps the error into a returned result.
   */
  probeStatus?: number;
}

const upstreamScope = new AsyncLocalStorage<UpstreamScope>();

export function withUpstreamScope<T>(scope: UpstreamScope, fn: () => T): T {
  return upstreamScope.run(scope, fn);
}

/** Records a product API answer for the current tool call. A no-op outside one. */
export function recordUpstreamStatus(status: number): void {
  const scope = upstreamScope.getStore();
  if (scope && Number.isInteger(status)) scope.status = status;
}

/**
 * Marks the current tool call as failing on the caller's input or account set-up. For a
 * handler that returns its error; one that throws uses `CallerError`. A no-op outside a call.
 */
export function markCallerFault(): void {
  const scope = upstreamScope.getStore();
  if (scope) scope.callerFault = true;
}

/**
 * Marks the current tool call as having failed in the Test Management region probe,
 * with what the US host answered. A no-op outside a call.
 */
export function recordRegionProbeFailure(usStatus: number): void {
  const scope = upstreamScope.getStore();
  if (scope && Number.isInteger(usStatus)) scope.probeStatus = usStatus;
}

/** `fetch` that records the answer's status, or 0 when there was none. */
export async function trackedFetch(
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  try {
    const response = await fetch(...args);
    recordUpstreamStatus(response.status);
    return response;
  } catch (error) {
    recordUpstreamStatus(0);
    throw error;
  }
}
