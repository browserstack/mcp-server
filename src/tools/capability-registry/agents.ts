/**
 * BrowserStack AI agents, surfaced beside the capabilities so a client hands the task over
 * instead of rebuilding it from CRUD calls.
 *
 * MATCHING IS DELIBERATELY CONSERVATIVE. A false positive sends a one-line edit through a
 * multi-minute agent run; a false negative only leaves today's behaviour in place. So a
 * request must carry one of the agent's `signals` AND cover enough of one of its `intents`.
 * The signals are what separate "generate test cases from this PRD" from "create a test case
 * named Login": the two share most of their words and only the first is the agent's job.
 *
 * THE CHOICE BETWEEN AGENTS IS NOT MADE HERE. The matches only point the client at the
 * product's agent tool (`tmAIAgents`); the client names the agent there, from that tool's
 * description.
 */

import { singular, terms } from "./search.js";
import { AgentDoc, ProductIndex } from "./types.js";

/** Share of one intent's words the request must contain. */
const MIN_COVERAGE = 0.5;
/** Agents returned for one request. */
const MAX_MATCHES = 2;

export interface AgentMatch {
  agent: AgentDoc;
  /** Best intent coverage, 0..1. */
  score: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * The product's agents, minus any malformed entry.
 *
 * Dropped rather than refused: `agents` is advisory, so a bad entry must not take the
 * capabilities beside it down with a failed load.
 */
export function agentsOf(bundle: ProductIndex | undefined): AgentDoc[] {
  const raw = (bundle as { agents?: unknown } | undefined)?.agents;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is AgentDoc =>
      !!a &&
      typeof a.name === "string" &&
      typeof a.description === "string" &&
      isStringArray(a.signals) &&
      a.signals.length > 0 &&
      isStringArray(a.intents) &&
      a.intents.length > 0,
  );
}

function words(text: string): string[] {
  return [...new Set(terms(text).map(singular))];
}

/** The agents this request reads as, best first. Empty when none clears both bars. */
export function matchAgents(
  bundle: ProductIndex | undefined,
  query: string | undefined,
): AgentMatch[] {
  const asked = new Set(words(query || ""));
  if (asked.size === 0) return [];
  const matches: AgentMatch[] = [];
  for (const agent of agentsOf(bundle)) {
    // A multi-word signal ("data driven") needs all of its words.
    const signalled = agent.signals.some((signal) => {
      const parts = words(signal);
      return parts.length > 0 && parts.every((w) => asked.has(w));
    });
    if (!signalled) continue;
    let best = 0;
    for (const intent of agent.intents) {
      const parts = words(intent);
      if (parts.length === 0) continue;
      const hit = parts.filter((w) => asked.has(w)).length;
      best = Math.max(best, hit / parts.length);
    }
    if (best >= MIN_COVERAGE) matches.push({ agent, score: best });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
}

/** What listProducts shows for each agent: enough to recognise the task, nothing more. */
export function agentSummary(agent: AgentDoc) {
  return {
    name: agent.name,
    ...(agent.title ? { title: agent.title } : {}),
    description: agent.description,
  };
}

/** The tool that runs a product's agents, e.g. `tmAIAgents`. */
export function agentToolName(product: string): string {
  return `${product}AIAgents`;
}

/** What that tool takes as `agent`: authored, else derived from the agent's name. */
export function agentHandle(agent: AgentDoc): string {
  return (
    agent.handle || agent.name.replace(/^[a-z0-9]+-/, "").replace(/-/g, "_")
  );
}

/** What the agent's line adds to its handle, if anything: words a request may use. */
export function agentTagline(agent: AgentDoc): string {
  return (agent.tagline || "").replace(/\.$/, "");
}

const PRODUCT_TITLES: Record<string, string> = {
  tm: "Test Management",
  tra: "Test Reporting & Analytics",
  a11y: "Accessibility",
};

/**
 * The product agent tool's description. Kept short: every client loads every tool's
 * description at connect time, so the agents are listed on `agent` instead.
 */
export function agentToolDescription(product: string): string {
  const title = PRODUCT_TITLES[product] || product;
  return (
    `Run a BrowserStack AI agent for ${title}: it does the whole task and asks ` +
    "before saving. Prefer it to individual tools for the tasks under `agent`."
  );
}

/** The `agent` parameter's description: the agents, one line each. */
export function agentParamDescription(agents: AgentDoc[]): string {
  return agents
    .map((agent) => {
      const line = agentTagline(agent);
      return `- ${agentHandle(agent)}${line ? `: ${line}` : ""}`;
    })
    .join("\n");
}

/**
 * The handoff block. The instruction is the point of it: the request goes VERBATIM, because
 * the agent reads its requirement from the task text.
 */
export function agentHandoff(product: string, matches: AgentMatch[]) {
  const tool = agentToolName(product);
  return {
    product,
    agents: matches.map(({ agent }) => ({
      ...agentSummary(agent),
      agent: agentHandle(agent),
    })),
    next_step:
      `This task belongs to a BrowserStack AI agent. Call ${tool} with \`agent\` set to ` +
      "the agent's `agent` and the user's request as `query`, verbatim, including any " +
      "requirement text they gave. Do not rebuild the task from capabilities, unless " +
      `${tool} says Ask AI is not enabled on this account: then do the task with the ` +
      "capabilities instead.",
  };
}
