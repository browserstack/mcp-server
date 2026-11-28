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
 * THE CHOICE BETWEEN AGENTS IS NOT MADE HERE. BrowserStack AI routes on the task's wording against
 * each agent's own trigger, so the matches are a hint about which agent will run, never a
 * selection. That is also why no agent name is sent anywhere.
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

/**
 * The handoff block. The instruction is the point of it: the request goes VERBATIM, because
 * the agent reads its requirement from the task text and BrowserStack AI routes on the same words.
 */
export function agentHandoff(product: string, matches: AgentMatch[]) {
  return {
    product,
    agents: matches.map(({ agent }) => agentSummary(agent)),
    next_step:
      `This task belongs to a BrowserStack AI agent. Call askBrowserStackAI with product ` +
      `'${product}' and the user's request as \`query\`, verbatim, including any ` +
      "requirement text they gave. It picks and runs the agent. Do not rebuild the task " +
      "from capabilities, unless askBrowserStackAI says Ask AI is not enabled on this " +
      "account: then do the task with the capabilities instead.",
  };
}
