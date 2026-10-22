import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// An app build's issues at a glance (counts by severity, rule and screen), the build before
// it, what changed between two builds, and finding a build from its dashboard link or its
// Espresso / XCUITest run.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { AccessibilityReportFetcher } from "../../src/tools/accessiblity-utils/report-fetcher.js";
import {
  AppAccessibilityIssue,
  compareAppIssues,
  summarizeAppIssues,
} from "../../src/tools/accessiblity-utils/app-report-fetcher.js";

const get = apiClient.get as Mock;
const APP_API =
  "https://api-app-accessibility.browserstack.com/automate/api/v1";
const DASHBOARD = "https://app-accessibility.browserstack.com";
const BUILD_ID = "m3k8p2q7w1x5c9v4b6n0z2r8t3y7u1i5o9a4s2df";
const EARLIER_ID = "c4v8b2n6m0z3x7q1w5e9r2t6y0u4i8o3p7a1s5dg";

const ok = (body: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  data: { success: true, ...body },
});
const urls = () => get.mock.calls.map(([options]) => options.url);

// Each test queues the API's answers in call order; none may leak into the next.
beforeEach(() => get.mockReset());

function fetcher() {
  const f = new AccessibilityReportFetcher();
  f.setAuth({ username: "u", password: "p" });
  return f;
}

const META = {
  build_id: 5,
  th_build_id: BUILD_ID,
  name: "checkout-android",
  normalised_name: "checkout-android",
  project_name: "Checkout App",
  status: "failed",
  issue_summary: { total: 3, scan_count: 2 },
};

function issue(
  rule_id: string,
  severity: string,
  component: string,
  screen = "Screen 1 (test_checkout)",
  element: Record<string, unknown> = {},
): AppAccessibilityIssue {
  return {
    issue_type: rule_id.replace(/-/g, " "),
    rule_id,
    severity,
    screen,
    component,
    element,
    issue_description: "",
    how_to_fix: "",
    wcag: "",
  };
}

/** Two screens of one test: a labelled-button issue and a contrast issue, then a small target. */
const SNAPSHOTS = [
  {
    meta: { testcase_name: "test_checkout" },
    aggregated_results: [
      {
        rule_id: "interactable-element-content-label",
        label: "Interactive Element Accessibility Label",
        severity: "Critical",
        rule_issues: [
          { uid: "1", status: "fail", issue_id_android: "com.shop:id/pay" },
          { uid: "2", status: "fail", issue_id_android: "com.shop:id/save" },
        ],
      },
    ],
  },
  {
    meta: { testcase_name: "test_checkout" },
    aggregated_results: [
      {
        rule_id: "touch-target-size-and-spacing",
        label: "Touch Target Size & Spacing",
        severity: "Serious",
        rule_issues: [
          { uid: "3", status: "fail", issue_id_android: "com.shop:id/coupon" },
        ],
      },
    ],
  },
];

describe("summarizeAppIssues", () => {
  it("counts the issues by severity, by rule and by screen, largest first", () => {
    const summary = summarizeAppIssues([
      issue("touch-target-size-and-spacing", "serious", "a", "Screen 2 (t)"),
      issue("interactable-element-content-label", "critical", "b"),
      issue("interactable-element-content-label", "critical", "c"),
      issue("text-color-contrast", "moderate", "d"),
    ]);

    expect(summary).toEqual({
      by_severity: { critical: 2, serious: 1, moderate: 1 },
      by_rule: [
        {
          rule_id: "interactable-element-content-label",
          issue_type: "interactable element content label",
          count: 2,
        },
        {
          rule_id: "touch-target-size-and-spacing",
          issue_type: "touch target size and spacing",
          count: 1,
        },
        {
          rule_id: "text-color-contrast",
          issue_type: "text color contrast",
          count: 1,
        },
      ],
      by_screen: [
        { screen: "Screen 1 (test_checkout)", count: 3 },
        { screen: "Screen 2 (t)", count: 1 },
      ],
    });
  });

  it("is part of an app build's report", async () => {
    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(
        ok({
          data: { details: SNAPSHOTS, info: { next: null }, issue_counts: {} },
        }),
      )
      .mockResolvedValueOnce(ok({ projects: [] }));

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(report.summary.by_severity).toEqual({ critical: 2, serious: 1 });
    expect(report.summary.by_screen).toEqual([
      { screen: "Screen 1 (test_checkout)", count: 2 },
      { screen: "Screen 2 (test_checkout)", count: 1 },
    ]);
  });
});

