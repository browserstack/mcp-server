import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// compareWith on an Automated Tests (web) build: two builds of one name and project are
// compared by the Automated Tests compare API, any other pair (or one the API refuses or does
// not answer) by matching the builds' issue exports by rule, element and page. The older
// build is "before" whichever order they come in, and a build with no results is not compared.
// The HTTP layer is mocked; the report fetcher and the CSV parser run as they do live.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/lib/get-auth.js", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/index.js", () => ({ trackMCP: vi.fn(), PackageJsonVersion: "0.0.0" }));

import { apiClient } from "../../src/lib/apiClient.js";
import addAccessibilityTools from "../../src/tools/accessibility.js";
import { reportExports } from "../../src/tools/accessiblity-utils/report-fetcher.js";

const get = apiClient.get as Mock;
const API = "https://api-accessibility.browserstack.com/api";
const COMPARE = `${API}/automated-tests/v1/builds/compare/issues`;

type Build = { id: string; name: string; number: number; time: string; status: string };

const OLD: Build = { id: "c1oldbuildaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "checkout", number: 1, time: "2026-11-03T11:28:55.781Z", status: "completed" };
const NEW: Build = { id: "c2newbuildbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", name: "checkout", number: 2, time: "2026-11-03T11:32:05.806Z", status: "completed" };
const OTHER: Build = { id: "s1smokebuildcccccccccccccccccccccccccccc", name: "smoke", number: 1, time: "2026-11-03T13:35:49.619Z", status: "completed" };
const EMPTY: Build = { id: "c3emptybuilddddddddddddddddddddddddddddd", name: "checkout", number: 3, time: "2026-11-04T09:00:00.000Z", status: "failed" };
const LATEST: Build = { id: "c4latestbuildeeeeeeeeeeeeeeeeeeeeeeeeeee", name: "checkout", number: 4, time: "2026-11-04T11:52:19.537Z", status: "completed" };
const BUILDS = [LATEST, EMPTY, OTHER, NEW, OLD]; // the project's build list: newest first
const PROJECT = "Shop";
const APP_BUILD = "a9appbuildgggggggggggggggggggggggggggggg";
const APP_API = "https://api-app-accessibility.browserstack.com/automate/api/v1";

const PAGE_A = "http://localhost:8765/home.html";
const PAGE_B = "http://localhost:8765/usage.html";
const PRIVOXY = '<a href="https://www.browserstack.com/docs/local?ref=dashboard-privoxy-page">Local</a>';

// ---- the API's answers --------------------------------------------------------------

type Reply = { ok: boolean; status: number; data: unknown; statusText?: string };
const ok = (data: unknown): Reply => ({ ok: true, status: 200, data: { success: true, data, error: [] } });

// The API's summary leaves the project name out (null), as it does live.
const summaryOf = (b: Build, autoResolved?: boolean) => ({
  id: b.id,
  createdOn: b.time,
  projectName: null,
  buildName: b.name,
  buildNumber: b.number,
  isGrouped: true,
  ...(autoResolved === undefined ? {} : { autoResolved }),
});

function apiRow(status: string, rule: string, selector: string, page = PAGE_A, html = "<x>") {
  return { issueId: `${status}-${rule}-${selector}`, status, impact: "serious", url: page, componentId: selector, target: [selector], html, ruleData: { id: rule }, behaviour: "visible" };
}

function comparison(
  rows: ReturnType<typeof apiRow>[],
  { base = OLD, after = NEW, counts, autoResolved = false }: { base?: Build; after?: Build; counts?: [number, number, number]; autoResolved?: boolean } = {},
): Reply {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const [n, retained, resolved] = counts ?? [count("new"), count("retained"), count("resolved")];
  return ok({
    summary: {
      newIssues: n,
      retainedIssues: retained,
      resolvedIssues: resolved,
      isMixedComparison: false,
      isGroupedComparison: true,
      baseReport: summaryOf(base, autoResolved),
      newReport: summaryOf(after),
    },
    issues: rows,
    pagination: { hasNext: false, nextPage: null },
  });
}

// ---- the builds' CSV exports ---------------------------------------------------------

const COLUMNS = ["Issue type", "Severity", "Component", "Affected page", "HTML snippet", "CSS selector", "Issue link", "Duplicate Issue of", "Issue status"];
const csvRow = (type: string, selector: string, page = PAGE_A, snippet = "<x>") => ({
  "Issue type": type,
  Severity: "serious",
  Component: selector,
  "Affected page": page,
  "HTML snippet": snippet,
  "CSS selector": selector,
  "Issue link": `https://dash.example/issue?activeIssueId=${type}-${selector}-${page}`,
  "Duplicate Issue of": "NA",
  "Issue status": "visible",
});
const toCsv = (rows: Record<string, string>[]) =>
  [COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c] ?? ""))]
    .map((cells) => cells.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
    .join("\n");

let exportsOf: Record<string, Record<string, string>[]>;
let compareReply: (params: URLSearchParams) => Reply | Promise<Reply>;

function route({ url }: { url: string }): Reply | Promise<Reply> {
  const u = new URL(url);
  if (url.startsWith(COMPARE)) return compareReply(u.searchParams);
  const overview = u.pathname.match(/\/automated-tests\/v1\/builds\/([a-z0-9]{40})$/)?.[1];
  const build = BUILDS.find((b) => b.id === overview);
  if (build) {
    return ok({ id: build.id, name: build.name, projectName: PROJECT, buildNumber: build.number, time: build.time });
  }
  if (u.pathname.endsWith("/automated-tests/v1/builds") && u.searchParams.get("project_name") === PROJECT) {
    return ok({
      builds: BUILDS.map((b) => ({ id: b.id, name: b.name, buildNumber: b.number, time: b.time, status: b.status })),
      pagination: { has_next: false, next_page: null },
    });
  }
  if (u.pathname.endsWith("/automated-tests/v1/builds/issues")) {
    const start = u.searchParams.get("buildUuid");
    return {
      ok: true,
      status: 200,
      data: start
        ? { success: true, data: { task_id: `t-${start}` } }
        : { success: true, data: { reportLink: `https://csv.example/${u.searchParams.get("taskId")!.slice(2)}` } },
    };
  }
  if (url === `${APP_API}/build/${APP_BUILD}`) {
    return { ok: true, status: 200, data: { meta_data: { build_id: 7, th_build_id: APP_BUILD, name: "app", status: "done" } } };
  }
  if (u.host === "csv.example") {
    return { ok: true, status: 200, statusText: "OK", data: toCsv(exportsOf[u.pathname.slice(1)] ?? []) };
  }
  return { ok: false, status: 404, data: {} };
}

const compareCalls = () =>
  get.mock.calls.map(([o]) => o.url as string).filter((u) => u.startsWith(COMPARE)).map((u) => new URL(u).searchParams);
const exportCalls = () => get.mock.calls.map(([o]) => o.url as string).filter((u) => u.includes("buildUuid="));

function fetchIssues() {
  let handler: (...args: any[]) => any = () => undefined;
  const server: any = {
    tool: vi.fn((...args: any[]) => {
      if (args[0] === "fetchAccessibilityIssues") handler = args[args.length - 1];
    }),
    server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
  };
  addAccessibilityTools(server, { "browserstack-username": "fake-user", "browserstack-access-key": "fake-key" } as any);
  return (args: Record<string, unknown>) => handler(args, { sendNotification: vi.fn(), _meta: {} });
}

const text = (result: any) => result.content.map((c: { text: string }) => c.text).join("\n");
/** The JSON array a list's untrusted block holds. */
function listed(out: string, label: string): any[] {
  const at = out.indexOf(label);
  expect(at).toBeGreaterThan(-1);
  const open = out.indexOf("»\n", at) + 2;
  const close = out.indexOf("\n«END UNTRUSTED", open);
  return JSON.parse(out.slice(open, close));
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(route);
  reportExports.clear();
  exportsOf = {
    // Before: a and b on page A. After (NEW): a and c. After (OTHER): a and d.
    [OLD.id]: [csvRow("image-alt", "img"), csvRow("label", "input#q")],
    [NEW.id]: [csvRow("image-alt", "img"), csvRow("region", "div.main")],
    [OTHER.id]: [csvRow("image-alt", "img"), csvRow("link-name", "a.more")],
    [LATEST.id]: [csvRow("image-alt", "img")],
  };
  compareReply = () => comparison([apiRow("new", "region", "div.main"), apiRow("retained", "image-alt", "img"), apiRow("resolved", "label", "input#q")]);
});

