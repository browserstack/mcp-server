import { AsyncLocalStorage } from "node:async_hooks";

/** Statuses by which a product refuses the account rather than the request. */
export const BLOCKED_STATUSES: ReadonlySet<number> = new Set([
  401, 402, 403, 429,
]);

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
   * With `callerFault`: the account or plan refused the call. For a refusal the product
   * reports in prose inside a 2xx (a fair-usage limit, a quota), where no 401/402/403/429
   * ever reaches the status.
   */
  blocked?: boolean;
  /**
   * The product reported its own failure inside a successful answer ("something went
   * wrong" in a 200). Attributed upstream, the same as a 5xx would be.
   */
  upstreamFault?: boolean;
  /**
   * Set when the Test Management region probe failed before any product call: the
   * US host's answer (an HTTP status, or 0 when the connection was never answered).
   * Survives a catch block that rewraps the error into a returned result.
   */
  probeStatus?: number;
  /**
   * With `probeStatus`: every host the probe tried refused the account (401, 402, 403
   * or 429). Only then is the failure the account's own; a host that timed out or
   * answered 5xx leaves open that it was the account's region, and the probe failed.
   */
  probeBlocked?: boolean;
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
 * handler that returns its error; one that throws uses `CallerError`. Pass `"blocked"`
 * when the product refused the account in prose (an entitlement, quota or rate limit
 * with no 4xx behind it), so the row joins the blocked rate. A no-op outside a call.
 */
export function markCallerFault(reason?: "blocked"): void {
  const scope = upstreamScope.getStore();
  if (!scope) return;
  scope.callerFault = true;
  if (reason === "blocked") scope.blocked = true;
}

/**
 * Marks the current tool call as failing in the product, for a handler that read the
 * failure off a 2xx body rather than a status. Outranks a caller tag, as a 5xx does. A
 * no-op outside a call.
 */
export function markUpstreamFault(): void {
  const scope = upstreamScope.getStore();
  if (scope) scope.upstreamFault = true;
}

/**
 * Marks the current tool call as having failed in the Test Management region probe,
 * with what the US host answered and whether every host refused the account. A no-op
 * outside a call.
 */
export function recordRegionProbeFailure(
  usStatus: number,
  everyHostBlocked = false,
): void {
  const scope = upstreamScope.getStore();
  if (!scope || !Number.isInteger(usStatus)) return;
  scope.probeStatus = usStatus;
  scope.probeBlocked = everyHostBlocked;
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
