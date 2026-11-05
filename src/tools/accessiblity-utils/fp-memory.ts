import { apiClient } from "../../lib/apiClient.js";
import { getRegionalHost } from "../../lib/regional-host.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import logger from "../../logger.js";

/**
 * The account's false-positive (FP) memory: what users and their agents said is not a real
 * issue, saved per rule so later reports can be filtered without asking the user again.
 *
 * Saving, reading and revoking entries are web_accessibility capabilities (no tool of their
 * own, so the catalog stays within its description budget). This module only reads the
 * memory for the rules of the issues fetchAccessibilityIssues is answering with, so it
 * arrives with them whether or not the agent thinks to ask for it.
 */

/** The capabilities an answer names: keep in step with web_accessibility's index. */
export const SUBMIT_CAPABILITY = "submit_false_positive_feedback";
export const READ_CAPABILITY = "get_false_positive_memory";

/** A read made while answering with issues must not hold the issues back for long. */
const MEMORY_READ_TIMEOUT_MS = 8_000;

/** How much of an answer the memory may take; a rule's oldest entries go first. */
export const MEMORY_CHARACTERS = 24_000;
const SNIPPET_CHARACTERS = 200;

export interface FpEntry {
  id: number;
  site: string;
  global: boolean;
  verdict: string;
  matchScope: string;
  rootCause: string;
  pattern: Record<string, unknown>;
  evidence?: Record<string, unknown> | null;
  counterExamples?: unknown[] | null;
  userStatement: string;
  seedIssue?: { pageUrl?: string; component?: string; htmlSnippet?: string };
}

export interface FpRuleMemory {
  ruleCode: string;
  docsUrl: string;
  entryCount: number;
  entries: FpEntry[];
}

export interface FpMemory {
  rules: FpRuleMemory[];
  truncated: boolean;
}

/**
 * The memory for the rules of the issues being answered with. Undefined when the account
 * does not have it (403: its release flag is off) or it cannot be read in time: the issues
 * are then answered without it, never not at all.
 */
export async function memoryForReport(
  auth: { username: string; password: string },
  ruleCodes: string[],
): Promise<FpMemory | undefined> {
  if (ruleCodes.length === 0) return undefined;
  try {
    const resp = await apiClient.get({
      url: `${getRegionalHost("accessibilityApi")}/api/fp-memory/v1/memory?ruleCodes=${encodeURIComponent(ruleCodes.join(","))}`,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${auth.username}:${auth.password}`).toString("base64"),
      },
      timeout: MEMORY_READ_TIMEOUT_MS,
      raise_error: false,
    });
    if (resp.status === 403) return undefined;
    if (!resp.ok || !resp.data?.success) {
      logger.warn(`False-positive memory not read: HTTP ${resp.status}`);
      return undefined;
    }
    return resp.data.data as FpMemory;
  } catch (error) {
    logger.warn(
      `False-positive memory not read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function compactEntry(entry: FpEntry) {
  const snippet = entry.seedIssue?.htmlSnippet ?? "";
  return {
    id: entry.id,
    site: entry.global ? "all sites" : entry.site,
    verdict: entry.verdict,
    scope: entry.matchScope,
    root_cause: entry.rootCause,
    pattern: entry.pattern,
    ...(entry.counterExamples?.length
      ? { counter_examples: entry.counterExamples }
      : {}),
    ...(entry.evidence ? { evidence: entry.evidence } : {}),
    user_statement: entry.userStatement,
    seed_issue: {
      page: entry.seedIssue?.pageUrl,
      component: entry.seedIssue?.component,
      ...(snippet
        ? {
            html:
              snippet.length > SNIPPET_CHARACTERS
                ? `${snippet.slice(0, SNIPPET_CHARACTERS)}…`
                : snippet,
          }
        : {}),
    },
  };
}

/**
 * The memory as an answer carries it, within `budget` characters: each rule with its docs
 * link and its entries, newest first. When it does not fit, the oldest entries of the
 * fullest rule are left out first, and counted, so the agent knows to read the rest.
 */
export function memoryPayload(
  memory: FpMemory,
  budget = MEMORY_CHARACTERS,
): { json: string; omitted: { rule: string; count: number }[] } {
  const rules = memory.rules.map((rule) => ({
    rule: rule.ruleCode,
    docs: rule.docsUrl,
    entries: rule.entries.map(compactEntry),
  }));
  const omitted = new Map<string, number>();
  let json = JSON.stringify(rules);
  while (json.length > budget) {
    const fullest = rules.reduce((a, b) =>
      b.entries.length > a.entries.length ? b : a,
    );
    if (fullest.entries.length <= 1) break;
    fullest.entries.pop();
    omitted.set(fullest.rule, (omitted.get(fullest.rule) ?? 0) + 1);
    json = JSON.stringify(rules);
  }
  return {
    json,
    omitted: [...omitted].map(([rule, count]) => ({ rule, count })),
  };
}

export const FP_APPLY_NOTE =
  "False-positive memory: below are issues this account's users already confirmed are not real, saved per rule. Before showing the issues, remove the ones the memory covers, and do not ask the user about them again. Apply an entry only to issues of the same rule (issue_type), on its site (the host of an issue's affected_page) unless it says all sites. Match on its pattern and root_cause, never on selector or exact HTML: ids, selectors and labels differ per page and language. Remove automatically only up to the entry's scope (element: that element; component: the same component; component_family: any component its pattern.predicate describes; site_predicate: anything on the site the predicate describes). Never remove a counter_example. List issues that look like the same pattern but fall outside the scope as likely false positives and ask the user once per group; if they agree, save that at the wider scope. Say how many issues you removed per rule, with the entry ids. Each rule's docs link explains what the rule checks.";

export const FP_FILING_GUIDE = `When the user says an issue is not a real problem, save it with the web_accessibility capability ${SUBMIT_CAPABILITY} (invokeCapability), so later reports are filtered without asking again. First inspect the element yourself (open the page if you have a browser, else read the issue's HTML): what it is built from (tag, custom element, shadow root, classes, design system) and why the rule is wrong about it. Write rootCause about how the element is built, not only that it works for the user, and pattern.predicate as the widest set of elements that root cause covers (e.g. every custom element of the same design system). Propose that scope and ask the user to confirm it, and to name any similar element that is a real issue (counterExamples). Quote the user as they said it in userStatement. Mark global only when the user says it holds on all their sites.`;

/** What an issues answer adds for the memory: how to apply it, the memory, how to add to it. */
export function memoryMessages(memory: FpMemory | undefined): string[] {
  if (!memory) return [];
  if (memory.rules.length === 0) return [FP_FILING_GUIDE];
  const { json, omitted } = memoryPayload(memory);
  return [
    FP_APPLY_NOTE,
    `False-positive memory: ${wrapUntrusted("saved false positives (user-written)", json)}`,
    ...(omitted.length || memory.truncated
      ? [
          `Not all entries fit here${omitted.length ? ` (${omitted.map((o) => `${o.count} older entries of ${o.rule}`).join(", ")})` : ""}. When an issue of such a rule is not covered by the entries above, read that rule's entries with the web_accessibility capability ${READ_CAPABILITY}.`,
        ]
      : []),
    FP_FILING_GUIDE,
  ];
}
