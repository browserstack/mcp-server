import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  AccessibilityReportFetcher,
  IssueSource,
  WebBuild,
  WebBuildComparison,
} from "./report-fetcher.js";
import type { compareIssues, RunIssue } from "./report-parser.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import {
  COMPARE_LIST_LIMIT,
  comparedList,
  diffExports,
  pagesNotLoadedNote,
} from "./compare-lists.js";
import { notReadyToCompare, readBothToCompare } from "./compare-with.js";
import {
  createErrorResponse,
  createSuccessResponse,
  describeSource,
  PROCESSING_STATUSES,
  type ScanProgressContext,
} from "./shared.js";

/* fetchAccessibilityIssues's compareWith on an Automated Tests (web) build. */

/** A web build in prose: its number and id. Its name is the user's own, so it goes in data. */
function webBuildRef(build: WebBuild): string {
  return `build ${build.buildNumber !== undefined ? `#${build.buildNumber} ` : ""}(${build.buildId}${build.startedAt ? `, started ${build.startedAt}` : ""})`;
}

/** Web builds' names, projects, numbers, ids and starts, quoted as data. */
function webBuildsData(builds: Record<string, WebBuild>): string {
  const data = Object.fromEntries(
    Object.entries(builds).map(([role, b]) => [
      role,
      {
        name: b.name,
        project: b.projectName,
        build_number: b.buildNumber,
        id: b.buildId,
        started: b.startedAt,
      },
    ]),
  );
  return `Builds: ${wrapUntrusted("Automated Tests builds", JSON.stringify(data, null, 2))}`;
}

/**
 * A build the build list calls `failed` completed with no test cases, so it has no
 * accessibility results: there is nothing to compare it with, which is said as guidance.
 */
function noResultsToCompare(
  build: WebBuild,
  builds: Record<string, WebBuild>,
  previous = false,
): CallToolResult {
  const ref = webBuildRef(build);
  const which = previous
    ? `The run before this build with the same build name and project ("previous") is ${ref}, which`
    : `${ref[0].toUpperCase()}${ref.slice(1)}`;
  return createSuccessResponse([
    `${which} has no accessibility results: its status is failed, which Automated Tests gives a build that completed with no test cases. There is nothing to compare; compare with another build, or run the tests again with accessibility on.`,
    webBuildsData(builds),
  ]);
}

/** The three lists of a web build comparison, and what is set apart from them. */
interface WebCompareLists {
  counts: { new: number; fixed: number; open: number };
  new: RunIssue[];
  fixed: RunIssue[];
  open: RunIssue[];
  /** Where only the first issues of a list were read: its count, to say how many more. */
  totals?: { new: number; fixed: number; open: number };
  /** What did not load, said before the lists. */
  warnings: string[];
  /** The issues set apart because their page did not load, listed after them. */
  setApart: string[];
  /** Where the issues not listed are. */
  rest: string;
  closing: string[];
}

function webComparisonMessages(
  head: string[],
  lists: WebCompareLists,
): CallToolResult {
  const { counts, totals = lists.counts } = lists;
  return createSuccessResponse([
    ...head,
    `${counts.new} new, ${counts.fixed} fixed, ${counts.open} still open.`,
    ...lists.warnings,
    `New (only in the later build) (${counts.new}): ${comparedList(lists.new, totals.new, lists.rest)}`,
    `Fixed (only in the earlier build) (${counts.fixed}): ${comparedList(lists.fixed, totals.fixed, lists.rest)}`,
    `Still open (in both) (${counts.open}): ${comparedList(lists.open, totals.open, lists.rest)}`,
    ...lists.setApart,
    ...lists.closing,
  ]);
}

/**
 * The compare API's comparison as lists. Issues found on an error page are set apart: the
 * page did not load, so they say nothing about the page. The API counts them in its lists.
 */