describe("compareWith on an Automated Tests build", () => {
  it("compares two builds of one name and project through the compare API, newer as newReport", async () => {
    compareReply = () =>
      comparison(
        [apiRow("new", "region", "div.main"), apiRow("retained", "image-alt", "img"), apiRow("resolved", "label", "input#q")],
        { counts: [6, 1, 13] },
      );

    const result = await fetchIssues()({ buildId: NEW.id, compareWith: OLD.id });
    const out = text(result);

    expect(result.isError).toBeFalsy();
    const [call] = compareCalls();
    expect(call.get("newReport")).toBe(NEW.id);
    expect(call.get("baseReport")).toBe(OLD.id);
    expect(exportCalls()).toEqual([]);
    expect(out).toContain(
      "Same build name and project, so this is the Automated Tests compare API's comparison, as the dashboard shows it: issues are matched by the dashboard's own issue key (key below), not by rule, element and page alone.",
    );
    expect(out).toContain("6 new, 13 fixed, 1 still open.");
    expect(out).toContain(`before build #1 (${OLD.id}, started ${OLD.time}), after build #2 (${NEW.id}, started ${NEW.time})`);
    expect(out).not.toContain("compareWith was the newer build");
    expect(listed(out, "New (only in the later build) (6)").map((r) => r.issue_type)).toEqual(["region"]);
    expect(listed(out, "Fixed (only in the earlier build) (13)").map((r) => r.issue_type)).toEqual(["label"]);
    expect(listed(out, "Still open (in both) (1)").map((r) => r.issue_type)).toEqual(["image-alt"]);
    // The builds' names are the user's own, so they are quoted as data.
    expect(out.indexOf('"name": "checkout"')).toBeGreaterThan(out.indexOf("«UNTRUSTED Automated Tests builds"));
    expect(out).not.toMatch(/GitHub/);
  });

  it("keys each issue as the API matched it, so one it lists as both fixed and new reads as two", async () => {
    // A fix added lang to <html>: the API tells the element's issue before and after apart.
    compareReply = () =>
      comparison([
        { ...apiRow("new", "css-orientation-lock", "html", PAGE_B, '<html lang="en">'), signatureKey: "41ce86653b15" },
        { ...apiRow("resolved", "css-orientation-lock", "html", PAGE_B, "<html>"), signatureKey: "d75d13a148fd" },
      ]);

    const out = text(await fetchIssues()({ buildId: NEW.id, compareWith: OLD.id }));

    expect(listed(out, "New (only in the later build) (1)")).toMatchObject([{ key: "41ce86653b15", selector: "html", affected_page: PAGE_B }]);
    expect(listed(out, "Fixed (only in the earlier build) (1)")).toMatchObject([{ key: "d75d13a148fd", selector: "html", affected_page: PAGE_B }]);
  });

  it("takes the other build as an Automated Tests report link", async () => {
    const link = `https://accessibility.browserstack.com/automated-tests/projects/Shop/builds/checkout/1?thBuildId=${OLD.id}`;

    await fetchIssues()({ buildId: NEW.id, compareWith: link });

    expect(compareCalls()[0].get("baseReport")).toBe(OLD.id);
  });

  it("matches two builds of different names by rule, element and page, and says so", async () => {
    const result = await fetchIssues()({ buildId: OTHER.id, compareWith: OLD.id });
    const out = text(result);

    expect(result.isError).toBeFalsy();
    expect(compareCalls()).toEqual([]);
    expect(out).toContain("Different build names, so the issue lists were matched by rule, element and page.");
    expect(out).toContain("1 new, 1 fixed, 1 still open.");
    expect(listed(out, "New (only in the later build) (1)").map((r) => r.issue_type)).toEqual(["link-name"]);
    expect(listed(out, "Fixed (only in the earlier build) (1)").map((r) => r.issue_type)).toEqual(["label"]);
    expect(listed(out, "Still open (in both) (1)").map((r) => r.issue_type)).toEqual(["image-alt"]);
    expect(out).toContain("CSV of each build, valid for about 12 hours: later https://csv.example/");
  });

  it.each<[string, () => Reply | Promise<Reply>, string]>([
    [
      "refuses a pair over its issue-count threshold",
      () => ({ ok: true, status: 200, data: { success: false, message: "Comparison of larger reports are currently not supported." } }),
      "The compare API gave no comparison (Comparison of larger reports are currently not supported.), so the issue lists were matched by rule, element and page.",
    ],
    [
      "runs out of its 30 s",
      () => ({ ok: false, status: 504, data: { success: false, data: null, error: ["Request timed out"] } }),
      "The compare API gave no comparison (Request timed out), so the issue lists were matched by rule, element and page.",
    ],
    [
      "does not answer at all",
      () => Promise.reject(Object.assign(new Error("timeout of 40000ms exceeded"), { code: "ECONNABORTED" })),
      "The compare API gave no comparison (no answer within 40 s), so the issue lists were matched by rule, element and page.",
    ],
  ])("matches the issue lists itself when the compare API %s", async (_case, reply, method) => {
    compareReply = reply;

    const result = await fetchIssues()({ buildId: NEW.id, compareWith: OLD.id });
    const out = text(result);

    expect(result.isError).toBeFalsy();
    expect(out).toContain(method);
    expect(out).toContain("1 new, 1 fixed, 1 still open.");
    expect(listed(out, "New (only in the later build) (1)").map((r) => r.issue_type)).toEqual(["region"]);
    expect(out).not.toMatch(/GitHub/);
  });

  it("uses the older build as 'before' when compareWith is the newer one, and says so", async () => {
    const result = await fetchIssues()({ buildId: OLD.id, compareWith: NEW.id });
    const out = text(result);

    const [call] = compareCalls();
    expect(call.get("newReport")).toBe(NEW.id);
    expect(call.get("baseReport")).toBe(OLD.id);
    expect(out).toContain("compareWith was the newer build, so it is used as 'after'.");
    expect(out).toContain(`before build #1 (${OLD.id}`);
  });

  it("swaps a different-name pair the same way before matching it", async () => {
    const out = text(await fetchIssues()({ buildId: OLD.id, compareWith: OTHER.id }));

    expect(out).toContain("compareWith was the newer build, so it is used as 'after'.");
    expect(listed(out, "New (only in the later build) (1)").map((r) => r.issue_type)).toEqual(["link-name"]);
    expect(listed(out, "Fixed (only in the earlier build) (1)").map((r) => r.issue_type)).toEqual(["label"]);
  });

  it('compares with "previous" through the compare API, and names the build it used', async () => {
    compareReply = () => comparison([apiRow("new", "region", "div.main")], { autoResolved: true });

    const out = text(await fetchIssues()({ buildId: NEW.id, compareWith: "previous" }));

    const [call] = compareCalls();
    expect(call.get("newReport")).toBe(NEW.id);
    expect(call.has("baseReport")).toBe(false);
    expect(out).toContain(
      `compareWith "previous": the compare API used the run before it with the same build name and project, build #1 (${OLD.id}, started ${OLD.time}).`,
    );
    expect(out).toContain("1 new, 0 fixed, 0 still open.");
    expect(out).toContain('"project": "Shop"');
    expect(out).not.toContain('"project": null');
  });

  it('says when "previous" has nothing earlier, as an answer rather than a failure to report', async () => {
    compareReply = () => ({ ok: false, status: 404, data: { success: false, message: "No previous completed run of this build to compare against." } });

    const result = await fetchIssues()({ buildId: OLD.id, compareWith: "previous" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("is the first completed run of its build name in its project");
    expect(text(result)).not.toMatch(/GitHub/);
  });

  it('finds the run before it itself when the compare API gives no comparison for "previous"', async () => {
    compareReply = () => ({ ok: false, status: 504, data: { success: false, error: ["Request timed out"] } });

    const out = text(await fetchIssues()({ buildId: NEW.id, compareWith: "previous" }));

    expect(out).toContain(`compareWith "previous": the run before it with the same build name and project, build #1 (${OLD.id}`);
    expect(out).toContain("1 new, 1 fixed, 1 still open.");
  });

  it("does not compare a build with no accessibility results, and says so as guidance", async () => {
    const result = await fetchIssues()({ buildId: EMPTY.id, compareWith: NEW.id });
    const out = text(result);

    expect(result.isError).toBeFalsy();
    expect(out).toContain(`Build #3 (${EMPTY.id}, started ${EMPTY.time}) has no accessibility results: its status is failed`);
    expect(compareCalls()).toEqual([]);
    expect(exportCalls()).toEqual([]);
    expect(out).not.toMatch(/GitHub/);
  });

  it('does not compare with a "previous" build that has no accessibility results', async () => {
    compareReply = () => comparison([], { base: EMPTY, after: LATEST, autoResolved: true });

    const result = await fetchIssues()({ buildId: LATEST.id, compareWith: "previous" });
    const out = text(result);

    expect(result.isError).toBeFalsy();
    expect(out).toContain(`The run before this build with the same build name and project ("previous") is build #3 (${EMPTY.id}`);
    expect(out).toContain("has no accessibility results");
    expect(out).not.toContain("still open.");
  });

  it("lists at most 50 issues of each list, reading a list the first page cuts short on its own, and says how many more", async () => {
    const news = Array.from({ length: 100 }, (_, i) => apiRow("new", "region", `div.n${i}`));
    const resolved = Array.from({ length: 50 }, (_, i) => apiRow("resolved", "label", `input.r${i}`));
    compareReply = (params) =>
      params.get("status") === "resolved"
        ? comparison(resolved, { counts: [0, 0, 60] })
        : comparison(news, { counts: [120, 0, 60] });

    const out = text(await fetchIssues()({ buildId: NEW.id, compareWith: OLD.id }));

    const calls = compareCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].get("limit")).toBe("100");
    expect(calls[1].get("status")).toBe("resolved");
    expect(calls[1].get("limit")).toBe("50");
    expect(calls[1].get("baseReport")).toBe(OLD.id);
    expect(out).toContain("120 new, 60 fixed, 0 still open.");
    expect(listed(out, "New (only in the later build) (120)")).toHaveLength(50);
    expect(out).toContain("(70 more not listed.)");
    expect(listed(out, "Fixed (only in the earlier build) (60)")).toHaveLength(50);
    expect(out).toContain("(10 more not listed.)");
  });

  it("caps the lists it matches itself the same way", async () => {
    exportsOf[OTHER.id] = Array.from({ length: 53 }, (_, i) => csvRow("region", `div.n${i}`));

    const out = text(await fetchIssues()({ buildId: OTHER.id, compareWith: OLD.id }));

    expect(listed(out, "New (only in the later build) (53)")).toHaveLength(50);
    expect(out).toContain("(3 more not listed; see the CSV links.)");
  });

  it("sets apart issues the compare API found on an error page, as a page that did not load", async () => {
    compareReply = () =>
      comparison([apiRow("new", "region", "div.main"), apiRow("new", "link-name", "a", PAGE_B, PRIVOXY), apiRow("retained", "image-alt", "img")]);

    const out = text(await fetchIssues()({ buildId: NEW.id, compareWith: OLD.id }));

    expect(out).toContain("⚠️ 1 issue listed was found on an error page");
    expect(listed(out, "New (only in the later build) (2)").map((r) => r.issue_type)).toEqual(["region"]);
    expect(listed(out, "Page did not load (1)")).toMatchObject([{ issue_type: "link-name", list: "new", on_error_page: true }]);
  });

  it("sets apart a page that did not load in the later build when it matches the lists itself", async () => {
    exportsOf[OLD.id] = [csvRow("image-alt", "img"), csvRow("label", "input#q", PAGE_B)];
    exportsOf[OTHER.id] = [csvRow("image-alt", "img"), csvRow("link-name", "a", PAGE_B, PRIVOXY)];

    const out = text(await fetchIssues()({ buildId: OTHER.id, compareWith: OLD.id }));

    expect(out).toContain(`⚠️ 1 page did not load in build #1 (${OTHER.id}): an error page was scanned in its place.`);
    expect(out).toContain("Run the tests again once it loads.");
    expect(out).toContain("0 new, 0 fixed, 1 still open.");
    expect(listed(out, `Not checked (page did not load in build #1 (${OTHER.id}))`).map((r) => r.issue_type)).toEqual(["label"]);
  });

  it("sets apart a page whose error-page issues are all duplicates of another page's", async () => {
    // A grouped report: the error page on page A is the main issue, the same error page on
    // page B a duplicate of it. Page B did not load either.
    const main = csvRow("link-name", "a", PAGE_A, PRIVOXY);
    exportsOf[OLD.id] = [csvRow("image-alt", "img"), csvRow("label", "input#q", PAGE_B)];
    exportsOf[OTHER.id] = [main, { ...csvRow("link-name", "a", PAGE_B, PRIVOXY), "Duplicate Issue of": main["Issue link"] }];

    const out = text(await fetchIssues()({ buildId: OTHER.id, compareWith: OLD.id }));

    expect(out).toContain(`⚠️ 2 pages did not load in build #1 (${OTHER.id})`);
    expect(out).toContain("0 new, 0 fixed, 0 still open.");
    expect(listed(out, `Not checked (page did not load in build #1 (${OTHER.id}))`).map((r) => r.issue_type).sort()).toEqual(["image-alt", "label"]);
  });

  it("refuses to compare a build with itself", async () => {
    const result = await fetchIssues()({ buildId: NEW.id, compareWith: NEW.id });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("compareWith names this build itself");
  });

  it("says to read both, as guidance, when compareWith is an app build", async () => {
    const result = await fetchIssues()({ buildId: NEW.id, compareWith: APP_BUILD });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain(`compareWith names App Accessibility build ${APP_BUILD}, which is not an Automated Tests build`);
    expect(text(result)).toContain("Read both reports with fetchAccessibilityIssues");
    expect(compareCalls()).toEqual([]);
  });

  it("says plainly when compareWith names no build, without a request to report it", async () => {
    const result = await fetchIssues()({ buildId: NEW.id, compareWith: "zz9unknownbuildfffffffffffffffffffffffff" });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^compareWith: No Automated Tests \(web\) or App Accessibility build/);
    expect(text(result)).not.toMatch(/GitHub/);
  });

  it("starts from an Automated Tests report link given as reportUrl", async () => {
    const link = `https://accessibility.browserstack.com/automated-tests/projects/Shop/builds/checkout/2?thBuildId=${NEW.id}`;

    const out = text(await fetchIssues()({ reportUrl: link, compareWith: OLD.id }));

    expect(out).toContain(`Resolved the report link to Automated Tests build ${NEW.id}.`);
    expect(compareCalls()[0].get("newReport")).toBe(NEW.id);
  });
});
