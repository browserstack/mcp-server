export const READ_RETRY_DELAYS_MS = [300, 1000];

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryReadOptions {
  retryOnError?: boolean;
  delaysMs?: readonly number[];
}

/** Only for requests that change nothing: a failed write may already have taken effect. */
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
