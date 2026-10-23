import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// Reading an App Accessibility (mobile app) build: its issues come inline from the App
// Accessibility API's per-screen snapshots, not from a CSV export.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  AccessibilityReportFetcher,
  MAX_APP_BUILD_LIST_PAGES,
} from "../../src/tools/accessiblity-utils/report-fetcher.js";
import {
  compactAppIssues,
  flattenAppSnapshots,
  MAX_SNAPSHOT_PAGES,
} from "../../src/tools/accessiblity-utils/app-report-fetcher.js";

const get = apiClient.get as Mock;
const API = "https://api-accessibility.browserstack.com/api";
const APP_API =
  "https://api-app-accessibility.browserstack.com/automate/api/v1";
const DASHBOARD = "https://app-accessibility.browserstack.com";
const BUILD_ID = "m3k8p2q7w1x5c9v4b6n0z2r8t3y7u1i5o9a4s2df";

const ok = (body: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  data: { success: true, ...body },
});
/** What the dashboard's routes answer an access key with until they take one. */
const REDIRECT_TO_LOGIN = {
  ok: false,
  status: 302,
  data: { success: false, message: "redirect_to_login" },
};
const missing = () => ({
  ok: false,
  status: 404,
  data: { success: false, message: "No build found" },
});
const urls = () => get.mock.calls.map(([options]) => options.url);

function fetcher() {
  const f = new AccessibilityReportFetcher();
  f.setAuth({ username: "u", password: "p" });
  return f;
}

const META = {
  build_id: 8,
  th_build_id: BUILD_ID,
  name: "Checkout Build",
  normalised_name: "Checkout+Build",
  project_name: "Checkout App",
  status: "failed",
  issue_summary: { total: 3, scan_count: 2 },
  fup: { capped: false, tests_partial: false, tests_dropped: false },
};

/** Two scanned screens; one issue is hidden in the dashboard and one has duplicates. */
const SNAPSHOTS = [
  {
    meta: {
      snapshot_id: "1",
      screenshot_url: "https://assets.example/s1.jpeg",
      testcase_name: "test_checkout",
    },
    aggregated_results: [
      {
        rule_id: "interactable-element-content-label",
        label: "Interactive Element Accessibility Label",
        description: "Interactive elements must have a label.",
        severity: "Critical",
        guidelines: [
          { message: "WCAG 2.2-1.3.1 A" },
          { message: "WCAG 2.2-4.1.2 A" },
        ],
        rule_issues: [
          {
            uid: "u1",
            status: "fail",
            duplication_count: 2,
            issue_class_android: "android.widget.Button",
            issue_id_android: "com.example:id/btn_pay",
            how_to_fix_desc:
              "<document>Ensure <code>spokenDescription</code> is defined.</document>",
            issue_details: [
              { label: "className", value: '"android.widget.Button"' },
              { label: "viewId", value: '"com.example:id/btn_pay"' },
              {
                label: "frame",
                value: '{"x":63,"y":195,"width":315,"height":126}',
              },
              { label: "text", value: '""' },
              { label: "contentDescription", value: '""' },
              { label: "isClickable", value: "True" },
            ],
          },
          {
            uid: "u2",
            status: "hidden",
            duplication_count: 0,
            issue_class_android: "android.widget.Button",
            issue_id_android: "com.example:id/btn_hidden",
            how_to_fix_desc: "",
            issue_details: [],
          },
        ],
      },
      {
        rule_id: "text-color-contrast",
        label: "Text Element Color Contrast (Minimum)",
        description: "Text must have enough contrast.",
        severity: "Moderate",
        guidelines: [{ message: "WCAG 2.2-1.4.3 AA" }],
        rule_issues: [
          {
            uid: "u3",
            status: "fail",
            duplication_count: 0,
            issue_class_android: "android.widget.TextView",
            how_to_fix_desc: "<document>Raise the contrast ratio.</document>",
            issue_details: [
              { label: "text", value: '"Low contrast body copy"' },
            ],
          },
        ],
      },
    ],
  },
  {
    meta: {
      snapshot_id: "2",
      screenshot_url: "https://assets.example/s2.jpeg",
      testcase_name: "test_checkout",
    },
    aggregated_results: [
      {
        rule_id: "touch-target-size-and-spacing",
        label: "Touch Target Size & Spacing",
        description: "Targets must be large enough.",
        severity: "Serious",
        guidelines: [],
        rule_issues: [
          {
            uid: "u4",
            status: "fail",
            duplication_count: 0,
            issue_class_ios: "UIButton",
            issue_id_ios: "pay_button",
            how_to_fix_desc: "<document>Make the button larger.</document>",
            issue_details: [],
          },
        ],
      },
    ],
  },
];