function apiComparisonLists(comparison: WebBuildComparison): WebCompareLists {
  const { counts, issues } = comparison;
  const loaded = (rows: RunIssue[]) => rows.filter((r) => !r.on_error_page);
  // A list's issues not read count as more; those set apart are listed below.
  const more = (rows: RunIssue[], count: number) =>
    loaded(rows).length + Math.max(0, count - rows.length);
  const apart = [
    ...issues.new.map((r) => ({ ...r, list: "new" })),
    ...issues.resolved.map((r) => ({ ...r, list: "fixed" })),
    ...issues.retained.map((r) => ({ ...r, list: "still open" })),
  ].filter((r) => r.on_error_page);
  return {
    counts: {
      new: counts.new,
      fixed: counts.resolved,
      open: counts.retained,
    },
    new: loaded(issues.new),
    fixed: loaded(issues.resolved),
    open: loaded(issues.retained),
    totals: {
      new: more(issues.new, counts.new),
      fixed: more(issues.resolved, counts.resolved),
      open: more(issues.retained, counts.retained),
    },
    warnings:
      apart.length > 0
        ? [
            `⚠️ ${apart.length === 1 ? "1 issue listed was" : `${apart.length} issues listed were`} found on an error page (BrowserStack Local's connection page or Chrome's network error page) scanned in place of a page that did not load. ${apart.length === 1 ? "It is" : "They are"} set apart below as "page did not load", not listed as new, fixed or still open; the counts above include ${apart.length === 1 ? "it" : "them"}. Run the tests again once the page loads.`,
          ]
        : [],
    setApart:
      apart.length > 0
        ? [`Page did not load (${apart.length}): ${comparedList(apart)}`]
        : [],
    rest: "",
    closing: [],
  };
}

/** Two web builds' CSV exports matched by rule, element and page, as lists. */
function diffComparisonLists(
  {
    links,
    diff,
  }: { links: [string, string]; diff: ReturnType<typeof compareIssues> },
  before: WebBuild,
  after: WebBuild,
): WebCompareLists {
  // Two builds of different names can share a number, so the id is said too.
  const label = (b: WebBuild) =>
    `build ${b.buildNumber !== undefined ? `#${b.buildNumber} ` : ""}(${b.buildId})`;
  return {
    counts: {
      new: diff.added.length,
      fixed: diff.resolved.length,
      open: diff.still_open.length,
    },
    new: diff.added,
    fixed: diff.resolved,
    open: diff.still_open,
    warnings: pagesNotLoadedNote(diff, label(after), label(before), "build"),
    setApart: [
      ...(diff.not_checked.length
        ? [
            `Not checked (page did not load in ${label(after)}): ${comparedList(diff.not_checked)}`,
          ]
        : []),
      ...(diff.not_checked_earlier.length
        ? [
            `Not checked against the earlier build (page did not load in ${label(before)}): ${comparedList(diff.not_checked_earlier)}`,
          ]
        : []),
    ],
    rest: "; see the CSV links",
    closing: [
      `CSV of each build, valid for about 12 hours: later ${links[0]} , earlier ${links[1]}`,
    ],
  };
}

/** How an issue list is matched when the compare API does not compare the two builds. */
const MATCHED_BY_ELEMENT =
  "so the issue lists were matched by rule, element and page.";

/**
 * An Automated Tests build against another (its id or report link) or "previous", from the
 * older build ("before") to the newer ("after"), whichever order they were passed in. Two
 * builds of one build name and project are compared by the Automated Tests compare API, as
 * the dashboard compares them; any other pair, or one the API refuses or does not answer in
 * time, by matching their issue exports by rule, element and page, as Scanner runs are.
 */
