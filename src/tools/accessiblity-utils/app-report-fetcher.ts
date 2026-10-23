import { apiClient } from "../../lib/apiClient.js";
import { SessionType } from "../../lib/constants.js";
import { sessionsListUrl } from "../automate-utils/list-session-ids.js";
import { getAutomationBaseUrl } from "../rca-agent-utils/constants.js";
import { pageOf, sortBySeverity } from "./paginate.js";

/**
 * App Accessibility: the issues of a mobile app build run through App Automate with
 * accessibility on. Unlike the web products there is no CSV export behind an access key,
 * so the issues come inline, one API page per batch of scanned screens.
 */
export const APP_API_BASE =
  "https://api-app-accessibility.browserstack.com/automate/api/v1";
export const APP_DASHBOARD = "https://app-accessibility.browserstack.com";
/** Manual (Workflow Analyzer) reports recorded on the dashboard: a separate, older route. */
export const MANUAL_API_BASE =
  "https://api-app-accessibility.browserstack.com/api/v1";

/** Screens per API page, and how many pages a build or report is read across (1,000 screens). */
const SNAPSHOT_PAGE_SIZE = 50;
export const MAX_SNAPSHOT_PAGES = 20;

/** A dashboard link names a build by number; a build someone just opened is among the newest. */
export const MAX_APP_BUILD_LIST_PAGES = 3;
const BUILD_LIST_PAGE_SIZE = 30;

/** A native build is found by name in the account's App Automate build list, newest first. */
const APP_AUTOMATE_BUILDS_URL =
  "https://api-cloud.browserstack.com/app-automate/builds.json";
const APP_AUTOMATE_BUILDS_PAGE_SIZE = 100;
export const MAX_APP_AUTOMATE_BUILD_PAGES = 3;
/** A native run's accessibility build is created as the run starts: seconds apart, in practice. */
const NATIVE_BUILD_START_WINDOW_MS = 2 * 60 * 1000;

export interface AppBuildMeta {
  /** The build's number within its project, which the dashboard link uses. */
  build_id: number;
  created_at?: string;
  th_build_id: string;
  name: string;
  normalised_name: string;
  project_name: string;
  /** running | rule_processing | passed | failed | timeout | update_os_version */
  status: string;
  issue_summary?: { total?: number; scan_count?: number };
  fup?: { capped?: boolean; tests_partial?: boolean; tests_dropped?: boolean };
  /** What ran the tests: an SDK framework (pytest, …) or a native one (Espresso-Junit4, …). */
  session_data?: { framework?: { name?: string } };
}

interface AppRuleIssue {
  uid: string;
  status?: string;
  duplication_count?: number;
  issue_class_android?: string;
  issue_class_ios?: string;
  issue_id_android?: string;
  issue_id_ios?: string;
  /** An iOS element's class. */
  issue_type_ios?: string;
  how_to_fix_desc?: string;
  issue_details?: { label?: string; value?: unknown; important?: boolean }[];
  /** The rule's inputs for this element, among them what it expects (`expected_ratio`, …). */
  rule_dynamic_meta?: Record<string, unknown>;
}

interface AppRule {
  rule_id: string;
  label: string;
  description?: string;
  severity?: string;
  guidelines?: { message?: string }[];
  rule_issues?: AppRuleIssue[];
}

export interface AppSnapshot {
  meta?: {
    screenshot_url?: string;
    testcase_name?: string;
    /** A manual report's snapshot keeps its rules here. */
    aggregated_results?: AppRule[];
  };
  aggregated_results?: AppRule[];
}

export type AppAccessibilityIssue = {
  issue_type: string;
  rule_id: string;
  severity: string;
  /** Which scanned screen of which test the element was on. */
  screen: string;
  /** The element's id when it has one, else its class. */
  component: string;
  /** The element's identifying details, as captured on the device. */
  element: Record<string, unknown>;
  issue_description: string;
  how_to_fix: string;
  /** The WCAG success criteria the rule maps to. */
  wcag: string;
  screenshot?: string;
  /** How many more occurrences of this issue the report folded into it. */
  duplicate_count?: number;
  /**
   * What the rule measured on the element (a contrast issue's colours and ratio, a touch
   * target's size, a font size, the label it found) and what it expects, so a fix can be
   * sized.
   */
  measured?: Record<string, unknown>;
};

/** A report's issues counted by severity, by rule and by screen, largest first. */
export interface AppIssueSummary {
  by_severity: Record<string, number>;
  by_rule: { rule_id: string; issue_type: string; count: number }[];
  by_screen: { screen: string; count: number }[];
}

/** An issue as a page hands it out: what is its own, with its rule and screen named. */
export type AppIssueRow = Omit<
  AppAccessibilityIssue,
  | "issue_type"
  | "issue_description"
  | "wcag"
  | "screenshot"
  | "how_to_fix"
  | "component"
> & {
  /** The element's id or class; an element with neither is known by its rule. */
  component?: string;
  /** Only when it differs from the rule's usual fix, which is under the page's rules. */
  how_to_fix?: string;
};

/** What a page's issues share, said once: per rule, and each screen's screenshot. */
export interface AppIssuePageContext {
  rules: Record<
    string,
    {
      issue_type: string;
      issue_description: string;
      wcag: string;
      how_to_fix: string;
    }
  >;
  screens: Record<string, string>;
}