describe("flattenAppSnapshots", () => {
  it("lists one row per element, sorted by severity, leaving hidden issues out", () => {
    const rows = flattenAppSnapshots(SNAPSHOTS);

    expect(rows.map((r) => r.rule_id)).toEqual([
      "interactable-element-content-label",
      "touch-target-size-and-spacing",
      "text-color-contrast",
    ]);
    expect(rows[0]).toEqual({
      issue_type: "Interactive Element Accessibility Label",
      rule_id: "interactable-element-content-label",
      severity: "critical",
      screen: "Screen 1 (test_checkout)",
      component: "com.example:id/btn_pay",
      element: {
        className: "android.widget.Button",
        viewId: "com.example:id/btn_pay",
        frame: { x: 63, y: 195, width: 315, height: 126 },
      },
      issue_description: "Interactive elements must have a label.",
      how_to_fix: "Ensure spokenDescription is defined.",
      wcag: "WCAG 2.2-1.3.1 A; WCAG 2.2-4.1.2 A",
      screenshot: "https://assets.example/s1.jpeg",
      duplicate_count: 2,
    });
  });

  it("leaves no tag in the fix text, however its markup is nested", () => {
    const rows = flattenAppSnapshots([
      {
        aggregated_results: [
          {
            rule_id: "r",
            label: "Rule",
            severity: "Serious",
            rule_issues: [
              {
                uid: "x",
                status: "fail",
                issue_id_android: "com.example:id/pay",
                how_to_fix_desc:
                  "<document>Label it.<scr<script>ipt>alert(1)</script> <<b>b>Done</document>",
              },
            ],
          },
        ],
      },
    ]);

    expect(rows[0].how_to_fix).not.toMatch(/[<>]/);
    expect(rows[0].how_to_fix).toContain("Label it.");
    expect(rows[0].how_to_fix).toContain("Done");
  });

  it("names the element by its class when it has no id, and keeps only its identifying details", () => {
    const rows = flattenAppSnapshots(SNAPSHOTS);
    const contrast = rows.find((r) => r.rule_id === "text-color-contrast")!;
    const touch = rows.find(
      (r) => r.rule_id === "touch-target-size-and-spacing",
    )!;

    expect(contrast.component).toBe("android.widget.TextView");
    expect(contrast.element).toEqual({ text: "Low contrast body copy" });
    expect(contrast.duplicate_count).toBeUndefined();
    expect(touch.screen).toBe("Screen 2 (test_checkout)");
    expect(touch.component).toBe("pay_button");
    expect(touch.wcag).toBe("");
  });
});

