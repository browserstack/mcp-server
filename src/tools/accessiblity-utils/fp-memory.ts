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

/**
 * How much of a first page the marked issues of later pages may take, listed short. Past
 * it they are counted by rule and page instead: a broad entry can cover most of a report,
 * and the first page must still fit a client's limit on a tool's result.
 */
export const LATER_CHARACTERS = 10_000;
const LATER_SNIPPET_CHARACTERS = 120;

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
  page?: string,
): Promise<FpMemory | undefined> {
  if (ruleCodes.length === 0) return undefined;
  // With the page known, other sites' entries stay out of the page of entries read.
  const site = page ? `&site=${encodeURIComponent(page)}` : "";
  try {
    const resp = await apiClient.get({
      url: `${getRegionalHost("accessibilityApi")}/api/fp-memory/v1/memory?ruleCodes=${encodeURIComponent(ruleCodes.join(","))}&limit=${MEMORY_PAGE_SIZE}${site}`,
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
    const memory = resp.data.data;
    if (!Array.isArray(memory?.rules)) {
      logger.warn("False-positive memory not read: no rules in the response");
      return undefined;
    }
    return {
      nextCursor: memory.nextCursor ?? null,
      rules: memory.rules.map((rule: FpRuleMemory) => ({
        ...rule,
        entries: Array.isArray(rule.entries) ? rule.entries : [],
      })),
    };
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

/**
 * How an agent reviews a report for false positives and saves the ones the user confirms.
 * It comes with every answer that has the memory, not only after the user objects to an
 * issue: an agent told only to save what the user disputes never looked for false
 * positives itself, so the memory grew only as fast as users complained.
 */
export const FP_REVIEW_GUIDE = `Review these issues for false positives before you report them. A confirmed issue (no needs_review) can still be wrong about how the element is built: a role or name set inside a shadow root or by a design system, or a landmark that a parent already provides. For each issue that looks like this, check the element as the page renders it. Open the page in a browser if you can (for local code, from the dev server) and read the element's computed role and name, its place in the accessibility tree, its shadow DOM and its parents. If you can't render it, check the source and the issue's HTML, and say it wasn't checked rendered. Keep these issues in your list and counts, and show them to the user separately as likely false positives, each with a one-line reason. Save each one the user confirms with the web_accessibility capability ${SUBMIT_CAPABILITY} (invokeCapability), so later reports drop it. Do the same when the user says on their own that an issue is not real. Before you save: write rootCause about how the element is built, not only that it works for the user; write pattern.predicate as the widest set of elements that root cause covers (e.g. every custom element of the same design system); and put what you checked in evidence.observations, including what you could not verify. Show the user the rule, site, scope, predicate and rootCause you will save. Ask them to confirm these, and to name any similar element that is a real issue (counterExamples). Quote the user in userStatement. If they only said yes, ask for one line on why and quote that. Mark global only when the user says it holds on all their sites.`;

/** One line for the server instructions, so an agent knows the memory exists before it reads a report. */
export const FP_INSTRUCTION = `When the user confirms a web accessibility issue is a false positive, save it with the web_accessibility capability ${SUBMIT_CAPABILITY}, so later reports drop it.`;

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
  /** After the issues: the marked issues on later pages, with the cursor of their page. */
  later: string[];
  /** How many issues on later pages are marked. */
  laterMarked: number;
  /** Of those, how many are only counted, not listed: their pages have to be read. */
  laterUnlisted: number;
}

/** A later page's marked issue as the first page lists it: enough to match and to find. */
function laterRow(
  record: IssueLike & { saved_fp_entries?: string[] },
  cursor: number,
): Record<string, unknown> {
  const { issue_type, severity, component, HTML_snippet, needs_review } =
    record as IssueLike & Record<string, unknown>;
  const html =
    typeof HTML_snippet === "string" &&
    HTML_snippet.length > LATER_SNIPPET_CHARACTERS
      ? `${HTML_snippet.slice(0, LATER_SNIPPET_CHARACTERS)}…`
      : HTML_snippet;
  return Object.fromEntries(
    Object.entries({
      issue_type,
      severity,
      component,
      html,
      affected_page: record.affected_page,
      needs_review,
      saved_fp_entries: record.saved_fp_entries,
      page_cursor: cursor,
    }).filter(([, value]) => value !== undefined),
  );
}

/** The later pages' marked issues: listed while they fit, the rest counted by rule and page. */
function laterSection(
  rows: Record<string, unknown>[],
  budget: number,
): { text: string[]; unlisted: number } {
  if (rows.length === 0) return { text: [], unlisted: 0 };
  const listed: Record<string, unknown>[] = [];
  let length = 2;
  for (const row of rows) {
    const add = JSON.stringify(row).length + 1;
    if (length + add > budget) break;
    listed.push(row);
    length += add;
  }
  const rest = rows.slice(listed.length);
  const where = new Map<string, Map<number, number>>();
  for (const row of rest) {
    const byPage = where.get(String(row.issue_type)) ?? new Map();
    const cursor = Number(row.page_cursor);
    byPage.set(cursor, (byPage.get(cursor) ?? 0) + 1);
    where.set(String(row.issue_type), byPage);
  }
  const counted = [...where]
    .map(
      ([rule, pages]) =>
        `${rule}: ${[...pages].map(([cursor, n]) => `${n} on the page at cursor ${cursor}`).join(", ")}`,
    )
    .join("; ");
  return {
    text: [
      ...(listed.length
        ? [
            `Issues on later pages that saved false positives may cover${rest.length ? ` (the first ${listed.length} of ${rows.length})` : ""}. They are in the report's totals and in the CSV; remove the ones their entries cover, as for this page's: ${wrapUntrusted("accessibility scan results on later pages", JSON.stringify(listed))}`,
          ]
        : []),
      ...(rest.length
        ? [
            `${rest.length} ${listed.length ? "more " : ""}marked issues on later pages are too many to list here: ${counted}. Read those pages with their cursors (their issues come marked there) and remove the ones the entries cover; the CSV does not mark them.`,
          ]
        : []),
    ],
    unlisted: rest.length,
  };
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
 * `page` is the page every issue is on, when the answer is about one. `laterPages` are the
 * report's pages after this one, on its first page: an agent that stopped there, or read
 * the CSV (which has no memory), reported the false positives on them as real, so the ones
 * marked there are listed on the first page with the cursor of their page.
 */
export function applyMemory<T extends IssueLike>(
  memory: FpMemory | undefined,
  records: T[],
  page?: string,
  laterPages: { cursor: number; records: T[] }[] = [],
  laterBudget = LATER_CHARACTERS,
): MemoryView<T> {
  const none = { later: [], laterMarked: 0, laterUnlisted: 0 };
  if (!memory)
    return { records, marked: 0, lead: [], notes: [], closing: [], ...none };
  const byRule = new Map(memory.rules.map((rule) => [rule.ruleCode, rule]));
  const used = new Map<string, Set<string>>();
  const mark = (record: T): T & { saved_fp_entries?: string[] } => {
    const host = hostOf(record.affected_page ?? page);
    const ids = (byRule.get(record.issue_type)?.entries ?? [])
      .filter((entry) => entry.global || (host && entry.site === host))
      .map((entry) => entry.id);
    if (ids.length === 0) return record;
    const seen = used.get(record.issue_type) ?? new Set<string>();
    ids.forEach((id) => seen.add(id));
    used.set(record.issue_type, seen);
    return { ...record, saved_fp_entries: ids };
  };
  const annotated = records.map(mark);
  const marked = annotated.filter((r) => r.saved_fp_entries).length;
  const laterIssues = laterPages.flatMap(({ cursor, records: rows }) =>
    rows
      .map(mark)
      .filter((r) => r.saved_fp_entries)
      .map((r) => laterRow(r, cursor)),
  );
  if (marked === 0 && laterIssues.length === 0) {
    const unread = memory.nextCursor
      ? [
          `Not all saved false positives were read here. Before you tell the user an issue is real when they say it is a known false positive, read its rule's entries with the web_accessibility capability ${READ_CAPABILITY} (ruleCodes set to its rule; pass each page's nextCursor as cursor for the next).`,
        ]
      : [];
    return {
      records,
      marked,
      lead: [],
      notes: [...unread, FP_REVIEW_GUIDE],
      closing: [],
      ...none,
    };
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
  const laterMarked = laterIssues.length;
  const later = laterSection(laterIssues, laterBudget);
  const where = [
    ...(marked ? [`${marked} of the ${records.length} issues below`] : []),
    ...(laterMarked
      ? [
          `${laterMarked} ${laterMarked === 1 ? "issue" : "issues"} on later pages of this report (${
            later.unlisted
              ? `${laterMarked - later.unlisted} listed after this page's issues and the rest counted there by rule and page, each with the cursor of its page`
              : "listed after this page's issues, each with the cursor of its page, so you do not need to read those pages or the CSV to remove them"
          })`,
        ]
      : []),
  ].join(" and ");
  return {
    records: annotated,
    marked,
    laterMarked,
    laterUnlisted: later.unlisted,
    lead: [
      `⚠️ Saved false positives apply to this report: ${where} ${marked + laterMarked === 1 ? "is" : "are"} marked saved_fp_entries, as this account's users already confirmed false positives of their rule on their site. Before you give the user any list, count or summary of issues, check each marked issue against its entries (memory and how to apply it are below) and remove the ones they cover. The user already confirmed these, so do not ask them to confirm again, and leave them out even when the user asks for the full list or all issues: their report is the issues that are left. Every count in this answer is from before that removal.`,
    ],
    later: later.text,
    notes: [
      FP_APPLY_NOTE,
      `False-positive memory: ${wrapUntrusted("saved false positives (user-written)", json)}`,
      ...(omitted.length || memory.nextCursor
        ? [
            `Not all entries fit here${omitted.length ? ` (${omitted.map((o) => `${o.count} older entries of ${o.rule}`).join(", ")})` : ""}. When a marked issue is not covered by the entries above, read its rule's entries with the web_accessibility capability ${READ_CAPABILITY} (ruleCodes set to its rule; pass each page's nextCursor as cursor for the next).`,
          ]
        : []),
      FP_REVIEW_GUIDE,
    ],
    closing: [
      "When you answer the user: list only the issues left after removing the saved false positives, and lead with how many are left; say how many you removed for each rule, with the entry ids; and say that the report's own totals above count them, so the issues left are that many fewer.",
    ],
  };
}