export interface AppBuildReport extends AppIssuePageContext {
  records: AppIssueRow[];
  page_length: number;
  total_issues: number;
  next_page: number | null;
  /** How many issues the pages after this one hold. */
  remaining: number;
  summary: AppIssueSummary;
  /** Issues hidden in the dashboard, which the API leaves out of the screens. */
  hidden_issues: number;
  scan_count: number;
  status: string;
  build_name: string;
  dashboard_link?: string;
  /** Whether the fair-usage cap dropped tests or scans from this build. */
  fup_capped: boolean;
  /** The test framework the build ran under, when the build's details name it. */
  framework?: string;
  /** How many screens were read, when the snapshot page limit stopped short of them all. */
  screens_read?: number;
}

/** A manual (Workflow Analyzer) report's issues, read inline from its scanned screens. */
export interface AppManualReport extends AppIssuePageContext {
  records: AppIssueRow[];
  page_length: number;
  /**
   * The issues, duplicates left out as the dashboard leaves them out when `deduplicated`;
   * else every occurrence the Manual Reports API lists, which does not mark duplicates.
   */
  total_issues: number;
  /** Read from the dashboard's own screens: duplicates left out, issues with their element. */
  deduplicated: boolean;
  next_page: number | null;
  /** How many issues the pages after this one hold. */
  remaining: number;
  summary: AppIssueSummary;
  dashboard_count: number;
  duplicate_occurrences: number;
  hidden_issues: number;
  scan_count: number;
  /** complete | in_progress */
  status: string;
  report_name: string;
  device?: string;
  dashboard_link: string;
}

/** Every issue of one app build, with what a comparison needs to know of the build. */
export interface AppBuildIssues {
  buildId: string;
  build_name: string;
  build_number: number;
  created_at?: string;
  status: string;
  scan_count: number;
  /** The tests whose screens were scanned, in the order first seen. */
  tests: string[];
  issues: AppAccessibilityIssue[];
}

/** An earlier build of a project, as the build list names it. */
export interface AppBuildRef {
  buildId: string;
  name?: string;
  build_number?: number;
  created_at?: string;
  /** Whether it has the later build's name; a native run's builds are each named apart. */
  same_name: boolean;
  /**
   * Whether the project's whole build list was read. When it was not, a build of the same
   * name may still be further back than the newest builds read.
   */
  searched_all: boolean;
}

/** A build as the project's build list gives it. */
interface AppBuildListRow {
  th_build_id: string;
  name?: string;
  normalised_name?: string;
  build_number?: number;
  created_at?: string;
  /** "Espresso-Junit4" for a native run; "pytest", "reqnroll-nunit", … for an SDK one. */
  session_data?: { frameworkName?: string };
}

/**
 * Whether a project build can be a native (Espresso, XCUITest) run's. An SDK suite started
 * at the same moment in the same project is not, and taking it would read its issues as the
 * native run's.
 */
function maybeNative(row: AppBuildListRow): boolean {
  const framework = row.session_data?.frameworkName;
  return !framework || /espresso|xcui/i.test(framework);
}

export interface AppProjectRow {
  id: number;
  name: string;
  created_at?: string;
}

/** The element details worth repeating; the rest are the rule's own inputs. */
const ELEMENT_DETAILS = new Set([
  "className",
  "viewId",
  "resourceId",
  "accessibilityIdentifier",
  "accessibilityLabel",
  "text",
  "contentDescription",
  "frame",
]);

/** A detail's value is JSON-encoded ('"android.widget.Button"', '{"x":63,…}') when it can be. */
function detailValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** An iOS element's details, under the names an Android element's go by. */
const IOS_DETAILS: Record<string, string> = {
  class: "className",
  identifier: "accessibilityIdentifier",
  visibleText: "text",
};

function elementOf(issue: AppRuleIssue): Record<string, unknown> {
  const element: Record<string, unknown> = {};
  for (const { label, value } of issue.issue_details ?? []) {
    const name = label && (IOS_DETAILS[label] ?? label);
    if (!name || !ELEMENT_DETAILS.has(name)) continue;
    const parsed = detailValue(value);
    if (parsed === "" || parsed === null || parsed === undefined) continue;
    element[name] = parsed;
  }
  // The class is the element's kind even when the details leave it out.
  const className = issue.issue_class_android || issue.issue_class_ios;
  if (className && element.className === undefined) {
    element.className = className;
  }
  return element;
}

/**
 * The fix text is light markup (`<document>`, `<code>`); the words are what matter. Text
 * inside angle brackets is dropped, and so is every bracket, character by character:
 * nested markup such as `<scr<script>ipt>` cannot leave a tag behind, as a regex
 * replacement of whole tags could.
 */
