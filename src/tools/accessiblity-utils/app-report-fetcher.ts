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
  how_to_fix_desc?: string;
  issue_details?: { label?: string; value?: unknown }[];
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
};

/** A report's issues counted by severity, by rule and by screen, largest first. */
export interface AppIssueSummary {
  by_severity: Record<string, number>;
  by_rule: { rule_id: string; issue_type: string; count: number }[];
  by_screen: { screen: string; count: number }[];
}

export interface AppBuildReport {
  records: AppAccessibilityIssue[];
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
export interface AppManualReport {
  records: AppAccessibilityIssue[];
  page_length: number;
  /** Every occurrence the API lists; the dashboard folds duplicates it does not mark. */
  total_issues: number;
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
}

export interface AppProjectRow {
  id: number;
  name: string;
  created_at?: string;
}

/** A build as the listing tool shows it: what it is, how it went, and how to read it. */
export interface AppBuildRow {
  buildId: string;
  build_number?: number;
  name: string;
  status?: string;
  report_status?: string;
  created_at?: string;
  scan_count: number;
  issues: {
    total: number;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  app?: string;
  framework?: string;
  dashboard_link: string;
}

export interface AppManualReportRow {
  reportId: string;
  name: string;
  status?: string;
  created_at?: string;
  app?: string;
  scan_count: number;
  issues: {
    total: number;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    duplicates: number;
    hidden: number;
  };
  dashboard_link: string;
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
        });
      }
    }
  });
  return sortBySeverity(rows);
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

const sameFrame = (a: AppAccessibilityIssue, b: AppAccessibilityIssue) =>
  JSON.stringify(a.element.frame ?? null) ===
  JSON.stringify(b.element.frame ?? null);

/**
 * Which issues of two builds are the same issue. Issues that look alike (one rule on
 * elements known by neither id nor label) are paired one for one, those on the same screen
 * and spot first, then on the same screen, then any; what is left over in either build is
 * new or resolved. So new and still open add up to the later build's issues, and resolved
 * and still open to the earlier one's.
 */