describe("AccessibilityReportFetcher and App Accessibility builds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a build id the web API knows as an Automated Tests build", async () => {
    get.mockResolvedValueOnce(
      ok({ data: { id: BUILD_ID, projectName: "Web" } }),
    );

    await expect(
      fetcher().resolveBuild({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toEqual({ kind: "build", buildId: BUILD_ID });
    expect(urls()).toEqual([`${API}/automated-tests/v1/builds/${BUILD_ID}`]);
  });

  it("resolves a build id only the App Accessibility API knows to an app build", async () => {
    get
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(ok({ meta_data: META }));

    await expect(
      fetcher().resolveBuild({ kind: "build", buildId: BUILD_ID }),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
    expect(urls()).toEqual([
      `${API}/automated-tests/v1/builds/${BUILD_ID}`,
      `${APP_API}/build/${BUILD_ID}`,
    ]);
  });

  it("says plainly when neither API knows a build id", async () => {
    get.mockResolvedValueOnce(missing()).mockResolvedValueOnce(missing());

    await expect(
      fetcher().resolveBuild({ kind: "build", buildId: BUILD_ID }),
    ).rejects.toThrow(
      /No Automated Tests \(web\) or App Accessibility build with id/,
    );
  });

  it("does not probe for a source that is not a build", async () => {
    await expect(
      fetcher().resolveBuild({ kind: "workflow", reportId: "123456" }),
    ).resolves.toEqual({ kind: "workflow", reportId: "123456" });
    expect(get).not.toHaveBeenCalled();
  });

  it("reads an app build's status from its details", async () => {
    get.mockResolvedValueOnce(
      ok({ meta_data: { ...META, status: "rule_processing" } }),
    );

    await expect(
      fetcher().reportStatus({ kind: "appBuild", buildId: BUILD_ID }),
    ).resolves.toBe("rule_processing");
    expect(urls()).toEqual([`${APP_API}/build/${BUILD_ID}`]);
  });

  it("resolves an App Accessibility dashboard link by build number, as the link's name is TestHub's, not the build's", async () => {
    get
      .mockResolvedValueOnce(
        ok({
          builds: [{ build_number: 9, th_build_id: "newer" }],
          info: { next: 2 },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          builds: [{ build_number: 8, th_build_id: BUILD_ID }],
          info: { next: null },
        }),
      );

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/automated-tests/projects/123456/builds/Checkout+Build/8`,
      ),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
    expect(urls()).toEqual([
      `${APP_API}/project/123456/build?page_size=30&page=1`,
      `${APP_API}/project/123456/build?page_size=30&page=2`,
    ]);
  });

  it("says so when the link's build number is not in the project's newest builds", async () => {
    get.mockResolvedValue(
      ok({
        builds: [{ build_number: 9, th_build_id: "x" }],
        info: { next: 2 },
      }),
    );

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/automated-tests/projects/123456/builds/Checkout+Build/8`,
      ),
    ).rejects.toThrow(/build 8 of "Checkout Build"/);
    expect(get).toHaveBeenCalledTimes(MAX_APP_BUILD_LIST_PAGES);
  });

  it("stops at the snapshot page limit and says how many screens it read", async () => {
    get.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith(BUILD_ID)) {
        return ok({ meta_data: { ...META, issue_summary: { total: 9, scan_count: 1500 } } });
      }
      if (url.includes("/snapshot")) {
        return ok({
          data: {
            details: [SNAPSHOTS[0]],
            info: { next: 2 },
            issue_counts: { hidden_issues: 0 },
          },
        });
      }
      return ok({ projects: [] });
    });

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(urls().filter((u) => u.includes("/snapshot"))).toHaveLength(MAX_SNAPSHOT_PAGES);
    expect(report.screens_read).toBe(MAX_SNAPSHOT_PAGES);
  });

  it("reports no screens_read when every snapshot page was read", async () => {
    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(
        ok({ data: { details: SNAPSHOTS, info: { next: null }, issue_counts: { hidden_issues: 1 } } }),
      )
      .mockResolvedValueOnce(ok({ projects: [] }));

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(report).not.toHaveProperty("screens_read");
  });

  it("reads an app build's issues from its screens, with its dashboard link", async () => {
    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(
        ok({
          data: {
            details: [SNAPSHOTS[0]],
            info: { page: 1, next: 2 },
            issue_counts: { fail: 3, hidden_issues: 1 },
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          data: {
            details: [SNAPSHOTS[1]],
            info: { page: 2, next: null },
            issue_counts: { fail: 3, hidden_issues: 1 },
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({ projects: [{ id: 123456, name: "Checkout App" }] }),
      );

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(urls()).toEqual([
      `${APP_API}/build/${BUILD_ID}`,
      `${APP_API}/build/${BUILD_ID}/snapshot?hide_duplicate_issues=true&page_size=50&page=1`,
      `${APP_API}/build/${BUILD_ID}/snapshot?hide_duplicate_issues=true&page_size=50&page=2`,
      `${APP_API}/project?name=Checkout%20App`,
    ]);
    expect(report).toMatchObject({
      build_name: "Checkout Build",
      status: "failed",
      scan_count: 2,
      total_issues: 3,
      page_length: 3,
      next_page: null,
      hidden_issues: 1,
      fup_capped: false,
      dashboard_link: `${DASHBOARD}/automated-tests/projects/123456/builds/Checkout+Build/8`,
    });
    expect(report.records.map((r) => r.severity)).toEqual([
      "critical",
      "serious",
      "moderate",
    ]);
  });

  it("pages the rows by character offset like a CSV report", async () => {
    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(
        ok({
          data: {
            details: SNAPSHOTS,
            info: { page: 1, next: null },
            issue_counts: { fail: 3, hidden_issues: 0 },
          },
        }),
      )
      .mockResolvedValueOnce(ok({ projects: [] }));

    // A page that holds the first row and not the second.
    const pageSize =
      JSON.stringify(compactAppIssues(flattenAppSnapshots(SNAPSHOTS)).rows[0])
        .length + 10;
    const first = await fetcher().appBuildReport(BUILD_ID, 0, pageSize);
    expect(first.page_length).toBe(1);
    expect(first.next_page).toBe(JSON.stringify(first.records[0]).length);
    expect(first.dashboard_link).toBeUndefined();

    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(
        ok({
          data: {
            details: SNAPSHOTS,
            info: { page: 1, next: null },
            issue_counts: { fail: 3, hidden_issues: 0 },
          },
        }),
      )
      .mockResolvedValueOnce(ok({ projects: [] }));
    const second = await fetcher().appBuildReport(
      BUILD_ID,
      first.next_page!,
      pageSize,
    );
    expect(second.records[0].rule_id).toBe("touch-target-size-and-spacing");
  });

  it("reports a finished build with no scans without reading its screens", async () => {
    get.mockResolvedValueOnce(
      ok({
        meta_data: {
          ...META,
          status: "passed",
          issue_summary: { total: 0, scan_count: 0 },
          fup: { capped: true, tests_partial: false, tests_dropped: true },
        },
      }),
    );
    get.mockResolvedValueOnce(ok({ projects: [] }));

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(report).toMatchObject({
      scan_count: 0,
      total_issues: 0,
      records: [],
      fup_capped: true,
    });
    expect(urls()).not.toContainEqual(expect.stringContaining("/snapshot"));
  });

  it("says which framework ran the build, so a native build's empty report can be explained", async () => {
    get.mockResolvedValueOnce(
      ok({
        meta_data: {
          ...META,
          status: "passed",
          issue_summary: { total: 0, scan_count: 0 },
          session_data: {
            framework: { name: "Espresso-Junit4", version: null },
            sdk: { version: null },
          },
        },
      }),
    );
    get.mockResolvedValueOnce(ok({ projects: [] }));

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(report.framework).toBe("Espresso-Junit4");
  });

  it("fails plainly when the app build does not exist", async () => {
    get.mockResolvedValueOnce(missing());

    await expect(fetcher().appBuildReport(BUILD_ID)).rejects.toThrow(
      /No App Accessibility build/,
    );
  });
});

describe("AccessibilityReportFetcher and App Automate links", () => {
  const APP_AUTOMATE_BUILD = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
  const SESSION = "fedcba9876543210fedcba9876543210fedcba98";
  const sessionsUrl = `https://api-cloud.browserstack.com/app-automate/builds/${APP_AUTOMATE_BUILD}/sessions.json?limit=1`;
  const testCodeUrl = (session: string) =>
    `https://api-automation.browserstack.com/ext/v1/sessions/${session}/testCode`;

  beforeEach(() => vi.clearAllMocks());

  it("maps an App Automate build link to its accessibility build through a session's test code", async () => {
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ automation_session: { hashed_id: SESSION } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { session_id: SESSION, build_uuid: BUILD_ID, tests: [] },
      });

    await expect(
      fetcher().sourceFromReportUrl(
        `https://app-automate.browserstack.com/dashboard/v2/builds/${APP_AUTOMATE_BUILD}`,
      ),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
    expect(urls()).toEqual([sessionsUrl, testCodeUrl(SESSION)]);
  });

  it("goes straight to the session when the link names one", async () => {
    get.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { session_id: SESSION, build_uuid: BUILD_ID, tests: [] },
    });

    await expect(
      fetcher().sourceFromReportUrl(
        `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}/sessions/${SESSION}`,
      ),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
    expect(urls()).toEqual([testCodeUrl(SESSION)]);
  });

  it("maps a native (Espresso) build by name through its project, as it has no SDK session", async () => {
    const NAME = "Build #12: Checkout.apk v1.0";
    get
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { input_capabilities: { project: "Checkout App" } },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          { automation_build: { hashed_id: "other", name: "Build #13: x" } },
          { automation_build: { hashed_id: APP_AUTOMATE_BUILD, name: NAME } },
        ],
      })
      .mockResolvedValueOnce(
        ok({ projects: [{ id: 123456, name: "Checkout App" }] }),
      )
      .mockResolvedValueOnce(
        ok({
          builds: [{ name: NAME, build_number: 1, th_build_id: BUILD_ID }],
          info: { next: null },
        }),
      );

    await expect(
      fetcher().sourceFromReportUrl(
        `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}`,
      ),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
    expect(urls()).toEqual([
      sessionsUrl,
      `https://api-cloud.browserstack.com/app-automate/espresso/v2/builds/${APP_AUTOMATE_BUILD}`,
      "https://api-cloud.browserstack.com/app-automate/builds.json?limit=100&offset=0",
      `${APP_API}/project?name=Checkout%20App`,
      `${APP_API}/project/123456/build?build_name=${encodeURIComponent(NAME)}&page_size=30&page=1`,
    ]);
  });

  it("says when a native build ran without accessibility on", async () => {
    get
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: false, status: 404, data: {} })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { input_capabilities: { project: "Checkout App" } },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            automation_build: {
              hashed_id: APP_AUTOMATE_BUILD,
              name: "Build #12: Checkout.ipa v1.0",
            },
          },
        ],
      })
      .mockResolvedValueOnce(
        ok({ projects: [{ id: 123456, name: "Checkout App" }] }),
      )
      .mockResolvedValueOnce(ok({ builds: [], info: { next: null } }));

    await expect(
      fetcher().sourceFromReportUrl(
        `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}`,
      ),
    ).rejects.toThrow(/accessibility was not on for this run/);
    expect(urls()[2]).toBe(
      `https://api-cloud.browserstack.com/app-automate/xcuitest/v2/builds/${APP_AUTOMATE_BUILD}`,
    );
  });

  it("says when the run had no accessibility on, so there is no report to read", async () => {
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ automation_session: { hashed_id: SESSION } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { session_id: SESSION, build_uuid: null, tests: [] },
      });

    await expect(
      fetcher().sourceFromReportUrl(
        `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}`,
      ),
    ).rejects.toThrow(/accessibility.*was not on/i);
  });

  it("reports a failed session lookup as the error it was, not as accessibility being off", async () => {
    get
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ automation_session: { hashed_id: SESSION } }],
      })
      .mockResolvedValueOnce({ ok: false, status: 500, data: {} });

    const failure = fetcher().sourceFromReportUrl(
      `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}`,
    );

    await expect(failure).rejects.toThrow(/HTTP 500/);
    await expect(failure).rejects.not.toThrow(/was not on/);
  });

  it("says when the build has no sessions to map through", async () => {
    get.mockResolvedValue({ ok: false, status: 404, data: {} });

    await expect(
      fetcher().sourceFromReportUrl(
        `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}`,
      ),
    ).rejects.toThrow(/No session.*App Automate build/);
  });
});