function plainText(markup: string | undefined): string {
  let text = "";
  let inTag = false;
  for (const ch of markup ?? "") {
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag) text += ch;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** A rule's inputs that say what it expects of the element; the rest describe the run. */
const EXPECTED = /^(expected|desired|minimum)_/;

function measuredOf(issue: AppRuleIssue): Record<string, unknown> | undefined {
  const measured: Record<string, unknown> = {};
  for (const { label, value, important } of issue.issue_details ?? []) {
    if (!important || !label) continue;
    if (ELEMENT_DETAILS.has(IOS_DETAILS[label] ?? label)) continue;
    measured[label] = detailValue(value);
  }
  for (const [key, value] of Object.entries(issue.rule_dynamic_meta ?? {})) {
    // The ratio as "4.5:1" says what expected_contrast_ratio's 4.5 does.
    if (EXPECTED.test(key) && key !== "expected_contrast_ratio") {
      measured[key] = value;
    }
  }
  return Object.keys(measured).length ? measured : undefined;
}

/** Issues the dashboard does not count: hidden by the user, or marked as not an issue. */
function isLeftOut(issue: AppRuleIssue): boolean {
  return issue.status === "hidden" || issue.status === "non_issue";
}

/** One row per element with an issue, most severe first. Screens are numbered in order. */
export function flattenAppSnapshots(
  details: AppSnapshot[],
): AppAccessibilityIssue[] {
  const rows: AppAccessibilityIssue[] = [];
  details.forEach((snapshot, index) => {
    const test = snapshot.meta?.testcase_name;
    const screen = `Screen ${index + 1}${test ? ` (${test})` : ""}`;
    const rules =
      snapshot.aggregated_results ?? snapshot.meta?.aggregated_results ?? [];
    for (const rule of rules) {
      const wcag = (rule.guidelines ?? [])
        .map((g) => g.message)
        .filter(Boolean)
        .join("; ");
      for (const issue of rule.rule_issues ?? []) {
        if (isLeftOut(issue)) continue;
        const element = elementOf(issue);
        rows.push({
          issue_type: rule.label,
          rule_id: rule.rule_id,
          severity: (rule.severity ?? "unknown").toLowerCase(),
          screen,
          // An iOS element's id is often only in its details, and its class in issue_type_ios.
          component: String(
            issue.issue_id_android ||
              issue.issue_id_ios ||
              element.accessibilityIdentifier ||
              issue.issue_class_android ||
              issue.issue_class_ios ||
              issue.issue_type_ios ||
              rule.label,
          ),
          element,
          issue_description: rule.description ?? "",
          how_to_fix: plainText(issue.how_to_fix_desc),
          wcag,
          ...(snapshot.meta?.screenshot_url
            ? { screenshot: snapshot.meta.screenshot_url }
            : {}),
          ...(issue.duplication_count
            ? { duplicate_count: issue.duplication_count }
            : {}),
          ...(measuredOf(issue) ? { measured: measuredOf(issue) } : {}),
        });
      }
    }
  });
  return sortBySeverity(rows);
}

/** The value most rows give, the first of them on a tie. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) [best, bestCount] = [v, n];
  }
  return best;
}

/**
 * An issue's name, description, WCAG criteria and fix are its rule's, and its screenshot is
 * its screen's: two thirds of an issue's length, repeated on every one. Said once, under
 * the page's rules and screens, a page holds about three times as many issues. An issue
 * keeps its own fix only when it differs from its rule's usual one.
 */
export function compactAppIssues(all: AppAccessibilityIssue[]): {
  rows: AppIssueRow[];
  context: AppIssuePageContext;
} {
  const byRule = new Map<string, AppAccessibilityIssue[]>();
  for (const row of all) {
    byRule.set(row.rule_id, [...(byRule.get(row.rule_id) ?? []), row]);
  }
  const rules: AppIssuePageContext["rules"] = {};
  for (const [ruleId, rows] of byRule) {
    rules[ruleId] = {
      issue_type: rows[0].issue_type,
      issue_description: rows[0].issue_description,
      wcag: rows[0].wcag,
      how_to_fix: mostCommon(rows.map((r) => r.how_to_fix)),
    };
  }
  const screens: Record<string, string> = {};
  const rows = all.map((row): AppIssueRow => {
    const {
      issue_type,
      issue_description,
      wcag,
      screenshot,
      how_to_fix,
      component,
      ...own
    } = row;
    void issue_description;
    void wcag;
    if (screenshot) screens[own.screen] = screenshot;
    return {
      ...own,
      ...(component !== issue_type ? { component } : {}),
      ...(how_to_fix && how_to_fix !== rules[own.rule_id].how_to_fix
        ? { how_to_fix }
        : {}),
    };
  });
  return { rows, context: { rules, screens } };
}

/** The rules and screens a page's issues name, and nothing else. */
export function contextOf(
  records: AppIssueRow[],
  { rules, screens }: AppIssuePageContext,
): AppIssuePageContext {
  return {
    rules: Object.fromEntries(
      [...new Set(records.map((r) => r.rule_id))].map((id) => [id, rules[id]]),
    ),
    screens: Object.fromEntries(
      [...new Set(records.map((r) => r.screen))]
        .filter((screen) => screens[screen])
        .map((screen) => [screen, screens[screen]]),
    ),
  };
}

function countsOf<T>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
  }
  return counts;
}

