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

/** The most entries one read returns; more than the answer's budget below holds anyway. */
const MEMORY_PAGE_SIZE = 200;

/** How much of an answer the memory may take; a rule's oldest entries go first. */
export const MEMORY_CHARACTERS = 24_000;
const SNIPPET_CHARACTERS = 200;

export interface FpEntry {
  id: string;
  site: string;
  global: boolean;
  verdict: string;
  scope: string;
  rootCause: string;
  pattern: Record<string, unknown>;
  evidence?: Record<string, unknown> | null;
  counterExamples?: unknown[] | null;
  userStatement: string;
  pageUrl?: string;
  component?: string;
  htmlSnippet?: string;
}

export interface FpRuleMemory {
  ruleCode: string;
  docsUrl: string;
  entryCount: number;
  entries: FpEntry[];
}

export interface FpMemory {
  rules: FpRuleMemory[];
  /** Set when the account holds more entries for these rules than one read returns. */
  nextCursor: string | null;
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
      url: `${getRegionalHost("accessibilityApi")}/api/fp-memory/v1/memory?ruleCodes=${encodeURIComponent(ruleCodes.join(","))}&limit=${MEMORY_PAGE_SIZE}`,
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
  const snippet = entry.htmlSnippet ?? "";
  return {
    id: entry.id,
    site: entry.global ? "all sites" : entry.site,
    verdict: entry.verdict,
    scope: entry.scope,
    root_cause: entry.rootCause,
    pattern: entry.pattern,
    ...(entry.counterExamples?.length
      ? { counter_examples: entry.counterExamples }
      : {}),
    ...(entry.evidence ? { evidence: entry.evidence } : {}),
    user_statement: entry.userStatement,
    seed_issue: {
      page: entry.pageUrl,
      component: entry.component,
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
  "How to apply the false-positive memory: an issue marked saved_fp_entries has false positives saved for its rule (issue_type) on its site; compare it with those entries only. Match on an entry's pattern and root_cause, never on selector or exact HTML: ids, selectors and labels differ per page and language. Remove it when the entry covers it within the entry's scope (element: that element; component: the same component; component_family: any component its pattern.predicate describes; site_predicate: anything on the site the predicate describes), and do not ask the user about it again. Never remove a counter_example. A marked issue that looks like the same pattern but falls outside the scope is a likely false positive: ask the user once per group, and if they agree save it at the wider scope. An issue without saved_fp_entries is not covered by the memory. Each rule's docs link explains what the rule checks.";

export const FP_FILING_GUIDE = `When the user says an issue is not a real problem, save it with the web_accessibility capability ${SUBMIT_CAPABILITY} (invokeCapability), so later reports are filtered without asking again. First inspect the element yourself (open the page if you have a browser, else read the issue's HTML): what it is built from (tag, custom element, shadow root, classes, design system) and why the rule is wrong about it. Write rootCause about how the element is built, not only that it works for the user, and pattern.predicate as the widest set of elements that root cause covers (e.g. every custom element of the same design system). Propose that scope and ask the user to confirm it, and to name any similar element that is a real issue (counterExamples). Quote the user as they said it in userStatement. Mark global only when the user says it holds on all their sites.`;

/** An issue as an answer lists it: its rule, and the page it is on when the answer spans several. */
interface IssueLike {
  issue_type: string;
  affected_page?: string;
}

/** What an answer with issues says about the memory, and where. */
export interface MemoryView<T> {
  /** The issues, those with saved entries for their rule and site marked saved_fp_entries. */
  records: (T & { saved_fp_entries?: string[] })[];
  /** How many of them are marked. */
  marked: number;
  /** First in the answer: remove the false positives before giving any list or count. */
  lead: string[];
  /** Before the issues: how to apply the memory, the entries, how to save a new one. */
  notes: string[];
  /** After the issues: how to report what is left. */
  closing: string[];
}

function hostOf(page: string | undefined): string | undefined {
  try {
    return page ? new URL(page).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The memory applied to one answer's issues. An agent handed the memory as one note among
 * many reported the report's own totals without filtering, so the issues the memory may
 * cover are marked with their entry ids, the answer opens by saying they are to be removed
 * before anything is reported, and it closes by saying how to report what is left. Only
 * the entries of these issues' rules and sites (or saved for all sites) are shown.
 * `page` is the page every issue is on, when the answer is about one.
 */
export function applyMemory<T extends IssueLike>(
  memory: FpMemory | undefined,
  records: T[],
  page?: string,
): MemoryView<T> {
  if (!memory) return { records, marked: 0, lead: [], notes: [], closing: [] };
  const byRule = new Map(memory.rules.map((rule) => [rule.ruleCode, rule]));
  const used = new Map<string, Set<string>>();
  let marked = 0;
  const annotated = records.map((record) => {
    const host = hostOf(record.affected_page ?? page);
    const ids = (byRule.get(record.issue_type)?.entries ?? [])
      .filter((entry) => entry.global || (host && entry.site === host))
      .map((entry) => entry.id);
    if (ids.length === 0) return record;
    marked++;
    const seen = used.get(record.issue_type) ?? new Set<string>();
    ids.forEach((id) => seen.add(id));
    used.set(record.issue_type, seen);
    return { ...record, saved_fp_entries: ids };
  });
  if (marked === 0) {
    return { records, marked, lead: [], notes: [FP_FILING_GUIDE], closing: [] };
  }
  const shown: FpMemory = {
    nextCursor: memory.nextCursor,
    rules: memory.rules
      .filter((rule) => used.has(rule.ruleCode))
      .map((rule) => {
        const entries = rule.entries.filter((e) =>
          used.get(rule.ruleCode)!.has(e.id),
        );
        return { ...rule, entries, entryCount: entries.length };
      }),
  };
  const { json, omitted } = memoryPayload(shown);
  return {
    records: annotated,
    marked,
    lead: [
      `⚠️ Saved false positives apply to this report: ${marked} of the ${records.length} issues below are marked saved_fp_entries, as this account's users already confirmed false positives of their rule on their site. Before you give the user any list, count or summary of issues, check each marked issue against its entries (memory and how to apply it are below) and remove the ones they cover. The user already confirmed these, so do not ask them to confirm again, and leave them out even when the user asks for the full list or all issues: their report is the issues that are left. Every count in this answer is from before that removal.`,
    ],
    notes: [
      FP_APPLY_NOTE,
      `False-positive memory: ${wrapUntrusted("saved false positives (user-written)", json)}`,
      ...(omitted.length || memory.nextCursor
        ? [
            `Not all entries fit here${omitted.length ? ` (${omitted.map((o) => `${o.count} older entries of ${o.rule}`).join(", ")})` : ""}. When a marked issue is not covered by the entries above, read its rule's entries with the web_accessibility capability ${READ_CAPABILITY} (ruleCodes set to its rule; pass each page's nextCursor as cursor for the next).`,
          ]
        : []),
      FP_FILING_GUIDE,
    ],
    closing: [
      "When you answer the user: list only the issues left after removing the saved false positives, and lead with how many are left; say how many you removed for each rule, with the entry ids; and say that the report's own totals above count them, so the issues left are that many fewer.",
    ],
  };
}