describe("AccessibilityReportFetcher and App Accessibility manual reports", () => {
  const REPORT_ID = "6d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const DETAIL = {
    meta_data: {
      name: "Checkout walkthrough",
      created_at: "2026-10-21T18:54:05.374Z",
      ended_at: "2026-10-21T18:57:22.487Z",
    },
    wcag_version: "WCAG 2.2 AA",
    data: {
      issue_summary: {
        total: 2,
        severity_count: { critical: 1, serious: 1, hidden_issues: 1, duplicate_issues: 1 },
        scan_count: 2,
      },
    },
  };
  /** A manual snapshot keeps its rules under meta, belongs to no test, and its issues carry no status. */
  const manualSnapshot = (snapshot: (typeof SNAPSHOTS)[number]) => ({
    meta: {
      snapshot_id: snapshot.meta.snapshot_id,
      screenshot_url: snapshot.meta.screenshot_url,
      aggregated_results: snapshot.aggregated_results,
    },
  });

  beforeEach(() => vi.clearAllMocks());

  it("resolves a manual report's dashboard link to the report", async () => {
    await expect(
      fetcher().sourceFromReportUrl(`${DASHBOARD}/report/${REPORT_ID}`),
    ).resolves.toEqual({ kind: "appReport", reportId: REPORT_ID });
    expect(get).not.toHaveBeenCalled();
  });

  it("reads a manual report's status from whether it has ended", async () => {
    get.mockResolvedValueOnce(ok({ ...DETAIL, meta_data: { ...DETAIL.meta_data, ended_at: null } }));
    await expect(
      fetcher().reportStatus({ kind: "appReport", reportId: REPORT_ID }),
    ).resolves.toBe("in_progress");

    get.mockResolvedValueOnce(ok(DETAIL));
    await expect(
      fetcher().reportStatus({ kind: "appReport", reportId: REPORT_ID }),
    ).resolves.toBe("complete");
    expect(urls()).toEqual([
      `${APP_API.replace("/automate/api/v1", "")}/api/v1/reports/${REPORT_ID}`,
      `${APP_API.replace("/automate/api/v1", "")}/api/v1/reports/${REPORT_ID}`,
    ]);
  });

  it("falls back to the Manual Reports API's occurrences, with the dashboard's own count, while the dashboard's screens refuse the key", async () => {
    const MANUAL_API = `${APP_API.replace("/automate/api/v1", "")}/api/v1`;
    get
      .mockResolvedValueOnce(ok(DETAIL))
      .mockResolvedValueOnce(REDIRECT_TO_LOGIN)
      .mockResolvedValueOnce(
        ok({
          device: { model: "iPhone 15 Pro", os: "ios", os_version: "17.0" },
          data: [manualSnapshot(SNAPSHOTS[0])],
          pagination: { page: 1, next: 2 },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          device: { model: "iPhone 15 Pro", os: "ios", os_version: "17.0" },
          data: [manualSnapshot(SNAPSHOTS[1])],
          pagination: { page: 2, next: null },
        }),
      );

    const report = await fetcher().appReportIssues(REPORT_ID);

    expect(urls()).toEqual([
      `${MANUAL_API}/reports/${REPORT_ID}`,
      `${MANUAL_API}/app_scanner/${REPORT_ID}/snapshot?hide_duplicate_issues=true&page_size=50&page=1`,
      `${MANUAL_API}/reports/${REPORT_ID}/issues?page_size=50&page=1`,
      `${MANUAL_API}/reports/${REPORT_ID}/issues?page_size=50&page=2`,
    ]);
    expect(report).toMatchObject({
      deduplicated: false,
      report_name: "Checkout walkthrough",
      status: "complete",
      scan_count: 2,
      device: "iPhone 15 Pro, ios 17.0",
      // Every occurrence the API lists; the hidden one is left out as its status says.
      total_issues: 3,
      page_length: 3,
      next_page: null,
      dashboard_count: 2,
      duplicate_occurrences: 1,
      hidden_issues: 1,
      dashboard_link: `${DASHBOARD}/report/${REPORT_ID}`,
    });
    expect(report.records[0].screen).toBe("Screen 1");
    expect(report.records.map((r) => r.severity)).toEqual([
      "critical",
      "serious",
      "moderate",
    ]);
  });

  it("reads a manual report's screens as the dashboard does: duplicates left out, each issue with its element and fix", async () => {
    const MANUAL_API = `${APP_API.replace("/automate/api/v1", "")}/api/v1`;
    get
      .mockResolvedValueOnce(ok(DETAIL))
      .mockResolvedValueOnce(
        ok({ data: { details: [SNAPSHOTS[0]], info: { page: 1, next: 2 } } }),
      )
      .mockResolvedValueOnce(
        ok({ data: { details: [SNAPSHOTS[1]], info: { page: 2, next: null } } }),
      );

    const report = await fetcher().appReportIssues(REPORT_ID);

    expect(urls()).toEqual([
      `${MANUAL_API}/reports/${REPORT_ID}`,
      `${MANUAL_API}/app_scanner/${REPORT_ID}/snapshot?hide_duplicate_issues=true&page_size=50&page=1`,
      `${MANUAL_API}/app_scanner/${REPORT_ID}/snapshot?hide_duplicate_issues=true&page_size=50&page=2`,
    ]);
    expect(report.deduplicated).toBe(true);
    expect(report.total_issues).toBe(3);
    const pay = report.records.find((r) => r.component === "com.example:id/btn_pay");
    expect(pay?.element).toMatchObject({ className: "android.widget.Button" });
    expect(report.rules["interactable-element-content-label"].how_to_fix).toBe(
      "Ensure spokenDescription is defined.",
    );
  });

  it("fails plainly when the manual report does not exist", async () => {
    get.mockResolvedValueOnce(missing());

    await expect(fetcher().appReportIssues(REPORT_ID)).rejects.toThrow(
      /No App Accessibility manual report/,
    );
  });
});