/** Most first; ties keep the order the rows came in, which is most severe first. */
function largestFirst(counts: Map<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** The issues counted by severity, by rule and by screen, largest first. */
export function summarizeAppIssues(
  rows: AppAccessibilityIssue[],
): AppIssueSummary {
  const ruleNames = new Map(rows.map((r) => [r.rule_id, r.issue_type]));
  return {
    by_severity: Object.fromEntries(countsOf(rows, (r) => r.severity)),
    by_rule: largestFirst(countsOf(rows, (r) => r.rule_id)).map(
      ([rule_id, count]) => ({
        rule_id,
        issue_type: ruleNames.get(rule_id) ?? rule_id,
        count,
      }),
    ),
    by_screen: largestFirst(countsOf(rows, (r) => r.screen)).map(
      ([screen, count]) => ({ screen, count }),
    ),
  };
}

/**
 * The same issue in two builds: the same rule on the same element. An element is known by
 * its id; one without an id, by its class (or, with no class either, as an iOS element can
 * be, only by its rule) and its text or label. The screen is left out, as screens are
 * numbered in the order they were scanned, which a fix can shift.
 */
function appIssueKey(row: AppAccessibilityIssue): string {
  const unnamed =
    row.component === row.element.className || row.component === row.issue_type;
  const label = row.element.text ?? row.element.accessibilityLabel ?? "";
  return [row.rule_id, row.component, unnamed ? label : ""]
    .map(String)
    .join("|");
}

/**
 * The element an issue is on, whatever its rule: its id or class and its text or label. An
 * element known only by its rule, with no text either, cannot be told apart from another.
 */
function elementIdentity(row: AppAccessibilityIssue): string | undefined {
  const named = row.component !== row.issue_type;
  const text =
    row.element.text ??
    row.element.accessibilityLabel ??
    row.element.contentDescription ??
    "";
  if (!named && !text) return undefined;
  return `${named ? row.component : ""}|${String(text)}`;
}

/** A screen is the same screen in another build when they share this much of its elements. */
const SAME_SCREEN_SHARE = 0.25;

/**
 * The screens of one build no screen of the other resembles. Screens are named by scan
 * order, so a screen is recognised by what is on it: one that shares under a quarter of its
 * elements with every screen of the other build was not reached there, or changed entirely.
 * A screen whose elements cannot be told apart is not set apart.
 */
function screensWithoutCounterpart(
  from: AppAccessibilityIssue[],
  to: AppAccessibilityIssue[],
): Set<string> {
  const elementsBy = (rows: AppAccessibilityIssue[]) => {
    const screens = new Map<string, Set<string>>();
    for (const row of rows) {
      const id = elementIdentity(row);
      if (id === undefined) continue;
      screens.set(row.screen, (screens.get(row.screen) ?? new Set()).add(id));
    }
    return screens;
  };
  const others = [...elementsBy(to).values()];
  const without = new Set<string>();
  for (const [screen, elements] of elementsBy(from)) {
    const shared = Math.max(
      0,
      ...others.map(
        (other) => [...elements].filter((e) => other.has(e)).length,
      ),
    );
    if (shared / elements.size < SAME_SCREEN_SHARE) without.add(screen);
  }
  return without;
}

const sameFrame = (a: AppAccessibilityIssue, b: AppAccessibilityIssue) =>
  JSON.stringify(a.element.frame ?? null) ===
  JSON.stringify(b.element.frame ?? null);

/**
 * Which issues of two builds are the same issue. Issues that look alike (one rule on
 * elements known by neither id nor label) are paired one for one, those on the same screen
 * and spot first, then on the same screen, then any; what is left over in either build is
 * new or resolved. When the builds scanned a different number of screens, a screen one of
 * them has no counterpart for is set apart: an earlier screen's leftovers were not seen
 * again (`unconfirmed`), and a later screen's were not looked for before (`first_scanned`).
 * With as many screens in each, they correspond, and a screen with nothing left was fixed.
 * So new, first scanned and still open add up to the later build's issues, and resolved,
 * unconfirmed and still open to the earlier one's.
 */
export function compareAppIssues(
  before: AppAccessibilityIssue[],
  after: AppAccessibilityIssue[],
  { sameScreens = false }: { sameScreens?: boolean } = {},
): {
  added: AppAccessibilityIssue[];
  first_scanned: AppAccessibilityIssue[];
  resolved: AppAccessibilityIssue[];
  unconfirmed: AppAccessibilityIssue[];
  retained: number;
} {
  const earlierByKey = new Map<string, AppAccessibilityIssue[]>();
  for (const row of before) {
    const key = appIssueKey(row);
    earlierByKey.set(key, [...(earlierByKey.get(key) ?? []), row]);
  }
  const matched = new Set<AppAccessibilityIssue>();
  const passes = [
    (a: AppAccessibilityIssue, b: AppAccessibilityIssue) =>
      a.screen === b.screen && sameFrame(a, b),
    (a: AppAccessibilityIssue, b: AppAccessibilityIssue) =>
      a.screen === b.screen,
    () => true,
  ];
  for (const pairs of passes) {
    for (const row of after) {
      if (matched.has(row)) continue;
      const twin = earlierByKey
        .get(appIssueKey(row))
        ?.find((earlier) => !matched.has(earlier) && pairs(row, earlier));
      if (twin) {
        matched.add(row);
        matched.add(twin);
      }
    }
  }
  const added = after.filter((row) => !matched.has(row));
  const resolved = before.filter((row) => !matched.has(row));
  const unreached = sameScreens
    ? new Set<string>()
    : screensWithoutCounterpart(before, after);
  const unseen = sameScreens
    ? new Set<string>()
    : screensWithoutCounterpart(after, before);
  return {
    added: added.filter((row) => !unseen.has(row.screen)),
    first_scanned: added.filter((row) => unseen.has(row.screen)),
    resolved: resolved.filter((row) => !unreached.has(row.screen)),
    unconfirmed: resolved.filter((row) => unreached.has(row.screen)),
    retained: after.length - added.length,
  };
}

const APP_AUTOMATE_HOST = "app-automate.browserstack.com";

/** The App Automate build and, when the link names one, the session (both 40-hex ids). */
function appAutomateIds(
  url: URL,
): { buildId?: string; sessionId?: string } | undefined {
  if (url.hostname !== APP_AUTOMATE_HOST) return undefined;
  return {
    buildId: url.pathname.match(/\/builds\/([0-9a-f]{40})(?:\/|$)/i)?.[1],
    sessionId: url.pathname.match(/\/sessions\/([0-9a-f]{40})(?:\/|$)/i)?.[1],
  };
}

/** The id a manual report's dashboard link names (`/report/{uuid}`), if it is one. */
export function manualReportIdFromDashboardLink(url: URL): string | undefined {
  if (url.hostname !== new URL(APP_DASHBOARD).hostname) return undefined;
  return url.pathname.match(/^\/report\/([0-9a-f-]{36})\/?$/i)?.[1];
}

/** A manual report has no status of its own; it is complete once it has ended. */
export function manualReportStatus(detail: {
  meta_data?: { ended_at?: string | null };
}): string {
  return detail.meta_data?.ended_at ? "complete" : "in_progress";
}

/** A link's CGI-escaped name ("+" for a space), read the same however it was escaped. */
function unescapedName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    return name;
  }
}

