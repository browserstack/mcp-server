/**
 * Repeat one call until its answer says what was waited for has happened.
 *
 * The caller still gets ONE answer — the last one — and a `polled` record beside it. The
 * loop lives here rather than in the tool handler so that what counts as "happened", how
 * long to wait and when to wait at all are read off the capability in one place, and so a
 * test can drive it with a clock that does not tick.
 */

import { GroupedArguments } from "./bind.js";
import { InvokeResult } from "./resolve.js";
import { Capability } from "./types.js";

export interface Polled {
  /** How many requests were made, the first included. */
  attempts: number;
  /** Wall-clock seconds from the first request to the last answer. */
  elapsed_seconds: number;
  /** Whether the last answer met the capability's `until`. */
  satisfied: boolean;
}

export interface PollOutcome<T> {
  /** The last answer `run` gave, whole. */
  outcome: T;
  /** Present only when the capability declares `poll` and this call qualified for it. */
  polled?: Polled;
}

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Did the caller supply every parameter `when_given` names, in any group? */
function qualifies(capability: Capability, args: GroupedArguments): boolean {
  const names = capability.poll?.when_given ?? [];
  return names.every((name) => {
    for (const group of [args.path_params, args.query, args.body]) {
      const value = group?.[name];
      if (value !== undefined && value !== null && value !== "") return true;
    }
    return false;
  });
}

/** Whether a body meets the capability's `until`. */
export function satisfied(capability: Capability, body: unknown): boolean {
  const until = capability.poll?.until;
  if (!until) return true;
  if (until === "non_empty") {
    if (Array.isArray(body)) return body.length > 0;
    if (typeof body === "object" && body !== null)
      return Object.keys(body).length > 0;
    return body !== undefined && body !== null && body !== "";
  }
  if ("path" in until) {
    const found = pointer(body, until.path);
    if (Array.isArray(found)) return found.length > 0;
    if (typeof found === "object" && found !== null)
      return Object.keys(found).length > 0;
    return found !== undefined && found !== null && found !== "";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return false;
  const value = (body as Record<string, unknown>)[until.field];
  return until.values.some((candidate) => candidate === value);
}

/** RFC 6901 lookup; undefined when any segment is missing. */
export function pointer(body: unknown, path: string): unknown {
  if (path === "") return body;
  let node: unknown = body;
  for (const raw of path.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) node = node[Number(key)];
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, unknown>)[key];
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * `run` may answer with more than the response — a fallback chain reports its attempts
 * beside it — so the loop is generic over what it hands back and reads the response
 * through `view`. The last `run` answer is returned whole.
 */
export async function invokeWithPolling<T>(
  capability: Capability,
  args: GroupedArguments,
  run: (capability: Capability, args: GroupedArguments) => Promise<T>,
  view: (outcome: T) => InvokeResult,
  sleep: Sleep = realSleep,
  now: () => number = Date.now,
): Promise<PollOutcome<T>> {
  const spec = capability.poll;
  if (!spec || !qualifies(capability, args)) {
    return { outcome: await run(capability, args) };
  }
  const started = now();
  const deadline = started + spec.timeout_seconds * 1000;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const outcome = await run(capability, args);
    const result = view(outcome);
    // A refusal is not "not yet": a 401 or 404 answers the same way every time, and
    // repeating it for the whole timeout would only delay the diagnosis — unless the
    // capability says that status means "not yet" for its product (`keep_on`).
    const met = result.ok && satisfied(capability, result.http_response.body);
    const refused =
      !result.ok && !(spec.keep_on ?? []).includes(result.http_response.status);
    // Stop when met, when refused, or when another wait would overrun the timeout.
    if (met || refused || now() + spec.interval_seconds * 1000 > deadline) {
      return {
        outcome,
        polled: {
          attempts,
          elapsed_seconds: Math.round((now() - started) / 100) / 10,
          satisfied: met,
        },
      };
    }
    await sleep(spec.interval_seconds * 1000);
  }
}