describe("AccessibilityReportFetcher lists App Accessibility work", () => {
  const MANUAL_API = `${APP_API.replace("/automate/api/v1", "")}/api/v1`;

  beforeEach(() => vi.clearAllMocks());

  it("lists the newest projects when no project is named", async () => {
    get.mockResolvedValueOnce(
      ok({
        projects: [
          { id: 123456, name: "Checkout App", created_at: "2026-10-21T18:44:39.791Z" },
          { id: 123457, name: "Other", created_at: "2026-10-20T10:00:00.000Z" },
        ],
        info: { page: 1, page_size: 10, count: 2, next: null },
      }),
    );

    await expect(fetcher().listAppProjects(10)).resolves.toEqual({
      projects: [
        { id: 123456, name: "Checkout App", created_at: "2026-10-21T18:44:39.791Z" },
        { id: 123457, name: "Other", created_at: "2026-10-20T10:00:00.000Z" },
      ],
      total: 2,
    });
    expect(urls()).toEqual([`${APP_API}/project?page_size=10`]);
  });

  it("lists a project's newest builds with the ids and links the issues are read by", async () => {
    get
      .mockResolvedValueOnce(ok({ projects: [{ id: 123456, name: "Checkout App" }] }))
      .mockResolvedValueOnce(
        ok({
          builds: [
            {
              th_build_id: BUILD_ID,
              build_number: 8,
              name: "Checkout Build",
              normalised_name: "Checkout+Build",
              status: "failed",
              report_status: "generated",
              created_at: "2026-10-21T12:26:43.327Z",
              issue_summary: { total: 36, severity_count: { critical: 14, serious: 9, moderate: 6, minor: 7 }, scan_count: 3 },
              app_details: { name: "com.example.checkout" },
              session_data: { frameworkName: "pytest", language: "python" },
            },
          ],
          info: { page: 1, page_size: 10, count: 1, next: null },
        }),
      );

    const result = await fetcher().listAppBuilds("Checkout App", undefined, 10);

    expect(urls()).toEqual([
      `${APP_API}/project?name=Checkout%20App`,
      `${APP_API}/project/123456/build?page_size=10`,
    ]);
    expect(result).toEqual({
      project: { id: 123456, name: "Checkout App" },
      total: 1,
      builds: [
        {
          buildId: BUILD_ID,
          build_number: 8,
          name: "Checkout Build",
          status: "failed",
          report_status: "generated",
          created_at: "2026-10-21T12:26:43.327Z",
          scan_count: 3,
          issues: { total: 36, critical: 14, serious: 9, moderate: 6, minor: 7 },
          app: "com.example.checkout",
          framework: "pytest (python)",
          dashboard_link: `${DASHBOARD}/automated-tests/projects/123456/builds/Checkout+Build/8`,
        },
      ],
    });
  });

  it("filters builds by name and names the candidates when the project is not an exact match", async () => {
    get.mockResolvedValueOnce(
      ok({ projects: [{ id: 1, name: "Checkout App iOS" }, { id: 2, name: "Checkout App Android" }] }),
    );

    await expect(
      fetcher().listAppBuilds("Checkout App", "Nightly", 10),
    ).rejects.toThrow(/No project named "Checkout App".*Checkout App iOS.*Checkout App Android/s);
  });

  it("reports a failed project search as the failure, not as a project with no such name", async () => {
    get.mockResolvedValueOnce({ ok: false, status: 500, data: { message: "Internal error" } });

    const listing = fetcher().listAppBuilds("Checkout App", undefined, 10);

    await expect(listing).rejects.toThrow(/HTTP 500/);
    await expect(listing).rejects.not.toThrow(/No project named/);
  });

  it("still names no project when the search finds none", async () => {
    get.mockResolvedValueOnce({ ok: false, status: 404, data: { message: "No projects found" } });

    await expect(fetcher().listAppBuilds("Checkout App", undefined, 10)).rejects.toThrow(
      /No project named "Checkout App"/,
    );
  });

  it("passes a build-name filter through", async () => {
    get
      .mockResolvedValueOnce(ok({ projects: [{ id: 123456, name: "Checkout App" }] }))
      .mockResolvedValueOnce(ok({ builds: [], info: { count: 0, next: null } }));

    await fetcher().listAppBuilds("Checkout App", "Nightly", 5);
    expect(urls()[1]).toBe(
      `${APP_API}/project/123456/build?page_size=5&build_name=Nightly`,
    );
  });

  it("lists the newest manual reports with the ids the issues are read by", async () => {
    get.mockResolvedValueOnce(
      ok({
        reports: [
          {
            id: "6d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
            name: "Checkout walkthrough",
            status: "complete",
            created_at: "2026-10-21T18:29:39.773Z",
            app_details: { name: "Checkout", version: "1.2", package_name: "com.example.checkout" },
            issue_summary: { total: 97, severity_count: { critical: 76, serious: 19, moderate: 0, minor: 2, hidden_issues: 0, duplicate_issues: 47 }, scan_count: 7 },
          },
        ],
        info: { page: 1, page_size: 10, count: 1, next: null },
      }),
    );

    const result = await fetcher().listAppManualReports("Checkout", 10);

    expect(urls()).toEqual([`${MANUAL_API}/reports?page_size=10&report_name=Checkout`]);
    expect(result).toEqual({
      total: 1,
      reports: [
        {
          reportId: "6d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
          name: "Checkout walkthrough",
          status: "complete",
          created_at: "2026-10-21T18:29:39.773Z",
          app: "Checkout 1.2 (com.example.checkout)",
          scan_count: 7,
          issues: { total: 97, critical: 76, serious: 19, moderate: 0, minor: 2, duplicates: 47, hidden: 0 },
          dashboard_link: `${DASHBOARD}/report/6d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b`,
        },
      ],
    });
  });
});