/** The build an App Accessibility dashboard link names: project id, build name and number. */
function buildOfDashboardLink(
  url: URL,
): { projectId: string; name: string; number: number } | undefined {
  const match = url.pathname.match(
    /\/automated-tests\/projects\/(\d+)\/builds\/([^/]+)\/(\d+)\/?$/,
  );
  if (!match) return undefined;
  // The name in the link is the build's normalised name (TestHub's, which can differ from
  // the build's own), and the number counts up per name: a project's first build of each
  // name is number 1. The two together name one build.
  return {
    projectId: match[1],
    name: unescapedName(match[2]),
    number: Number(match[3]),
  };
}

export class AppAccessibilityApi {
  constructor(
    private readonly headers: () => Record<string, string> | undefined,
  ) {}

  /** The build's details, or undefined when the API does not know the id. */
  async buildMeta(buildId: string): Promise<AppBuildMeta | undefined> {
    const resp = await apiClient.get({
      url: `${APP_API_BASE}/build/${encodeURIComponent(buildId)}`,
      headers: this.headers(),
      raise_error: false,
    });
    return resp.ok ? resp.data?.meta_data : undefined;
  }

  /**
   * The id of the build an App Accessibility dashboard link points at, if it is one: the
   * project's newest builds, by number. (The list's name filter would not do: the link
   * carries TestHub's name for the build, which the filter does not match.)
   */
  async buildIdFromDashboardLink(url: URL): Promise<string | undefined> {
    if (url.hostname !== new URL(APP_DASHBOARD).hostname) return undefined;
    const build = buildOfDashboardLink(url);
    if (!build) return undefined;
    const buildId = await this.findBuild(
      build.projectId,
      undefined,
      (row) =>
        row.build_number === build.number &&
        (row.normalised_name === undefined ||
          unescapedName(row.normalised_name) === build.name),
    );
    if (buildId) return buildId;
    throw new Error(
      `No build ${build.number} of "${build.name}" is among the project's newest builds (${MAX_APP_BUILD_LIST_PAGES} pages). Pass the build id instead, as buildId: the BrowserStack SDK prints it as "testhub id" at the end of the run`,
    );
  }

  /**
   * The accessibility build of an App Automate build or session link. An SDK (Appium)
   * session's test code carries the TestHub build id its results went to, which is the
   * App Accessibility build when accessibility was on; a build link goes through any one
   * of its sessions. A native (Espresso, XCUITest) build has no SDK session, and is found
   * by name instead.
   */
  async buildIdFromAppAutomateLink(url: URL): Promise<string | undefined> {
    const ids = appAutomateIds(url);
    if (!ids?.buildId && !ids?.sessionId) return undefined;
    if (ids.sessionId) return this.buildOfSdkSession(ids.sessionId);
    const session = await this.anySdkSession(ids.buildId!);
    return session
      ? this.buildOfSdkSession(session)
      : this.buildOfNativeBuild(ids.buildId!);
  }

  private async buildOfSdkSession(sessionId: string): Promise<string> {
    const resp = await apiClient.get({
      url: `${getAutomationBaseUrl()}/ext/v1/sessions/${encodeURIComponent(sessionId)}/testCode`,
      headers: this.headers(),
      raise_error: false,
    });
    // A session with no test code is a 404; any other failure is the request's, not the run's.
    if (!resp.ok && resp.status !== 404) {
      throw new Error(
        `Could not read App Automate session ${sessionId}: HTTP ${resp.status}`,
      );
    }
    const buildId = resp.ok ? resp.data?.build_uuid : undefined;
    if (!buildId) {
      throw new Error(
        `App Automate session ${sessionId} has no accessibility report: accessibility was not on for this run, or this is not an SDK (Appium) session. Run it again with accessibility on (browserstack.yml \`accessibility: true\`)`,
      );
    }
    return buildId;
  }

  /** The first SDK session of an App Automate build; a native build lists none. */
  private async anySdkSession(buildId: string): Promise<string | undefined> {
    const resp = await apiClient.get({
      url: `${sessionsListUrl(SessionType.AppAutomate, buildId)}?limit=1`,
      headers: this.headers(),
      raise_error: false,
    });
    return resp.ok ? resp.data?.[0]?.automation_session?.hashed_id : undefined;
  }

