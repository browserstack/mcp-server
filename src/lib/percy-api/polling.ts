/**
 * Exponential backoff polling utility for Percy API.
 *
 * Used when waiting for async operations to complete (e.g., build processing,
 * AI analysis finishing). Returns null on timeout rather than throwing.
 */

export interface PollOptions {
  /** Initial delay between polls in milliseconds. Default: 500 */
  initialDelayMs?: number;
  /** Maximum delay between polls in milliseconds. Default: 5000 */
  maxDelayMs?: number;
  /** Total timeout in milliseconds. Default: 120000 (2 minutes) */
  maxTimeoutMs?: number;
  /** Optional callback invoked before each poll attempt. */
  onPoll?: (attempt: number) => void;
}

/**
 * Polls `fn` with exponential backoff until it returns `{ done: true }`.
 *
 * Backoff schedule: initialDelay → 2x → 4x → ... capped at maxDelay.
 * Returns the result when done, or null if the timeout is exceeded.
 */
export async function pollUntil<T>(
  fn: () => Promise<{ done: boolean; result?: T }>,
  options?: PollOptions,
): Promise<T | null> {
  const initialDelayMs = options?.initialDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 5_000;
  const maxTimeoutMs = options?.maxTimeoutMs ?? 120_000;
  const onPoll = options?.onPoll;

  const startTime = Date.now();
  let delay = initialDelayMs;
  let attempt = 0;

  while (Date.now() - startTime < maxTimeoutMs) {
    attempt++;
    if (onPoll) {
      onPoll(attempt);
    }

    const response = await fn();
    if (response.done) {
      return response.result ?? null;
    }

    // Check if waiting another cycle would exceed the timeout
    if (Date.now() - startTime + delay >= maxTimeoutMs) {
      break;
    }

    await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }

  // Timeout exceeded
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