describe("compareAppIssues", () => {
  it("matches issues by rule and element id, wherever the screens fell", () => {
    const before = [
      issue(
        "interactable-element-content-label",
        "critical",
        "com.shop:id/pay",
      ),
      issue(
        "interactable-element-content-label",
        "critical",
        "com.shop:id/save",
      ),
      issue(
        "touch-target-size-and-spacing",
        "serious",
        "com.shop:id/coupon",
        "Screen 2 (test_checkout)",
      ),
    ];
    const after = [
      issue(
        "touch-target-size-and-spacing",
        "serious",
        "com.shop:id/coupon",
        "Screen 3 (test_checkout)",
      ),
      issue("text-color-contrast", "moderate", "com.shop:id/promo"),
      issue(
        "interactable-element-content-label",
        "critical",
        "com.shop:id/pay",
      ),
    ];

    const diff = compareAppIssues(before, after);

    expect(diff.added.map((r) => r.component)).toEqual(["com.shop:id/promo"]);
    expect(diff.resolved.map((r) => r.component)).toEqual(["com.shop:id/save"]);
    expect(diff.retained).toBe(2);
  });

  it("tells elements without an id apart by their class and text", () => {
    const view = (text: string) =>
      issue(
        "text-color-contrast",
        "moderate",
        "android.widget.TextView",
        "Screen 1 (t)",
        {
          className: "android.widget.TextView",
          text,
        },
      );

    const diff = compareAppIssues(
      [view("Total"), view("Fine print")],
      [view("Total")],
    );

    expect(diff.resolved.map((r) => r.element.text)).toEqual(["Fine print"]);
    expect(diff.added).toEqual([]);
    expect(diff.retained).toBe(1);
  });

  // An iOS issue often names its element by neither id nor class: only a frame, and
  // sometimes an accessibility label. Many issues of one rule then look alike.
  const unnamed = (screen: string, x: number, accessibilityLabel?: string) => ({
    ...issue(
      "text-magnification",
      "critical",
      "Font Magnification Support",
      screen,
      {
        frame: { x, y: 10, width: 50, height: 20 },
        ...(accessibilityLabel ? { accessibilityLabel } : {}),
      },
    ),
    // With neither id nor class, the element is named by its rule.
    issue_type: "Font Magnification Support",
  });

  it("matches look-alike issues one for one, so the counts add up to each build's total", () => {
    const before = [
      unnamed("Screen 1 (t)", 10),
      unnamed("Screen 1 (t)", 70),
      unnamed("Screen 2 (t)", 10),
      unnamed("Screen 3 (t)", 10),
    ];
    const after = [unnamed("Screen 1 (t)", 10), unnamed("Screen 1 (t)", 70)];

    const diff = compareAppIssues(before, after);

    expect(diff.retained).toBe(2);
    expect(diff.added).toEqual([]);
    expect(diff.resolved.map((r) => r.screen)).toEqual([
      "Screen 2 (t)",
      "Screen 3 (t)",
    ]);
    expect(diff.added.length + diff.retained).toBe(after.length);
    expect(diff.resolved.length + diff.retained).toBe(before.length);
  });

  it("pairs a look-alike with one on the same screen and spot before any other", () => {
    const before = [unnamed("Screen 1 (t)", 10), unnamed("Screen 2 (t)", 10)];
    const after = [unnamed("Screen 2 (t)", 10)];

    const diff = compareAppIssues(before, after);

    expect(diff.retained).toBe(1);
    expect(diff.resolved.map((r) => r.screen)).toEqual(["Screen 1 (t)"]);
  });

  it("still pairs look-alikes that moved to another screen, as a fix can renumber the screens", () => {
    const before = [unnamed("Screen 2 (t)", 10)];
    const after = [unnamed("Screen 3 (t)", 10)];

    const diff = compareAppIssues(before, after);

    expect(diff.retained).toBe(1);
    expect(diff.added).toEqual([]);
    expect(diff.resolved).toEqual([]);
  });

  it("tells elements without an id apart by their accessibility label", () => {
    const diff = compareAppIssues(
      [
        unnamed("Screen 1 (t)", 10, "Price"),
        unnamed("Screen 1 (t)", 70, "Total"),
      ],
      [unnamed("Screen 1 (t)", 10, "Total")],
    );

    expect(diff.retained).toBe(1);
    expect(diff.resolved.map((r) => r.element.accessibilityLabel)).toEqual([
      "Price",
    ]);
  });
});