  /**
   * A native build's details name its project and when it started; App Accessibility lists
   * the run under the same project, created as it started, and named as the App Automate
   * build list names it ("Build #N: app vX"). The start finds it among the project's newest
   * builds; the name, read from the account's build list, tells runs that started together
   * apart, and finds a run older than those.
   */
  private async buildOfNativeBuild(buildId: string): Promise<string> {
    const native = await this.nativeBuild(buildId);
    if (!native?.project) {
      throw new Error(
        `No session found for App Automate build ${buildId}, and it is not an Espresso or XCUITest build with a project, so it cannot be mapped to its accessibility report. Pass the build id the BrowserStack SDK printed as "testhub id" as buildId, or the build's App Accessibility dashboard link as reportUrl`,
      );
    }
    const { project, startedAt } = native;
    const projectId = await this.projectId(project);
    const started =
      projectId !== undefined && startedAt !== undefined
        ? await this.buildsStartedNear(projectId, startedAt)
        : [];
    if (started.length === 1) return started[0].th_build_id;

    const name = await this.appAutomateBuildName(buildId);
    if (!name) {
      throw new Error(
        `App Automate build ${buildId} is not among the account's newest builds (${MAX_APP_AUTOMATE_BUILD_PAGES} pages of ${APP_AUTOMATE_BUILDS_PAGE_SIZE}), so its accessibility report cannot be found by name. Pass the build's App Accessibility dashboard link as reportUrl instead`,
      );
    }
    const found =
      projectId !== undefined &&
      (started.find((row) => row.name === name)?.th_build_id ??
        (await this.findBuild(projectId, name, (row) => row.name === name)));
    if (!found) {
      throw new Error(
        `No App Accessibility build named "${name}" in project "${project}": accessibility was not on for this run. Run it again with \`accessibility: true\` in the Espresso/XCUITest build request`,
      );
    }
    return found;
  }

  /** A native build's project and start, from whichever framework API knows the build. */
  private async nativeBuild(
    buildId: string,
  ): Promise<{ project?: string; startedAt?: number } | undefined> {
    for (const framework of ["espresso", "xcuitest"]) {
      const resp = await apiClient.get({
        url: `https://api-cloud.browserstack.com/app-automate/${framework}/v2/builds/${encodeURIComponent(buildId)}`,
        headers: this.headers(),
        raise_error: false,
      });
      if (!resp.ok) continue;
      // "2026-03-04 10:30:40 UTC"
      const startedAt = Date.parse(resp.data?.start_time ?? "");
      return {
        project: resp.data?.input_capabilities?.project,
        ...(Number.isNaN(startedAt) ? {} : { startedAt }),
      };
    }
    return undefined;
  }

  /** The project's builds created within moments of a run's start, newest first. */
  private async buildsStartedNear(
    projectId: number,
    startedAt: number,
  ): Promise<AppBuildListRow[]> {
    const near: AppBuildListRow[] = [];
    const created = (row: AppBuildListRow) => Date.parse(row.created_at ?? "");
    for await (const { rows } of this.projectBuilds(projectId)) {
      near.push(
        ...rows.filter(
          (row) =>
            maybeNative(row) &&
            Math.abs(created(row) - startedAt) <= NATIVE_BUILD_START_WINDOW_MS,
        ),
      );
      // Newest first: a page that reaches back before the run leaves nothing to find after it.
      const oldest = rows.length ? created(rows[rows.length - 1]) : NaN;
      if (oldest < startedAt - NATIVE_BUILD_START_WINDOW_MS) break;
    }
    return near;
  }

