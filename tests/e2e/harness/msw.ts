/**
 * L3 network layer. MSW intercepts axios (node http/https) and fetch in this process.
 *
 * - A request that no handler matches FAILS the test ("unknown URL = FAIL").
 * - Every request is recorded, so a case can check the host, the method and that no
 *   call was made (bad input).
 * - Telemetry rows go to the instrumentation endpoint. They are answered and not
 *   recorded, so cases see only the calls the tool makes.
 */
import { setupServer } from "msw/node";
import { http, HttpResponse, type RequestHandler } from "msw";

export const INSTRUMENTATION_URL = "https://api.browserstack.com/sdk/v1/event";

export interface RecordedCall {
  method: string;
  url: URL;
}

const calls: RecordedCall[] = [];
const unhandled: string[] = [];

const telemetry = http.post(INSTRUMENTATION_URL, () =>
  HttpResponse.json({ ok: true }),
);

export const mswServer = setupServer(telemetry);

mswServer.events.on("request:start", ({ request }) => {
  if (request.url === INSTRUMENTATION_URL) return;
  calls.push({ method: request.method, url: new URL(request.url) });
});

/** Starts MSW for one test file. Unknown URLs are kept and thrown by `assertNoUnhandled`. */
export function startMsw(): void {
  mswServer.listen({
    onUnhandledRequest(request) {
      unhandled.push(`${request.method} ${request.url}`);
    },
  });
}

export function stopMsw(): void {
  mswServer.close();
}

/** Clears the handlers and the recorded calls of the previous case. */
export function resetMsw(handlers: RequestHandler[] = []): void {
  mswServer.resetHandlers(telemetry, ...handlers);
  calls.length = 0;
  unhandled.length = 0;
}

export function recordedCalls(): readonly RecordedCall[] {
  return calls;
}

export function unhandledRequests(): readonly string[] {
  return unhandled;
}