describe("AccessibilityReportFetcher and the build before an app build", () => {
  const project = () =>
    ok({ projects: [{ id: 123456, name: "Checkout App" }] });

  it("is the newest earlier build of the same name in the project", async () => {
    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce(
        ok({
          builds: [
            { th_build_id: "later", name: "checkout-android", build_number: 6 },
            {
              th_build_id: BUILD_ID,
              name: "checkout-android",
              build_number: 5,
            },
            {
              th_build_id: "other",
              name: "smoke-android",
              build_number: 1,
              created_at: "2026-03-04T10:00:00Z",
            },
            {
              th_build_id: EARLIER_ID,
              name: "checkout-android",
              build_number: 4,
              created_at: "2026-03-04T09:00:00Z",
            },
          ],
          info: { next: null },
        }),
      );

    await expect(fetcher().previousAppBuild(BUILD_ID)).resolves.toEqual({
      buildId: EARLIER_ID,
      name: "checkout-android",
      build_number: 4,
      created_at: "2026-03-04T09:00:00Z",
      same_name: true,
    });
    expect(urls()).toEqual([
      `${APP_API}/build/${BUILD_ID}`,
      `${APP_API}/project?name=Checkout%20App`,
      `${APP_API}/project/123456/build?page_size=30&page=1`,
    ]);
  });

  it("is the build just before it when no earlier build shares its name, as each native run is named apart", async () => {
    get
      .mockResolvedValueOnce(
        ok({ meta_data: { ...META, name: "Build #12: Checkout.apk v1.0" } }),
      )
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce(
        ok({
          builds: [
            {
              th_build_id: BUILD_ID,
              name: "Build #12: Checkout.apk v1.0",
              build_number: 1,
            },
            {
              th_build_id: EARLIER_ID,
              name: "Build #11: Checkout.apk v1.0",
              build_number: 1,
            },
            {
              th_build_id: "older",
              name: "Build #9: Checkout.apk v1.0",
              build_number: 1,
            },
          ],
          info: { next: null },
        }),
      );

    await expect(fetcher().previousAppBuild(BUILD_ID)).resolves.toMatchObject({
      buildId: EARLIER_ID,
      same_name: false,
    });
  });

  it("is none for a project's first build", async () => {
    get
      .mockResolvedValueOnce(ok({ meta_data: META }))
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce(
        ok({
          builds: [{ th_build_id: BUILD_ID, name: "checkout-android" }],
          info: { next: null },
        }),
      );

    await expect(fetcher().previousAppBuild(BUILD_ID)).resolves.toBeUndefined();
  });
});

describe("AccessibilityReportFetcher reads every issue of an app build to compare it", () => {
  it("returns all the build's issues with the tests its screens came from", async () => {
    get.mockResolvedValueOnce(ok({ meta_data: META })).mockResolvedValueOnce(
      ok({
        data: { details: SNAPSHOTS, info: { next: null }, issue_counts: {} },
      }),
    );

    const build = await fetcher().appBuildIssues(BUILD_ID);

    expect(build).toMatchObject({
      buildId: BUILD_ID,
      build_name: "checkout-android",
      build_number: 5,
      scan_count: 2,
      tests: ["test_checkout"],
    });
    expect(build.issues.map((r) => r.component)).toEqual([
      "com.shop:id/pay",
      "com.shop:id/save",
      "com.shop:id/coupon",
    ]);
  });
});

