/**
 * A product's agent tool (`testManagementAIAgents`): askBrowserStackAI with the product fixed and the
 * agent named by the caller.
 *
 * It is a second door to the same handler, so approvals, check-backs, questions and uploads
 * behave exactly as they do there. Two things differ: a new turn carries the agent as an
 * `@agent` mention, so BrowserStack AI starts that agent instead of choosing one from the
 * wording; and every `next_step` names this tool, with the agent, instead of
 * askBrowserStackAI.
 */

import { agentsOf } from "../capability-registry/agents.js";
import { indexPaths } from "../capability-registry/config.js";
import { sharedRegistry } from "../capability-registry/shared-registry.js";
import { AgentDoc } from "../capability-registry/types.js";
import { AgentRequest, AskResult } from "./types.js";

export interface AgentVia {
  /** The tool the call came through, e.g. `testManagementAIAgents`. */
  tool: string;
  /** The agent the caller named. */
  agent: AgentDoc;
  /** What the tool takes as `agent` for it, carried back on every `next_step`. */
  handle: string;
}

/**
 * The request fields that start `agent`: the mention BrowserStack AI acts on, and the task
 * led by `@<name>` as a chat message is, so the model reads the same request either way.
 */
export function agentMention(
  query: string,
  agent: AgentDoc,
): Pick<AgentRequest, "task" | "context"> {
  const tag = `@${agent.name}`;
  const task = query.trimStart().startsWith(tag) ? query : `${tag} ${query}`;
  return {
    task,
    context: {
      mentions: [
        {
          type: "agent",
          id: agent.name,
          ...(agent.title ? { title: agent.title } : {}),
        },
      ],
    },
  };
}

/**
 * The result as the agent tool returns it: a `next_step` that calls askBrowserStackAI is
 * pointed at this tool instead, with `agent` (required there) and without `product` (the
 * tool fixes it). Anything else is returned as it came.
 */
export function viaAgentTool(payload: AskResult, via: AgentVia): AskResult {
  const step = payload.next_step;
  if (!step || step.call !== "askBrowserStackAI") return payload;
  const params: Record<string, unknown> = { ...step.params };
  delete params.product;
  return {
    ...payload,
    next_step: {
      instruction: step.instruction.replace(/askBrowserStackAI/g, via.tool),
      call: via.tool,
      params: { agent: via.handle, ...params },
    },
  };
}

/**
 * The product's agents, from the capability index. None when the index cannot be read:
 * then there is no agent tool, and askBrowserStackAI still routes on the wording.
 */
export function indexedAgents(product: string): AgentDoc[] {
  try {
    const { registry } = sharedRegistry(indexPaths(), { announce: false });
    return agentsOf(registry.index.products[product]);
  } catch {
    return [];
  }
}
