/**
 * Try the next thing when the product refuses, as the index says to.
 *
 * ONE REQUEST, ONE RESPONSE is still the rule for every capability that declares nothing
 * here. A `fallbacks` list is the one authored exception: when THIS call answers a given
 * status, the index knows a sibling capability that may do the job, and names it with the
 * body to send. The chain exists for hide_keyboard on an iPhone, where the plain call
 * answers 400 because the keyboard has no dismiss key, and the only way on is to press one
 * of its own keys — Done where it exists, Return where it does not.
 *
 * The caller's consent covers the chain: it was given for the capability invoked, and the
 * chain is that capability's published contract. What a step may do — press Return, which
 * an app may treat as submit — is therefore the capability's guidance to state, not
 * something this module decides. It does refuse two things no guidance could make right: a
 * step naming a destructive capability, and one naming a capability this surface will not
 * call.
 *
 * Every attempt is reported, in order, with the status it got, so the caller knows which
 * step did the work and can read the screen back afterwards.
 */

import { GroupedArguments } from "./bind.js";
import { InvocationError } from "./index-loader.js";
import { InvokeResult } from "./resolve.js";
import { Capability } from "./types.js";

export interface Attempt {
  capability: string;
  status: number;
  /** The authored body the step sent, so the caller can see which keys were tried. */
  body?: Record<string, unknown>;
}

export interface FallbackOutcome {
  /** The last response: the first 2xx, or the final refusal. */
  result: InvokeResult;
  /** Present only when the chain ran; the first entry is the original call. */
  attempts?: Attempt[];
}

/** Makes one request for one capability — `invoke`, with the deps already bound. */
export type Runner = (
  capability: Capability,
  args: GroupedArguments,
) => Promise<InvokeResult>;

/** Resolves a step's name within the product of the capability being invoked. */
export type Lookup = (name: string) => Capability;

function handle(capability: Capability): string {
  return capability.name || `${capability.method} ${capability.path}`;
}

export async function invokeWithFallbacks(
  capability: Capability,
  args: GroupedArguments,
  run: Runner,
  lookup: Lookup,
): Promise<FallbackOutcome> {
  let result = await run(capability, args);
  const chain = capability.fallbacks ?? [];
  if (result.ok || chain.length === 0) return { result };

  const attempts: Attempt[] = [
    { capability: handle(capability), status: result.http_response.status },
  ];
  for (const step of chain) {
    // Matched against the LATEST status, not the first: a step that answers something
    // the next step does not name ends the chain there, with that answer.
    if (result.http_response.status !== step.when.status) continue;
    const next = lookup(step.capability);
    if (next.mode === "destructive")
      throw new InvocationError(
        `${handle(capability)} names ${step.capability} as a fallback, which is destructive and cannot run`,
      );
    if (next.invocable === false)
      throw new InvocationError(
        `${handle(capability)} names ${step.capability} as a fallback, which cannot be called on this server`,
      );
    // Only the path parameters travel: the step's body and query are the index's own, so
    // a caller cannot steer the chain into sending something the contract never showed.
    result = await run(next, {
      path_params: args.path_params,
      query: step.query,
      body: step.body,
    });
    attempts.push({
      capability: step.capability,
      status: result.http_response.status,
      ...(step.body ? { body: step.body } : {}),
    });
    if (result.ok) break;
  }
  // A chain that matched nothing is not a chain that ran: the caller sees the plain
  // refusal, as it would from a capability that declares no fallbacks at all.
  return attempts.length > 1 ? { result, attempts } : { result };
}
