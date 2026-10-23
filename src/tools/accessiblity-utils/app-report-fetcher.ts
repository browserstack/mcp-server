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

/** Screens per API page, and how many pages a build is read across (1,000 screens). */
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
  /** The test framework the build ran under, when the build's details name it. */
  framework?: string;
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
    const buildId = await this.findBuild(
      build.projectId,
      undefined,
      (row) => row.build_number === build.number,
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
   * A native build's details name its project; the App Automate build list names the build
   * ("Build #N: app vX"); App Accessibility lists the run under the same project and name.
   */
  private async buildOfNativeBuild(buildId: string): Promise<string> {
    const project = await this.nativeBuildProject(buildId);
    if (!project) {
      throw new Error(
        `No session found for App Automate build ${buildId}, and it is not an Espresso or XCUITest build with a project, so it cannot be mapped to its accessibility report. Pass the build id the BrowserStack SDK printed as "testhub id" as buildId, or the build's App Accessibility dashboard link as reportUrl`,
      );
    }
    const name = await this.appAutomateBuildName(buildId);
    if (!name) {
      throw new Error(
        `App Automate build ${buildId} is not among the account's newest builds (${MAX_APP_AUTOMATE_BUILD_PAGES} pages of ${APP_AUTOMATE_BUILDS_PAGE_SIZE}), so its accessibility report cannot be found by name. Pass the build's App Accessibility dashboard link as reportUrl instead`,
      );
    }
    const projectId = await this.projectId(project);
    const found =
      projectId !== undefined &&
      (await this.findBuild(projectId, name, (row) => row.name === name));
    if (!found) {
      throw new Error(
        `No App Accessibility build named "${name}" in project "${project}": accessibility was not on for this run. Run it again with \`accessibility: true\` in the Espresso/XCUITest build request`,
      );
    }
    return found;
  }

  /** The project a native build was run under, from whichever framework API knows it. */
  private async nativeBuildProject(
    buildId: string,
  ): Promise<string | undefined> {
    for (const framework of ["espresso", "xcuitest"]) {
      const resp = await apiClient.get({
        url: `https://api-cloud.browserstack.com/app-automate/${framework}/v2/builds/${encodeURIComponent(buildId)}`,
        headers: this.headers(),
        raise_error: false,
      });
      if (resp.ok) return resp.data?.input_capabilities?.project;
    }
    return undefined;
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
    const resp = await apiClient.get({
      url: `${APP_API_BASE}/project?name=${encodeURIComponent(name)}`,
      headers: this.headers(),
      raise_error: false,
    });
    return resp.data?.projects?.find(
      (p: { id?: number; name?: string }) => p.name === name,
    )?.id;
  }

  /**
   * The id of the project's build that `pick` accepts, newest first, within the first
   * pages; `buildName` narrows the list to builds named like it, when the name is known
   * to be the build's own.
   */
  private async findBuild(
    projectId: string | number,
    buildName: string | undefined,
    pick: (row: { name?: string; build_number?: number }) => boolean,
  ): Promise<string | undefined> {
    const q = encodeURIComponent;
    const named = buildName ? `build_name=${q(buildName)}&` : "";
    for (let page = 1; page <= MAX_APP_BUILD_LIST_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${APP_API_BASE}/project/${q(String(projectId))}/build?${named}page_size=${BUILD_LIST_PAGE_SIZE}&page=${page}`,
        headers: this.headers(),
        raise_error: false,
      });
      const row = resp.data?.builds?.find(pick);
      if (row?.th_build_id) return row.th_build_id;
      if (!resp.ok || !resp.data?.info?.next) break;
    }
    return undefined;
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
      ...(meta.session_data?.framework?.name
        ? { framework: meta.session_data.framework.name }
        : {}),
      ...(more ? { screens_read: details.length } : {}),
    };
  }
}