describe("AccessibilityReportFetcher listings with no match", () => {
  const MANUAL_API = `${APP_API.replace("/automate/api/v1", "")}/api/v1`;
  // The API answers an empty list with 404 "No builds found" for access-key callers.
  const none = (message: string) => ({
    ok: false,
    status: 404,
    data: { success: false, message },
  });

  beforeEach(() => vi.clearAllMocks());

  it("lists no builds, not an error, when the name filter matches nothing", async () => {
    get
      .mockResolvedValueOnce(ok({ projects: [{ id: 123456, name: "Checkout App" }] }))
      .mockResolvedValueOnce(none("No builds found"));

    await expect(
      fetcher().listAppBuilds("Checkout App", "Nightly", 10),
    ).resolves.toEqual({
      project: { id: 123456, name: "Checkout App" },
      total: 0,
      builds: [],
    });
    // The client must not throw on the 404 before the listing can read it as "none".
    expect(get.mock.calls[1][0].raise_error).toBe(false);
  });

  it("lists no manual reports, not an error, when the name filter matches nothing", async () => {
    get.mockResolvedValueOnce(none("No reports found"));

    await expect(
      fetcher().listAppManualReports("Nightly", 10),
    ).resolves.toEqual({ total: 0, reports: [] });
    expect(get.mock.calls[0][0].raise_error).toBe(false);
    expect(urls()).toEqual([`${MANUAL_API}/reports?page_size=10&report_name=Nightly`]);
  });

  it("still fails on a 404 that is not a 'none found' answer, such as a wrong route", async () => {
    get.mockResolvedValueOnce({ ok: false, status: 404, data: { message: "Not Found" } });

    await expect(fetcher().listAppManualReports(undefined, 10)).rejects.toThrow(/HTTP 404 \(Not Found\)/);
  });

  it("still fails plainly on any other listing error", async () => {
    get.mockResolvedValueOnce({ ok: false, status: 500, data: { message: "Internal server error" } });

    await expect(fetcher().listAppProjects(10)).rejects.toThrow(/HTTP 500/);
  });
});
