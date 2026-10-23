import { apiClient } from "../../lib/apiClient.js";
import { pageOf, sortBySeverity } from "./paginate.js";

/**
 * App Accessibility: the issues of a mobile app build run through App Automate with
 * accessibility on. Unlike the web products there is no CSV export behind an access key,
 * so the issues come inline, one API page per batch of scanned screens.
 */
export const APP_API_BASE =
  "https://api-app-accessibility.browserstack.com/automate/api/v1";
export const APP_DASHBOARD = "https://app-accessibility.browserstack.com";

/** Screens per API page, and how many pages a build is read across (1,000 screens). */
const SNAPSHOT_PAGE_SIZE = 50;
export const MAX_SNAPSHOT_PAGES = 20;

/** A dashboard link names a build by number; a build someone just opened is among the newest. */
export const MAX_APP_BUILD_LIST_PAGES = 3;
const BUILD_LIST_PAGE_SIZE = 30;

export interface AppBuildMeta {
  /** The build's number within its project, which the dashboard link uses. */
  build_id: number;
  th_build_id: string;
  name: string;
  normalised_name: string;
  project_name: string;
  /** running | rule_processing | passed | failed | timeout | update_os_version */
  status: string;
  issue_summary?: { total?: number; scan_count?: number };
  fup?: { capped?: boolean; tests_partial?: boolean; tests_dropped?: boolean };
}

interface AppRuleIssue {
  uid: string;
  status?: string;
  duplication_count?: number;
  issue_class_android?: string;
  issue_class_ios?: string;
  issue_id_android?: string;
  issue_id_ios?: string;
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
  meta?: { screenshot_url?: string; testcase_name?: string };
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
  /** Issues hidden in the dashboard, which the API leaves out of the screens. */
  hidden_issues: number;
  scan_count: number;
  status: string;
  build_name: string;
  dashboard_link?: string;
  /** Whether the fair-usage cap dropped tests or scans from this build. */
  fup_capped: boolean;
  /** How many screens were read, when the snapshot page limit stopped short of them all. */
  screens_read?: number;
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

function elementOf(issue: AppRuleIssue): Record<string, unknown> {
  const element: Record<string, unknown> = {};
  for (const { label, value } of issue.issue_details ?? []) {
    if (!label || !ELEMENT_DETAILS.has(label)) continue;
    const parsed = detailValue(value);
    if (parsed === "" || parsed === null || parsed === undefined) continue;
    element[label] = parsed;
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
    if (!important || !label || ELEMENT_DETAILS.has(label)) continue;
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
    for (const rule of snapshot.aggregated_results ?? []) {
      const wcag = (rule.guidelines ?? [])
        .map((g) => g.message)
        .filter(Boolean)
        .join("; ");
      for (const issue of rule.rule_issues ?? []) {
        if (isLeftOut(issue)) continue;
        rows.push({
          issue_type: rule.label,
          rule_id: rule.rule_id,
          severity: (rule.severity ?? "unknown").toLowerCase(),
          screen,
          component:
            issue.issue_id_android ||
            issue.issue_id_ios ||
            issue.issue_class_android ||
            issue.issue_class_ios ||
            rule.label,
          element: elementOf(issue),
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

/** The build an App Accessibility dashboard link names: project id, build name and number. */
function buildOfDashboardLink(
  url: URL,
): { projectId: string; name: string; number: number } | undefined {
  const match = url.pathname.match(
    /\/automated-tests\/projects\/(\d+)\/builds\/([^/]+)\/(\d+)\/?$/,
  );
  if (!match) return undefined;
  // The name in the link is CGI-escaped (spaces are "+") and is TestHub's name for the
  // build, which can differ from the build's own, so it serves only in messages: the
  // build is found by its number, which is unique within the project.
  const name = decodeURIComponent(match[2].replace(/\+/g, " "));
  return { projectId: match[1], name, number: Number(match[3]) };
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
    const q = encodeURIComponent;
    for (let page = 1; page <= MAX_APP_BUILD_LIST_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${APP_API_BASE}/project/${q(build.projectId)}/build?page_size=${BUILD_LIST_PAGE_SIZE}&page=${page}`,
        headers: this.headers(),
        raise_error: false,
      });
      const row = resp.data?.builds?.find(
        (b: { build_number?: number }) => b.build_number === build.number,
      );
      if (row?.th_build_id) return row.th_build_id;
      if (!resp.ok || !resp.data?.info?.next) break;
    }
    throw new Error(
      `No build ${build.number} of "${build.name}" is among the project's newest builds (${MAX_APP_BUILD_LIST_PAGES} pages). Pass the build id instead, as buildId: the BrowserStack SDK prints it as "testhub id" at the end of the run`,
    );
  }

  /** The build's page on the App Accessibility dashboard, when its project can be found. */
  private async dashboardLink(meta: AppBuildMeta): Promise<string | undefined> {
    try {
      const resp = await apiClient.get({
        url: `${APP_API_BASE}/project?name=${encodeURIComponent(meta.project_name)}`,
        headers: this.headers(),
        raise_error: false,
      });
      const project = resp.data?.projects?.find(
        (p: { id?: number; name?: string }) => p.name === meta.project_name,
      );
      if (!project?.id) return undefined;
      return `${APP_DASHBOARD}/automated-tests/projects/${project.id}/builds/${meta.normalised_name}/${meta.build_id}`;
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

  async report(
    buildId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppBuildReport> {
    const meta = await this.buildMeta(buildId);
    if (!meta) {
      throw new Error(
        `No App Accessibility build with id "${buildId}". Pass the id the BrowserStack SDK printed as "testhub id" at the end of the run, or the build's App Accessibility dashboard link as reportUrl`,
      );
    }
    const scanCount = meta.issue_summary?.scan_count ?? 0;
    const { details, hidden, more } =
      scanCount > 0
        ? await this.snapshots(buildId)
        : { details: [], hidden: 0, more: false };
    const all = flattenAppSnapshots(details);
    const { rows, context } = compactAppIssues(all);
    const page = pageOf(rows, { nextPage: cursor, maxCharacterLength });
    return {
      ...page,
      ...contextOf(page.records, context),
      total_issues: all.length,
      hidden_issues: hidden,
      scan_count: scanCount,
      status: meta.status,
      build_name: meta.name,
      dashboard_link: await this.dashboardLink(meta),
      fup_capped: Boolean(meta.fup?.capped || meta.fup?.tests_dropped),
      ...(more ? { screens_read: details.length } : {}),
    };
  }
}