  /** The build's name in the account's App Automate build list, walked newest first. */
  private async appAutomateBuildName(
    buildId: string,
  ): Promise<string | undefined> {
    for (let page = 0; page < MAX_APP_AUTOMATE_BUILD_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${APP_AUTOMATE_BUILDS_URL}?limit=${APP_AUTOMATE_BUILDS_PAGE_SIZE}&offset=${page * APP_AUTOMATE_BUILDS_PAGE_SIZE}`,
        headers: this.headers(),
        raise_error: false,
      });
      const rows: {
        automation_build?: { hashed_id?: string; name?: string };
      }[] = resp.ok && Array.isArray(resp.data) ? resp.data : [];
      const row = rows.find((r) => r.automation_build?.hashed_id === buildId);
      if (row) return row.automation_build?.name;
      if (rows.length < APP_AUTOMATE_BUILDS_PAGE_SIZE) break;
    }
    return undefined;
  }

  /** The App Accessibility project of that exact name, if any. */
  private async projectId(name: string): Promise<number | undefined> {
    return (await this.projectsNamed(name)).find((p) => p.name === name)?.id;
  }

  /**
   * The projects whose name contains `name`, as the API searches it. A failed search is an
   * error, not an empty list, or a correct name would read as one that matches nothing.
   */
  private async projectsNamed(name: string): Promise<AppProjectRow[]> {
    const data = await this.listing(
      `${APP_API_BASE}/project?name=${encodeURIComponent(name)}`,
      `the App Accessibility projects named "${name}"`,
    );
    return data.projects ?? [];
  }

  /**
   * A listing's page. The API answers an empty list with 404 ("No builds found") for
   * access-key callers, which is not an error here; any other failure is, a 404 from a
   * wrong route or a missing permission included.
   */
  private async listing(url: string, what: string): Promise<any> {
    const resp = await apiClient.get({
      url,
      headers: this.headers(),
      raise_error: false,
    });
    if (resp.ok) return resp.data ?? {};
    if (resp.status === 404 && /^No .+ found/i.test(resp.data?.message ?? "")) {
      return {};
    }
    throw new Error(
      `Could not list ${what}: HTTP ${resp.status}${resp.data?.message ? ` (${resp.data.message})` : ""}`,
    );
  }

  /** A manual report's details, or undefined when the API does not know the id. */
  async manualReport(reportId: string): Promise<any | undefined> {
    const resp = await apiClient.get({
      url: `${MANUAL_API_BASE}/reports/${encodeURIComponent(reportId)}`,
      headers: this.headers(),
      raise_error: false,
    });
    return resp.ok ? resp.data : undefined;
  }

  /**
   * A manual report's screens as the dashboard reads them, duplicates left out and each
   * issue with its element, fix and measurements; undefined while that route answers an
   * access key with a login redirect, as it does until it takes one.
   */
  private async dashboardScreens(
    reportId: string,
  ): Promise<AppSnapshot[] | undefined> {
    const details: AppSnapshot[] = [];
    for (let page = 1; page <= MAX_SNAPSHOT_PAGES; page++) {
      const resp = await apiClient
        .get({
          url: `${MANUAL_API_BASE}/app_scanner/${encodeURIComponent(reportId)}/snapshot?hide_duplicate_issues=true&page_size=${SNAPSHOT_PAGE_SIZE}&page=${page}`,
          headers: this.headers(),
          raise_error: false,
        })
        .catch(() => undefined);
      const data = resp?.ok && resp.data?.success ? resp.data.data : undefined;
      if (!Array.isArray(data?.details))
        return page === 1 ? undefined : details;
      details.push(...data.details);
      if (!data.info?.next) break;
    }
    return details;
  }

  /** Every occurrence the Manual Reports API lists, and the device the report ran on. */
  private async manualApiScreens(reportId: string): Promise<{
    details: AppSnapshot[];
    device?: { model?: string; os?: string; os_version?: string };
  }> {
    const details: AppSnapshot[] = [];
    let device:
      | { model?: string; os?: string; os_version?: string }
      | undefined;
    for (let page = 1; page <= MAX_SNAPSHOT_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${MANUAL_API_BASE}/reports/${encodeURIComponent(reportId)}/issues?page_size=${SNAPSHOT_PAGE_SIZE}&page=${page}`,
        headers: this.headers(),
      });
      device ??= resp.data?.device;
      details.push(...(resp.data?.data ?? []));
      if (!resp.data?.pagination?.next) break;
    }
    return { details, device };
  }

  /**
   * A manual report's issues, most severe first: from the dashboard's own screens when the
   * route takes the access key, so the count is the dashboard's and each issue names its
   * element; else every occurrence the Manual Reports API lists, which marks neither
   * duplicates nor elements, with the dashboard's count stated next to it.
   */
  async appReportIssues(
    reportId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppManualReport> {
    const detail = await this.manualReport(reportId);
    if (!detail) {
      throw new Error(
        `No App Accessibility manual report with id "${reportId}". Pass the report's dashboard link (app-accessibility.browserstack.com/report/…) as reportUrl, or an id from the capability functions' list of manual App Accessibility reports`,
      );
    }
    const dashboard = await this.dashboardScreens(reportId);
    const { details, device } = dashboard
      ? { details: dashboard, device: undefined }
      : await this.manualApiScreens(reportId);
    const summary = detail.data?.issue_summary ?? {};
    const all = flattenAppSnapshots(details);
    const { rows, context } = compactAppIssues(all);
    const page = pageOf(rows, { nextPage: cursor, maxCharacterLength });
    return {
      ...page,
      ...contextOf(page.records, context),
      total_issues: all.length,
      summary: summarizeAppIssues(all),
      deduplicated: dashboard !== undefined,
      dashboard_count: summary.total ?? all.length,
      duplicate_occurrences: summary.severity_count?.duplicate_issues ?? 0,
      hidden_issues: summary.severity_count?.hidden_issues ?? 0,
      scan_count: summary.scan_count ?? details.length,
      status: manualReportStatus(detail),
      report_name: detail.meta_data?.name ?? reportId,
      ...(device?.model
        ? { device: `${device.model}, ${device.os} ${device.os_version}` }
        : {}),
      dashboard_link: `${APP_DASHBOARD}/report/${reportId}`,
    };
  }

  /**
   * The id of the project's build that `pick` accepts, newest first, within the first
   * pages; `buildName` narrows the list to builds named like it, when the name is known
   * to be the build's own.
   */
  private async findBuild(
    projectId: string | number,
    buildName: string | undefined,
    pick: (row: AppBuildListRow) => boolean,
  ): Promise<string | undefined> {
    for await (const { rows } of this.projectBuilds(projectId, buildName)) {
      const row = rows.find(pick);
      if (row?.th_build_id) return row.th_build_id;
    }
    return undefined;
  }

  /**
   * The project's builds a page at a time, newest first, within the first pages; `more`
   * says whether the list goes on past the page. A page that fails is an error, not the end
   * of the list, or a build with earlier ones would read as its project's first.
   */
  private async *projectBuilds(
    projectId: string | number,
    buildName?: string,
  ): AsyncGenerator<{ rows: AppBuildListRow[]; more: boolean }> {
    const q = encodeURIComponent;
    const named = buildName ? `build_name=${q(buildName)}&` : "";
    for (let page = 1; page <= MAX_APP_BUILD_LIST_PAGES; page++) {
      const data = await this.listing(
        `${APP_API_BASE}/project/${q(String(projectId))}/build?${named}page_size=${BUILD_LIST_PAGE_SIZE}&page=${page}`,
        `page ${page} of App Accessibility project ${projectId}'s builds`,
      );
      const more = Boolean(data.info?.next);
      yield { rows: data.builds ?? [], more };
      if (!more) return;
    }
  }

  /**
   * The build before this one in its project: the newest earlier build of the same name,
   * as an SDK suite keeps its name from run to run, or else the build just before it, as
   * each native (Espresso, XCUITest) run is named apart. None for a project's first build.
   */
  async previousBuild(buildId: string): Promise<AppBuildRef | undefined> {
    const meta = await this.requireBuildMeta(buildId);
    const projectId = await this.projectId(meta.project_name);
    if (projectId === undefined) return undefined;
    let reached = false;
    let justBefore: AppBuildListRow | undefined;
    let more = false;
    const ref = (row: AppBuildListRow, same_name: boolean): AppBuildRef => ({
      buildId: row.th_build_id,
      ...(row.name !== undefined ? { name: row.name } : {}),
      ...(row.build_number !== undefined
        ? { build_number: row.build_number }
        : {}),
      ...(row.created_at !== undefined ? { created_at: row.created_at } : {}),
      same_name,
      searched_all: !more,
    });
    for await (const page of this.projectBuilds(projectId)) {
      more = page.more;
      for (const row of page.rows) {
        if (row.th_build_id === buildId) {
          reached = true;
        } else if (reached) {
          if (row.name === meta.name) return ref(row, true);
          justBefore ??= row;
        }
      }
    }
    // Stopping at the page limit is not the end of the list: say so rather than guess.
    if (!reached && more) {
      throw new Error(
        `App Accessibility build ${buildId} is not among its project's newest builds (${MAX_APP_BUILD_LIST_PAGES} pages), so the build before it cannot be found here. Pass the earlier build's id or link as compareWith instead`,
      );
    }
    if (!justBefore && more) {
      throw new Error(
        `App Accessibility build ${buildId} is the last of its project's newest builds read (${MAX_APP_BUILD_LIST_PAGES} pages): the build before it is older than the newest builds read. Pass the earlier build's id or link as compareWith instead`,
      );
    }
    return justBefore && ref(justBefore, false);
  }

  /** The build's page on the App Accessibility dashboard, when its project can be found. */
  private async dashboardLink(meta: AppBuildMeta): Promise<string | undefined> {
    try {
      const projectId = await this.projectId(meta.project_name);
      if (projectId === undefined) return undefined;
      return `${APP_DASHBOARD}/automated-tests/projects/${projectId}/builds/${meta.normalised_name}/${meta.build_id}`;
    } catch {
      return undefined;
    }
  }

  /**
   * Every scanned screen of the build, up to the page limit, how many issues the dashboard
   * hides, and whether more screens lie past the limit.
   */
  private async snapshots(
    buildId: string,
  ): Promise<{ details: AppSnapshot[]; hidden: number; more: boolean }> {
    const details: AppSnapshot[] = [];
    let hidden = 0;
    let more = false;
    for (let page = 1; page <= MAX_SNAPSHOT_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${APP_API_BASE}/build/${encodeURIComponent(buildId)}/snapshot?hide_duplicate_issues=true&page_size=${SNAPSHOT_PAGE_SIZE}&page=${page}`,
        headers: this.headers(),
      });
      const data = resp.data?.data;
      details.push(...(data?.details ?? []));
      hidden = data?.issue_counts?.hidden_issues ?? hidden;
      more = Boolean(data?.info?.next);
      if (!more) break;
    }
    return { details, hidden, more };
  }

  private async requireBuildMeta(buildId: string): Promise<AppBuildMeta> {
    const meta = await this.buildMeta(buildId);
    if (!meta) {
      throw new Error(
        `No App Accessibility build with id "${buildId}". Pass the id the BrowserStack SDK printed as "testhub id" at the end of the run, or the build's App Accessibility dashboard link as reportUrl`,
      );
    }
    return meta;
  }

  /** The build's details and scanned screens; a build with no scans has none to read. */
  private async readBuild(buildId: string): Promise<{
    meta: AppBuildMeta;
    details: AppSnapshot[];
    hidden: number;
    /** Whether more screens lie past the snapshot page limit. */
    more: boolean;
    scanCount: number;
  }> {
    const meta = await this.requireBuildMeta(buildId);
    const scanCount = meta.issue_summary?.scan_count ?? 0;
    const { details, hidden, more } =
      scanCount > 0
        ? await this.snapshots(buildId)
        : { details: [], hidden: 0, more: false };
    return { meta, details, hidden, more, scanCount };
  }

  /** Every issue of the build at once, to compare it with another. */
  async buildIssues(buildId: string): Promise<AppBuildIssues> {
    const { meta, details, scanCount } = await this.readBuild(buildId);
    const tests = new Set(
      details.map((d) => d.meta?.testcase_name).filter((t) => t !== undefined),
    );
    return {
      buildId,
      build_name: meta.name,
      build_number: meta.build_id,
      ...(meta.created_at ? { created_at: meta.created_at } : {}),
      status: meta.status,
      scan_count: scanCount,
      tests: [...tests] as string[],
      issues: flattenAppSnapshots(details),
    };
  }

  async report(
    buildId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppBuildReport> {
    const { meta, details, hidden, more, scanCount } =
      await this.readBuild(buildId);
    const all = flattenAppSnapshots(details);
    const { rows, context } = compactAppIssues(all);
    const page = pageOf(rows, { nextPage: cursor, maxCharacterLength });
    return {
      ...page,
      ...contextOf(page.records, context),
      total_issues: all.length,
      summary: summarizeAppIssues(all),
      hidden_issues: hidden,
      scan_count: scanCount,
      status: meta.status,
      build_name: meta.name,
      dashboard_link: await this.dashboardLink(meta),
      fup_capped: Boolean(meta.fup?.capped || meta.fup?.tests_dropped),
      ...(meta.session_data?.framework?.name
        ? { framework: meta.session_data.framework.name }
        : {}),
      ...(more ? { screens_read: details.length } : {}),
    };
  }
}
