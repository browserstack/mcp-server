/**
 * Rate limit on starting real-device / browser sessions.
 *
 * A sliding one-hour window per BrowserStack user, shared by device and
 * browser sessions and checked before anything reaches BrowserStack. In the
 * shared HTTP deployment this is the server-side gate for every user of that
 * server; BrowserStack's own parallel/queue caps still apply on top.
 */
const WINDOW_MS = 60 * 60 * 1000;
const starts = new Map<string, number[]>();

export function takeSessionStart(
  owner: string,
  limitPerHour: number,
  now = Date.now(),
): void {
  if (limitPerHour <= 0) return;
  const recent = (starts.get(owner) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limitPerHour) {
    const retryMin = Math.ceil((WINDOW_MS - (now - recent[0])) / 60_000);
    starts.set(owner, recent);
    throw new Error(
      `Session start limit reached: ${limitPerHour} per hour for this user. Try again in about ${retryMin} minute(s), or reuse an open session.`,
    );
  }
  recent.push(now);
  starts.set(owner, recent);
}

export function __resetRateLimitForTests(): void {
  starts.clear();
}
