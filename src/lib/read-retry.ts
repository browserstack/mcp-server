/** Waits before the second and third attempt of a read. */
export const READ_RETRY_DELAYS_MS = [300, 1000];

/** Gateway answers that come back on a later try. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryReadOptions {
  /** Try again when the attempt throws. Off where a throw is not a network failure. */
  retryOnError?: boolean;
  delaysMs?: readonly number[];
}

/**
 * Runs a read, trying again after a short wait when it throws or when `isTransient` says
 * the answer is worth another try. Only for requests that change nothing: a write that
 * failed mid-flight may already have taken effect.
 */
export async function retryRead<T>(
  attempt: () => Promise<T>,
  isTransient: (result: T) => boolean = () => false,
  {
    retryOnError = true,
    delaysMs = READ_RETRY_DELAYS_MS,
  }: RetryReadOptions = {},
): Promise<T> {
  for (const delay of delaysMs) {
    let result: T;
    try {
      result = await attempt();
    } catch (error) {
      if (!retryOnError) throw error;
      await sleep(delay);
      continue;
    }
    if (!isTransient(result)) return result;
    await sleep(delay);
  }
  return attempt();
}

export function isTransientResponse(response: { status: number }): boolean {
  return RETRYABLE_STATUSES.has(response.status);
}