describe("AccessibilityReportFetcher and App Accessibility dashboard links", () => {
  it("finds the build by its name and number, as numbers count up per build name", async () => {
    get.mockResolvedValueOnce(
      ok({
        builds: [
          {
            build_number: 1,
            normalised_name: "Build++13%3A+Checkout.apk+v1.0",
            th_build_id: "native",
          },
          {
            build_number: 1,
            normalised_name: "checkout-android",
            th_build_id: BUILD_ID,
          },
        ],
        info: { next: null },
      }),
    );

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/automated-tests/projects/123456/builds/checkout-android/1`,
      ),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
  });

  it("matches the name however the link's characters are escaped", async () => {
    get.mockResolvedValueOnce(
      ok({
        builds: [
          {
            build_number: 1,
            normalised_name: "Build++13%3A+Checkout.apk+v1.0",
            th_build_id: BUILD_ID,
          },
        ],
        info: { next: null },
      }),
    );

    await expect(
      fetcher().sourceFromReportUrl(
        `${DASHBOARD}/automated-tests/projects/123456/builds/Build++13:+Checkout.apk+v1.0/1`,
      ),
    ).resolves.toEqual({ kind: "appBuild", buildId: BUILD_ID });
  });
});

describe("AccessibilityReportFetcher and Espresso / XCUITest build links", () => {
  const APP_AUTOMATE_BUILD = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
  const LINK = `https://app-automate.browserstack.com/builds/${APP_AUTOMATE_BUILD}`;
  const noSessions = { ok: true, status: 200, data: [] };
  const espresso = (data: Record<string, unknown>) => ({
    ok: true,
    status: 200,
    data,
  });
  const STARTED = "2026-03-04 10:30:40 UTC";

  it("finds the accessibility build that started with the run, without walking the account's builds", async () => {
    get
      .mockResolvedValueOnce(noSessions)
      .mockResolvedValueOnce(
        espresso({
          start_time: STARTED,
          input_capabilities: { project: "Checkout App" },
        }),
      )
      .mockResolvedValueOnce(
        ok({ projects: [{ id: 123456, name: "Checkout App" }] }),
      )
      .mockResolvedValueOnce(
        ok({
          builds: [
            {
              th_build_id: "later",
              name: "Build #14: Checkout.apk v1.0",
              created_at: "2026-03-04T11:02:00.000Z",
            },
            {
              th_build_id: BUILD_ID,
              name: "Build #13: Checkout.apk v1.0",
              created_at: "2026-03-04T10:30:41.794Z",
            },
            {
              th_build_id: "earlier",
              name: "Build #12: Checkout.apk v1.0",
              created_at: "2026-03-04T09:00:00.000Z",
            },
          ],
          info: { next: 2 },
        }),
      );

    await expect(fetcher().sourceFromReportUrl(LINK)).resolves.toEqual({
      kind: "appBuild",
      buildId: BUILD_ID,
    });
    expect(urls()).not.toContainEqual(expect.stringContaining("builds.json"));
    expect(urls()).toHaveLength(4);
  });

  it("tells runs that started together apart by the run's name", async () => {
    get
      .mockResolvedValueOnce(noSessions)
      .mockResolvedValueOnce(
        espresso({
          start_time: STARTED,
          input_capabilities: { project: "Checkout App" },
        }),
      )
      .mockResolvedValueOnce(
        ok({ projects: [{ id: 123456, name: "Checkout App" }] }),
      )
      .mockResolvedValueOnce(
        ok({
          builds: [
            {
              th_build_id: "twin",
              name: "Build #14: Checkout.apk v1.0",
              created_at: "2026-03-04T10:30:42.100Z",
            },
            {
              th_build_id: BUILD_ID,
              name: "Build #13: Checkout.apk v1.0",
              created_at: "2026-03-04T10:30:41.794Z",
            },
          ],
          info: { next: null },
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            automation_build: {
              hashed_id: APP_AUTOMATE_BUILD,
              name: "Build #13: Checkout.apk v1.0",
            },
          },
        ],
      });

    await expect(fetcher().sourceFromReportUrl(LINK)).resolves.toEqual({
      kind: "appBuild",
      buildId: BUILD_ID,
    });
  });
});
