/**
 * Run a capability declared as `steps`: its siblings in order, each fed from the last.
 *
 * ONE PLACE FOR THE RULES. A `{name}` in a step's arguments is filled from the chain's
 * own arguments or from what an earlier step took, and nothing else; a name nothing
 * supplies is a refusal before any request is sent. A step runs through exactly the
 * path a direct call would — polling, fallbacks, origins — so a chain cannot do anything
 * its steps could not. The answer is the map of everything taken, and a refused step
 * ends the chain with that refusal, named.
 */

import { GroupedArguments } from "./bind.js";
import { FallbackOutcome, Lookup } from "./fallback.js";
import { InvocationError } from "./index-loader.js";
import { PollOutcome, Polled, pointer } from "./poll.js";
import { InvokeResult } from "./resolve.js";
import { Capability, ChainStep } from "./types.js";

export interface StepReport {
  capability: string;
  status: number;
  polled?: Polled;
  fallback_steps?: number;
}

export interface ChainOutcome {
  result: InvokeResult;
  chain: StepReport[];
}

/** Runs one step the way invokeCapability runs a direct call. */
export type StepRunner = (
  capability: Capability,
  args: GroupedArguments,
) => Promise<PollOutcome<FallbackOutcome>>;

const PLACEHOLDER = /^\{([A-Za-z0-9_]+)\}$/;

function handle(capability: Capability): string {
  return capability.name || `${capability.method} ${capability.path}`;
}

/** The `{name}` placeholders a step's arguments name. */
export function stepPlaceholders(step: ChainStep): string[] {
  const names: string[] = [];
  for (const group of [step.path_params, step.query, step.body])
    for (const value of Object.values(group ?? {})) {
      const m = typeof value === "string" ? PLACEHOLDER.exec(value) : null;
      if (m) names.push(m[1]);
    }
  return names;
}

function fill(
  chain: Capability,
  step: ChainStep,
  group: Record<string, unknown> | undefined,
  vars: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!group) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(group)) {
    const m = typeof value === "string" ? PLACEHOLDER.exec(value) : null;
    if (!m) {
      out[key] = value;
      continue;
    }
    const supplied = vars[m[1]];
    if (supplied === undefined || supplied === null || supplied === "")
      throw new InvocationError(
        `${handle(chain)}: step ${step.capability} needs '${m[1]}', which neither the ` +
          "call nor an earlier step supplied",
      );
    out[key] = supplied;
  }
  return out;
}

export async function runChain(
  chain: Capability,
  args: GroupedArguments,
  lookup: Lookup,
  runStep: StepRunner,
): Promise<ChainOutcome> {
  const vars: Record<string, unknown> = {
    ...(args.path_params ?? {}),
    ...(args.query ?? {}),
    ...(args.body ?? {}),
  };
  const taken: Record<string, unknown> = {};
  const report: StepReport[] = [];
  for (const step of chain.steps ?? []) {
    const target = lookup(step.capability);
    const stepArgs: GroupedArguments = {
      path_params: fill(chain, step, step.path_params, vars),
      query: fill(chain, step, step.query, vars),
      body: fill(chain, step, step.body, vars),
    };
    const { outcome, polled } = await runStep(target, stepArgs);
    const result = outcome.result;
    report.push({
      capability: step.capability,
      status: result.http_response.status,
      ...(polled ? { polled } : {}),
      ...(outcome.attempts
        ? { fallback_steps: outcome.attempts.length - 1 }
        : {}),
    });
    if (!result.ok) return { result, chain: report };
    for (const [name, path] of Object.entries(step.take ?? {})) {
      const value = pointer(result.http_response.body, path);
      if (value === undefined)
        throw new InvocationError(
          `${handle(chain)}: step ${step.capability} answered without '${path}', ` +
            `which the chain takes as '${name}'`,
        );
      vars[name] = value;
      taken[name] = value;
    }
  }
  return {
    result: {
      ok: true,
      completed: true,
      http_response: { status: 200, body: taken },
    },
    chain: report,
  };
}