export function compareAppIssues(
  before: AppAccessibilityIssue[],
  after: AppAccessibilityIssue[],
): {
  added: AppAccessibilityIssue[];
  resolved: AppAccessibilityIssue[];
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
  return {
    added,
    resolved: before.filter((row) => !matched.has(row)),
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

/** The severity counts of an issue summary, each defaulting to 0. */
function severityCounts(summary: {
  total?: number;
  severity_count?: Record<string, number | undefined>;
}): {
  total: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
} {
  const sev = summary.severity_count ?? {};
  return {
    total: summary.total ?? 0,
    critical: sev.critical ?? 0,
    serious: sev.serious ?? 0,
    moderate: sev.moderate ?? 0,
    minor: sev.minor ?? 0,
  };
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

  /** The newest projects, as many as asked for. */
  async listAppProjects(
    limit: number,
  ): Promise<{ projects: AppProjectRow[]; total: number }> {
    const data = await this.listing(
      `${APP_API_BASE}/project?page_size=${limit}`,
      "App Accessibility projects",
    );
    const rows: AppProjectRow[] = (data.projects ?? []).map(
      (p: AppProjectRow) => ({
        id: p.id,
        name: p.name,
        ...(p.created_at ? { created_at: p.created_at } : {}),
      }),
    );
    return { projects: rows, total: data.info?.count ?? rows.length };
  }

  /**
   * A project's newest builds, by exact project name, optionally filtered by build name.
   * A project name that matches none exactly names the near matches, so the agent can
   * pick rather than guess.
   */
  async listAppBuilds(
    projectName: string,
    buildName: string | undefined,
    limit: number,
  ): Promise<{
    project: { id: number; name: string };
    total: number;
    builds: AppBuildRow[];
  }> {
    const candidates = await this.projectsNamed(projectName);
    const project = candidates.find((p) => p.name === projectName);
    if (!project) {
      const near = candidates.map((p) => `"${p.name}"`).join(", ");
      throw new Error(
        `No project named "${projectName}"${near ? `. Did you mean: ${near}` : ""}. Call listAppAccessibilityReports without projectName to list the projects`,
      );
    }
    const data = await this.listing(
      `${APP_API_BASE}/project/${project.id}/build?page_size=${limit}${
        buildName ? `&build_name=${encodeURIComponent(buildName)}` : ""
      }`,
      `the builds of "${project.name}"`,
    );
    const rows: any[] = data.builds ?? [];
    const builds: AppBuildRow[] = rows.map((b) => {
      const framework = b.session_data?.frameworkName;
      const language = b.session_data?.language;
      const app = b.app_details?.name ?? b.app_details?.package_name;
      return {
        buildId: b.th_build_id,
        build_number: b.build_number,
        name: b.name,
        status: b.status,
        report_status: b.report_status,
        created_at: b.created_at,
        scan_count: b.issue_summary?.scan_count ?? 0,
        issues: severityCounts(b.issue_summary ?? {}),
        ...(app ? { app } : {}),
        ...(framework
          ? { framework: language ? `${framework} (${language})` : framework }
          : {}),
        dashboard_link: `${APP_DASHBOARD}/automated-tests/projects/${project.id}/builds/${b.normalised_name}/${b.build_number}`,
      };
    });
    return {
      project: { id: project.id, name: project.name },
      total: data.info?.count ?? builds.length,
      builds,
    };
  }

  /** The newest manual reports, optionally filtered by name. */
  async listAppManualReports(
    name: string | undefined,
    limit: number,
  ): Promise<{ total: number; reports: AppManualReportRow[] }> {
    const data = await this.listing(
      `${MANUAL_API_BASE}/reports?page_size=${limit}${
        name ? `&report_name=${encodeURIComponent(name)}` : ""
      }`,
      "manual App Accessibility reports",
    );
    const rows: any[] = data.reports ?? [];
    const reports: AppManualReportRow[] = rows.map((r) => {
      const d = r.app_details;
      const app = d?.name
        ? `${d.name}${d.version ? ` ${d.version}` : ""}${d.package_name ? ` (${d.package_name})` : ""}`
        : undefined;
      const sev = r.issue_summary?.severity_count ?? {};
      return {
        reportId: r.id,
        name: r.name,
        status: r.status,
        created_at: r.created_at,
        ...(app ? { app } : {}),
        scan_count: r.issue_summary?.scan_count ?? 0,
        issues: {
          ...severityCounts(r.issue_summary ?? {}),
          duplicates: sev.duplicate_issues ?? 0,
          hidden: sev.hidden_issues ?? 0,
        },
        dashboard_link: `${APP_DASHBOARD}/report/${r.id}`,
      };
    });
    return { total: data.info?.count ?? reports.length, reports };
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
   * A manual report's issues, every occurrence the API lists, most severe first. The
   * dashboard's own count comes from the report's summary: it folds duplicates that the
   * issue rows do not mark, so the two numbers are both given.
   */
  async appReportIssues(
    reportId: string,
    cursor = 0,
    maxCharacterLength?: number,
  ): Promise<AppManualReport> {
    const detail = await this.manualReport(reportId);
    if (!detail) {
      throw new Error(
        `No App Accessibility manual report with id "${reportId}". Pass the id from listAppAccessibilityReports (kind: manual), or the report's dashboard link (app-accessibility.browserstack.com/report/…) as reportUrl`,
      );
    }
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
    const summary = detail.data?.issue_summary ?? {};
    const all = flattenAppSnapshots(details);
    const page = pageOf(all, { nextPage: cursor, maxCharacterLength });
    return {
      ...page,
      total_issues: all.length,
      summary: summarizeAppIssues(all),
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
   * says whether the list goes on past the page.
   */
  private async *projectBuilds(
    projectId: string | number,
    buildName?: string,
  ): AsyncGenerator<{ rows: AppBuildListRow[]; more: boolean }> {
    const q = encodeURIComponent;
    const named = buildName ? `build_name=${q(buildName)}&` : "";
    for (let page = 1; page <= MAX_APP_BUILD_LIST_PAGES; page++) {
      const resp = await apiClient.get({
        url: `${APP_API_BASE}/project/${q(String(projectId))}/build?${named}page_size=${BUILD_LIST_PAGE_SIZE}&page=${page}`,
        headers: this.headers(),
        raise_error: false,
      });
      const more = Boolean(resp.ok && resp.data?.info?.next);
      yield { rows: resp.data?.builds ?? [], more };
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
    const page = pageOf(all, { nextPage: cursor, maxCharacterLength });
    return {
      ...page,
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
