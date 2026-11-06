import { apiClient } from "../../lib/apiClient.js";
import { getRegionalHost } from "../../lib/regional-host.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import logger from "../../logger.js";
import { samePage } from "./report-parser.js";

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

/** What an issue is matched on. */
export interface MemoryIssue {
  issue_type: string;
  affected_page: string;
  HTML_snippet: string;
}

/** How many issues one entry left out of an answer. */
export interface LeftOut {
  rule: string;
  entry: number;
  count: number;
}

interface Element {
  tag: string;
  id: string;
  classes: string[];
  /** The whole opening tag, whitespace collapsed; unset when the snippet cuts it short. */
  opening?: string;
}

/** The element an issue's HTML snippet opens with. */
function elementOf(snippet: string | undefined): Element | undefined {
  const match = /^\s*<([a-z][a-z0-9-]*)([^>]*)(>?)/i.exec(snippet ?? "");
  if (!match) return undefined;
  const [, tag, attributes, closed] = match;
  const attribute = (name: string) => {
    const found = new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
      "i",
    ).exec(attributes);
    return found ? (found[1] ?? found[2] ?? found[3] ?? "") : "";
  };
  return {
    tag: tag.toLowerCase(),
    id: attribute("id").toLowerCase(),
    classes: attribute("class").toLowerCase().split(/\s+/).filter(Boolean),
    opening: closed
      ? `<${tag}${attributes}>`.replace(/\s+/g, " ").toLowerCase()
      : undefined,
  };
}

const lowered = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const loweredList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(lowered).filter(Boolean) : [];

/** The words of a text, keeping the hyphens and underscores of tag and class names. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter(Boolean);

/** A sentence that says what an entry does NOT cover. */
const EXCLUDING =
  /\b(?:not|never|except|excluding|exclude[sd]?|unlike)\b|n't\b|other than/i;

/**
 * What an entry is matched on, from its pattern's fields and never from its prose. The one
 * use of prose is to keep an issue: a tag or class named in a sentence of the predicate that
 * excludes it ("Does not cover sbb-breadcrumb"), in an entry saved before excludeTags.
 */