export async function compareWebBuilds(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "build"; buildId: string },
  compareWith: string,
  preface: string[],
  context?: ScanProgressContext,
): Promise<CallToolResult> {
  const self = await reportFetcher.webBuild(source.buildId);
  if (!self) {
    throw new Error(`Could not read Automated Tests build ${source.buildId}`);
  }
  let other: WebBuild | undefined;
  if (compareWith !== "previous") {
    let named: IssueSource;
    try {
      named = await reportFetcher.resolveBuild(
        /^https?:\/\//i.test(compareWith)
          ? await reportFetcher.sourceFromReportUrl(compareWith)
          : { kind: "build", buildId: compareWith },
      );
    } catch (error) {
      return createErrorResponse(
        `compareWith: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    if (named.kind !== "build") {
      return readBothToCompare(
        `compareWith names ${describeSource(named)}, which is not an Automated Tests build; an Automated Tests build is compared here only with another ("previous", or another build's id or link).`,
        false,
      );
    }
    if (named.buildId === source.buildId) {
      return createErrorResponse(
        `compareWith names this build itself. Pass another build's id or link, or "previous".`,
      );
    }
    other = await reportFetcher.webBuild(named.buildId);
    if (!other) {
      throw new Error(`Could not read Automated Tests build ${named.buildId}`);
    }
  }

  const [selfStatus, otherStatus] = await Promise.all([
    reportFetcher.reportStatus(source),
    other
      ? reportFetcher.reportStatus({ kind: "build", buildId: other.buildId })
      : undefined,
  ]);
  // The older build is "before": by start, whichever was passed as compareWith.
  const started = (b: WebBuild) => Date.parse(b.startedAt ?? "");
  const reversed = other !== undefined && started(other) > started(self);
  let before = reversed ? self : other;
  const after = reversed ? other! : self;
  const pair = (b: WebBuild | undefined): Record<string, WebBuild> =>
    b ? { before: b, after } : { after };
  for (const [build, status] of [
    [self, selfStatus],
    [other, otherStatus],
  ] as const) {
    if (build && status === "failed") {
      return noResultsToCompare(build, pair(before));
    }
  }
  const notReady = (build: WebBuild, status: string | undefined) =>
    status && PROCESSING_STATUSES.has(status)
      ? notReadyToCompare(
          `Automated Tests ${webBuildRef(build)}`,
          status,
          preface,
        )
      : undefined;
  const unfinished =
    notReady(self, selfStatus) ?? (other && notReady(other, otherStatus));
  if (unfinished) return unfinished;

  const head = (base: WebBuild, lines: string[]) => [
    ...preface,
    `Compared Automated Tests builds: before ${webBuildRef(base)}, after ${webBuildRef(after)}.`,
    ...(reversed
      ? ["compareWith was the newer build, so it is used as 'after'."]
      : []),
    ...lines,
    webBuildsData({ before: base, after }),
  ];

  let method: string;
  if (
    !before ||
    (before.name === after.name && before.projectName === after.projectName)
  ) {
    const compared = await reportFetcher.compareWebBuilds(
      after.buildId,
      before?.buildId,
      COMPARE_LIST_LIMIT,
    );
    if (!("refused" in compared)) {
      // The API's summary leaves the project out; the overview has it, and the status check
      // below reads the overview anyway.
      const base: WebBuild =
        before ??
        (await reportFetcher.webBuild(compared.base.buildId)) ??
        compared.base;
      if (!before) {
        const baseStatus = await reportFetcher.reportStatus({
          kind: "build",
          buildId: base.buildId,
        });
        if (baseStatus === "failed") {
          return noResultsToCompare(base, pair(base), true);
        }
        const baseUnfinished = notReady(base, baseStatus);
        if (baseUnfinished) return baseUnfinished;
      }
      return webComparisonMessages(
        head(base, [
          ...(before
            ? []
            : [
                `compareWith "previous": the compare API used the run before it with the same build name and project, ${webBuildRef(base)}.`,
              ]),
          "Same build name and project, so this is the Automated Tests compare API's comparison, as the dashboard shows it: issues are matched by the dashboard's own issue key (key below), not by rule, element and page alone.",
        ]),
        apiComparisonLists(compared),
      );
    }
    if (compared.noPrevious) {
      return createErrorResponse(
        `${webBuildRef(after)} is the first completed run of its build name in its project, so there is nothing earlier to compare it with. Pass another build's id or link as compareWith instead.`,
      );
    }
    if (!before) {
      const previous = await reportFetcher.previousWebBuild(after);
      if (!previous) {
        return createErrorResponse(
          `The compare API gave no comparison (${compared.refused}), and no earlier completed run of this build's name is among its project's newest builds. Pass the earlier build's id or link as compareWith instead.`,
        );
      }
      if (previous.status === "failed") {
        return noResultsToCompare(previous, pair(previous), true);
      }
      before = previous;
    }
    method = `The compare API gave no comparison (${compared.refused}), ${MATCHED_BY_ELEMENT}`;
  } else {
    method =
      before.name !== after.name
        ? `Different build names, ${MATCHED_BY_ELEMENT}`
        : `Different projects, ${MATCHED_BY_ELEMENT}`;
  }

  const read = await diffExports(
    reportFetcher,
    { kind: "build", buildId: after.buildId },
    { kind: "build", buildId: before.buildId },
    "builds",
    context,
  );
  if ("content" in read) return read;
  return webComparisonMessages(
    head(before, [
      ...(compareWith === "previous"
        ? [
            `compareWith "previous": the run before it with the same build name and project, ${webBuildRef(before)}.`,
          ]
        : []),
      method,
    ]),
    diffComparisonLists(read, before, after),
  );
}