function matcherOf(entry: FpEntry) {
  const pattern = (entry.pattern ?? {}) as Record<string, unknown>;
  const tagName = (value: unknown) =>
    /^[a-z][a-z0-9-]*/.exec(lowered(value))?.[0] ?? "";
  const seed = elementOf(entry.seedIssue?.htmlSnippet);
  // A new sentence starts with a capital: "e.g. button" does not split one.
  const sentences =
    typeof pattern.predicate === "string"
      ? pattern.predicate.split(/(?<=[.!?])\s+(?=[A-Z(])|\n+/)
      : [];
  const kept = new Set([
    ...loweredList(pattern.excludeTags),
    ...(entry.counterExamples ?? []).flatMap((example) =>
      wordsOf(typeof example === "string" ? example : JSON.stringify(example)),
    ),
    ...sentences
      .filter((sentence) => EXCLUDING.test(sentence))
      .flatMap(wordsOf),
  ]);
  return {
    entry,
    site: lowered(entry.site),
    scope: entry.matchScope,
    seed,
    seedPage: entry.seedIssue?.pageUrl,
    tag: tagName(pattern.tag),
    tags: loweredList(pattern.tags).map(tagName).filter(Boolean),
    tagPrefix: lowered(pattern.tagPrefix).replace(/\*+$/, ""),
    classes: loweredList(pattern.classes).map((c) => c.replace(/^\./, "")),
    customOnly: pattern.isCustomElement === true,
    kept,
  };
}

type Matcher = ReturnType<typeof matcherOf>;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function covers(m: Matcher, issue: MemoryIssue, element: Element): boolean {
  if (!m.entry.global && hostOf(issue.affected_page) !== m.site) return false;
  // A counter-example or an excluded element is never left out. A plain tag (div, a) names
  // too much to exclude by; a custom tag, a class or an id does not.
  const names = [
    ...(element.tag.includes("-") ? [element.tag] : []),
    ...element.classes,
    ...(element.id ? [element.id] : []),
  ];
  if (names.some((name) => m.kept.has(name))) return false;
  if (m.customOnly && !element.tag.includes("-")) return false;
  const hasClasses = m.classes.every((c) => element.classes.includes(c));

  switch (m.scope) {
    case "element":
      return (
        element.opening !== undefined &&
        element.opening === m.seed?.opening &&
        samePage(issue.affected_page) === samePage(m.seedPage ?? "")
      );
    case "component": {
      const tag = m.tag || m.seed?.tag;
      return Boolean(tag) && element.tag === tag && hasClasses;
    }
    case "component_family":
    case "site_predicate": {
      const byTag = Boolean(m.tag || m.tags.length || m.tagPrefix);
      if (!byTag && m.classes.length === 0) return false;
      const tagMatches =
        !byTag ||
        element.tag === m.tag ||
        m.tags.includes(element.tag) ||
        (m.tagPrefix !== "" && element.tag.startsWith(m.tagPrefix));
      return tagMatches && hasClasses;
    }
    default:
      return false;
  }
}

/**
 * The issues the memory certainly covers, and how many each entry covers. An issue is left
 * out only when an entry of its rule, for its site, names its element by the pattern's tag,
 * tags, tagPrefix or classes, within the entry's scope. Everything else stays in the answer,
 * where the agent applies the memory with judgment and asks the user when unsure.
 */
export function applyMemory<T extends MemoryIssue>(
  memory: FpMemory | undefined,
  issues: T[],
): { covered: Set<T>; leftOut: LeftOut[] } {
  const covered = new Set<T>();
  const counts = new Map<number, LeftOut>();
  const byRule = new Map(
    (memory?.rules ?? []).map((rule) => [
      rule.ruleCode,
      rule.entries.map(matcherOf),
    ]),
  );
  for (const issue of issues) {
    const matchers = byRule.get(issue.issue_type);
    const element = matchers?.length
      ? elementOf(issue.HTML_snippet)
      : undefined;
    if (!matchers || !element) continue;
    const match = matchers.find((m) => covers(m, issue, element));
    if (!match) continue;
    covered.add(issue);
    const tally = counts.get(match.entry.id) ?? {
      rule: issue.issue_type,
      entry: match.entry.id,
      count: 0,
    };
    tally.count++;
    counts.set(match.entry.id, tally);
  }
  return { covered, leftOut: [...counts.values()] };
}

/** What an answer says about the issues the memory left out of it. */
export function leftOutMessages(leftOut: LeftOut[]): string[] {
  const total = leftOut.reduce((sum, l) => sum + l.count, 0);
  if (total === 0) return [];
  return [
    `False-positive memory: left out ${total} issue${total === 1 ? "" : "s"} the account's saved false positives cover. They are in none of the issues or counts here; the dashboard and the CSV export still list them. Tell the user how many were left out and by which entries: ${wrapUntrusted("false positives left out (rule, entry id, issues)", JSON.stringify(leftOut))}`,
  ];
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
  "False-positive memory: below are issues this account's users already confirmed are not real, saved per rule. Issues an entry names by its pattern's tag, tags, tagPrefix or classes are already left out of this answer and its counts. Before showing the issues, remove any other one the memory covers, and do not ask the user about them again. Apply an entry only to issues of the same rule (issue_type), on its site (the host of an issue's affected_page) unless it says all sites. Match on its pattern and root_cause, never on selector or exact HTML: ids, selectors and labels differ per page and language. Remove automatically only up to the entry's scope (element: that element; component: the same component; component_family: any component its pattern.predicate describes; site_predicate: anything on the site the predicate describes). Never remove a counter_example, or an element the predicate excludes. List issues that look like the same pattern but fall outside the scope as likely false positives and ask the user once per group; if they agree, save that at the wider scope. Say how many issues were left out or you removed per rule, with the entry ids. Each rule's docs link explains what the rule checks.";

export const FP_FILING_GUIDE = `When the user says an issue is not a real problem, save it with the web_accessibility capability ${SUBMIT_CAPABILITY} (invokeCapability), so later reports are filtered without asking again. First inspect the element yourself (open the page if you have a browser, else read the issue's HTML): what it is built from (tag, custom element, shadow root, classes, design system) and why the rule is wrong about it. Write rootCause about how the element is built, not only that it works for the user, and pattern.predicate as the widest set of elements that root cause covers (e.g. every custom element of the same design system). Later answers leave issues out by the pattern's fields, never by its prose: set tag, tags (the exact tags it holds for) or tagPrefix, and classes where they identify the element, and list in excludeTags any tag the prefix takes in that the root cause does not hold for. Propose that scope and ask the user to confirm it, and to name any similar element that is a real issue (counterExamples). Quote the user as they said it in userStatement. Mark global only when the user says it holds on all their sites.`;

/**
 * What an issues answer adds for the memory: how to apply it, the memory, how to add to it.
 * With `ruleCodes`, only those rules' entries: the ones the answer's issues name.
 */
export function memoryMessages(
  memory: FpMemory | undefined,
  ruleCodes?: string[],
): string[] {
  if (!memory) return [];
  if (ruleCodes) {
    memory = {
      ...memory,
      rules: memory.rules.filter((rule) => ruleCodes.includes(rule.ruleCode)),
    };
  }
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
